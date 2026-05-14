// desktop/src/main/ipc/knowclaw.js
//
// IPC bridge between the Electron renderer and the new pi-coding-agent
// based KnowClaw runtime.
//
// Channels exposed (request/response via `ipcMain.handle`):
//
//   knowclaw:send              { message }            → start/queue a turn
//   knowclaw:abort             {}                     → session.abort()
//   knowclaw:newSession        {}                     → fresh persistent session
//   knowclaw:continueRecent    {}                     → resume most recent
//   knowclaw:listModels        {}                     → ipm-openai models
//   knowclaw:setModel          { providerId, modelId }→ pick next model
//   knowclaw:getStatus         {}                     → diagnostic snapshot
//
// Phase-10 channels (history UI):
//
//   knowclaw:listSessions      {}                     → JSONL session entries
//   knowclaw:openSession       { sessionFile }        → restore + history_loaded
//   knowclaw:deleteSession     { sessionFile }        → unlink JSONL (validated)
//   knowclaw:forkSession       { sessionFile,         → branch from entry index
//                                entryIndex? }
//
// One-way push from main to renderer:
//
//   knowclaw:event             { sessionId, ...sanitizedPiEvent }
//   knowclaw:event             { sessionId, type: 'history_loaded',
//                                messages: BubbleMessage[] }
//
// Design notes:
//
// - The pi-coding-agent SDK is ESM-only; Vite compiles the Electron
//   main bundle to CJS. We therefore load `pi-runtime/index.js` lazily
//   via `import(pathToFileURL(...).href)` and stash the resolved
//   module reference, identical to the Phase-0 PoC trick.
//
// - Phase 3 is intentionally single-window: the first `evt.sender` to
//   create a session "owns" the event stream.
//
// - `knowclaw:send` is fire-and-forget on the IPC layer: we kick off
//   `session.prompt(message)` and return immediately; the renderer
//   consumes the turn via `knowclaw:event`. Errors from the prompt
//   itself surface as a synthetic `{ type: 'error', ... }` event.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// IPM business helpers used by Phase-5 customTools. These modules live
// in the Vite-bundled main process; pi-runtime (ESM, standalone) cannot
// import them directly, so we inject them as function references via
// `toolDeps` instead.
import { buildProjectRegistry } from '../../../Agent/shared/projectRegistry.js';
import { getProjectDb } from '../../../Agent/db/index.js';
import { listEvents } from '../../../Agent/db/events.js';
import { listLogs } from '../../../Agent/db/activityLog.js';

const EVENT_CHANNEL = 'knowclaw:event';

/**
 * Best-effort sanitization for IPC: pi events are mostly plain objects
 * but may contain class instances. JSON round-trip strips functions,
 * symbols, and class identity while preserving data.
 */
function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') {
    return { type: 'unknown' };
  }
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    // Fallback: extract known-safe primitive fields by event.type.
    const safe = { type: String(event.type || 'unknown') };
    for (const key of [
      'sessionId', 'turnId', 'messageId', 'toolCallId', 'toolName',
      'isError', 'reason', 'level', 'attempt', 'maxAttempts',
    ]) {
      if (key in event) {
        const v = event[key];
        if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
          safe[key] = v;
        }
      }
    }
    return safe;
  }
}

/**
 * Resolve the pi-runtime entry point. `__dirname` at runtime is the
 * Vite-emitted bundle directory; pi-runtime sits two levels above it
 * (same path used by the Phase-0 PoC trigger in main.js).
 */
function piRuntimeUrl() {
  const p = path.resolve(__dirname, '..', '..', 'Agent', 'pi-runtime', 'index.js');
  return pathToFileURL(p).href;
}

/**
 * Extract a single text/string preview from any pi content payload.
 * pi `content` may be `string` (UserMessage) or an array of typed
 * content blocks (`text` | `thinking` | `image` | `toolCall` | etc.).
 */
function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

/**
 * Extract a `[{ type:'text', text }]` style result into a printable
 * string for the MessageBubble tool card.
 */
function extractTextFromToolResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Convert pi `AgentMessage[]` (UserMessage | AssistantMessage |
 * ToolResultMessage) into the MessageBubble shape used by the v2 chat:
 *
 *   { role: 'user' | 'assistant' | 'system', content, tools[], ts }
 *
 * Pairing rules:
 * - UserMessage → one bubble.
 * - AssistantMessage → one bubble. `text` blocks concatenated into
 *   `content`; `toolCall` blocks pushed into `tools[]` placeholders.
 * - ToolResultMessage → matched back into the most recent assistant
 *   bubble's `tools[]` entry by `toolCallId` (if present), filling
 *   `result` and `status`. If no matching tool entry exists (e.g. user
 *   opened a session whose persisted tool turn lost its assistant
 *   pair), skip silently — pi tolerates this.
 *
 * Unknown / non-LLM custom messages are filtered out (not displayed).
 */
function mapPiMessagesForRenderer(piMessages) {
  if (!Array.isArray(piMessages)) return [];

  const bubbles = [];
  const toolIndex = new Map(); // toolCallId → { bubbleIdx, toolIdx }

  for (const msg of piMessages) {
    if (!msg || typeof msg !== 'object') continue;
    const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();

    if (msg.role === 'user') {
      const text = extractTextFromContent(msg.content);
      if (!text) continue; // skip image-only / blank user blocks
      bubbles.push({ role: 'user', content: text, ts });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = extractTextFromContent(msg.content);
      const tools = [];
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'toolCall') {
            const toolCallId = String(block.id || `${block.name || 'tool'}-${tools.length}`);
            tools.push({
              name: String(block.name || 'tool'),
              toolCallId,
              status: 'running', // overwritten when matching toolResult arrives
            });
          }
        }
      }
      const bubble = { role: 'assistant', content: text || '', tools, ts };
      bubbles.push(bubble);
      const bubbleIdx = bubbles.length - 1;
      tools.forEach((t, toolIdx) => {
        toolIndex.set(t.toolCallId, { bubbleIdx, toolIdx });
      });
      continue;
    }

    if (msg.role === 'toolResult') {
      const toolCallId = String(msg.toolCallId || '');
      if (!toolCallId) continue;
      const ref = toolIndex.get(toolCallId);
      if (!ref) continue; // orphan tool result — drop silently
      const bubble = bubbles[ref.bubbleIdx];
      if (!bubble || !Array.isArray(bubble.tools)) continue;
      const tool = bubble.tools[ref.toolIdx];
      if (!tool) continue;
      tool.status = msg.isError ? 'error' : 'done';
      tool.result = extractTextFromToolResult(msg.content);
      continue;
    }
    // Other roles (custom / notification / etc.) are intentionally skipped.
  }

  // Final pass: any tool whose status is still 'running' must have lost
  // its result (or the session was aborted mid-tool). Mark them so the
  // UI shows a meaningful state rather than a forever spinner.
  for (const bubble of bubbles) {
    if (bubble.role !== 'assistant' || !Array.isArray(bubble.tools)) continue;
    for (const tool of bubble.tools) {
      if (tool.status === 'running') {
        tool.status = 'done';
        if (!tool.result) tool.result = '(no result captured)';
      }
    }
  }

  return bubbles;
}

/**
 * Validate that `sessionFile` is an absolute path inside the configured
 * session root. Prevents IPC callers from passing arbitrary paths to
 * deletion / fork helpers. Returns `null` when valid, an error string
 * otherwise.
 */
function validateSessionFilePath(sessionFile) {
  if (!sessionFile || typeof sessionFile !== 'string') return 'sessionFile is required';
  if (!path.isAbsolute(sessionFile)) return 'sessionFile must be an absolute path';
  const root = process.env.KNOWCLAW_SESSION_ROOT;
  if (!root) return 'KNOWCLAW_SESSION_ROOT is not configured';
  const normalizedRoot = path.resolve(root) + path.sep;
  const normalizedFile = path.resolve(sessionFile);
  if (!normalizedFile.startsWith(normalizedRoot)) return 'sessionFile is outside the session root';
  if (path.extname(normalizedFile).toLowerCase() !== '.jsonl') return 'sessionFile must be a .jsonl';
  return null;
}

/**
 * Read a JSONL session file as an array of parsed entries (one per
 * non-empty line). Skips malformed lines with a console warn — pi
 * itself does the same on load.
 */
function readJsonlEntries(absPath) {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[KnowClaw] skipping malformed JSONL line', i + 1, 'in', absPath, err?.message || err);
    }
  }
  return entries;
}

export function registerKnowClawIpc({
  ipcMain,
  getUserFileRoot,
  getWorkspaceDirs,
  readState,
  getWorkspaceDirOrThrow,
}) {
  if (!ipcMain) throw new Error('registerKnowClawIpc: ipcMain is required');
  if (typeof getUserFileRoot !== 'function') {
    throw new Error('registerKnowClawIpc: getUserFileRoot is required');
  }
  // The next three deps are optional: when missing we still register the
  // IPC channels, but pi sessions are created without IPM customTools.
  const haveToolDeps =
    typeof getWorkspaceDirs === 'function' &&
    typeof readState === 'function' &&
    typeof getWorkspaceDirOrThrow === 'function';

  /** @type {*} */
  let piRuntime = null;
  /** @type {*} */
  let activeSession = null;
  /** @type {Function | null} */
  let activeUnsub = null;
  /** @type {*} */
  let activeSender = null;
  /** @type {boolean} */
  let promptInFlight = false;

  async function ensurePiRuntime() {
    if (piRuntime) return piRuntime;
    piRuntime = await import(/* @vite-ignore */ piRuntimeUrl());
    return piRuntime;
  }

  function pushEvent(sender, sessionId, event) {
    if (!sender || sender.isDestroyed?.()) return;
    try {
      const safe = sanitizeEvent(event);
      sender.send(EVENT_CHANNEL, { sessionId: sessionId || null, ...safe });
    } catch (err) {
      // Last-resort: notify renderer of the serialization failure so it
      // can show a diagnostic rather than silently dropping a turn.
      try {
        sender.send(EVENT_CHANNEL, {
          sessionId: sessionId || null,
          type: 'error',
          source: 'knowclaw-bridge',
          error: String(err?.message || err),
        });
      } catch { /* sender dead */ }
    }
  }

  function disposeCurrentSession() {
    const session = activeSession;
    const unsub = activeUnsub;
    activeSession = null;
    activeUnsub = null;
    promptInFlight = false;
    if (piRuntime?.disposeSession) {
      try { piRuntime.disposeSession(session, unsub); } catch { /* ignore */ }
    } else {
      if (typeof unsub === 'function') { try { unsub(); } catch { /* ignore */ } }
      if (session?.dispose) { try { session.dispose(); } catch { /* ignore */ } }
    }
  }

  /**
   * Ensure an `activeSession` exists, creating one in `continueRecent`
   * mode if not. Returns the created/resumed metadata.
   */
  async function ensureSession(sender, mode = 'continueRecent') {
    if (activeSession) {
      // Rebind sender to the latest invoker so reload-without-newSession
      // still receives events.
      activeSender = sender;
      return {
        ok: true,
        sessionId: activeSession.sessionId || null,
        resumed: false,
        reused: true,
      };
    }

    const runtime = await ensurePiRuntime();
    const cwd = getUserFileRoot();
    const toolDeps = haveToolDeps
      ? {
          getWorkspaceDirs,
          readState,
          getWorkspaceDirOrThrow,
          buildProjectRegistry,
          getProjectDb,
          listEvents,
          listLogs,
        }
      : undefined;

    // Phase 7: read user preferences (e.g. userName) so the runtime can
    // personalize the KnowClaw system prompt. Failures are swallowed —
    // the runtime falls back to a neutral greeting if prefs is empty.
    let prefs = {};
    if (typeof readState === 'function') {
      try {
        const state = readState();
        prefs = state?.prefs && typeof state.prefs === 'object' ? state.prefs : {};
      } catch { /* ignore */ }
    }

    const result = await runtime.createSession({ cwd, mode, toolDeps, prefs });
    if (!result.session) {
      return {
        ok: false,
        sessionId: result.sessionId,
        skipped: Boolean(result.skipped),
        error: result.error,
        sessionFile: result.sessionFile,
      };
    }

    activeSession = result.session;
    activeSender = sender;
    activeUnsub = activeSession.subscribe((event) => {
      pushEvent(activeSender, result.sessionId, event);
    });

    return {
      ok: true,
      sessionId: result.sessionId,
      resumed: Boolean(result.resumed),
      sessionFile: result.sessionFile,
      model: result.model,
    };
  }

  // -------- Request/response handlers --------

  ipcMain.handle('knowclaw:send', async (evt, payload) => {
    const message = String(payload?.message ?? '').trim();
    if (!message) return { ok: false, error: 'empty message' };

    const ensured = await ensureSession(evt.sender);
    if (!ensured.ok) {
      return ensured;
    }

    if (promptInFlight) {
      return { ok: false, error: 'a prompt is already in flight; abort first' };
    }
    promptInFlight = true;

    // Fire and forget: do not block the IPC handle on the LLM turn.
    // The renderer consumes the turn via the `knowclaw:event` channel.
    Promise.resolve()
      .then(() => activeSession.prompt(message))
      .catch((err) => {
        pushEvent(activeSender, activeSession?.sessionId, {
          type: 'error',
          source: 'knowclaw-bridge',
          error: String(err?.message || err),
        });
      })
      .finally(() => {
        promptInFlight = false;
      });

    return { ok: true, sessionId: ensured.sessionId };
  });

  ipcMain.handle('knowclaw:abort', async () => {
    if (!activeSession) return { ok: true, hadSession: false };
    try {
      if (typeof activeSession.abort === 'function') {
        await activeSession.abort();
      }
      return { ok: true, hadSession: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('knowclaw:newSession', async (evt) => {
    disposeCurrentSession();
    return ensureSession(evt.sender, 'new');
  });

  ipcMain.handle('knowclaw:continueRecent', async (evt) => {
    disposeCurrentSession();
    return ensureSession(evt.sender, 'continueRecent');
  });

  ipcMain.handle('knowclaw:listModels', async () => {
    try {
      const runtime = await ensurePiRuntime();
      const models = await runtime.listAvailableModels();
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), models: [] };
    }
  });

  ipcMain.handle('knowclaw:setModel', async (_evt, payload) => {
    const providerId = String(payload?.providerId || '').trim();
    const modelId = String(payload?.modelId || '').trim();
    if (!providerId || !modelId) {
      return { ok: false, error: 'providerId and modelId are required' };
    }
    try {
      const runtime = await ensurePiRuntime();
      await runtime.setModel(providerId, modelId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('knowclaw:getStatus', async () => {
    let config = null;
    try {
      const runtime = await ensurePiRuntime();
      config = runtime.describeCurrentConfig?.() || null;
    } catch { /* ignore */ }
    return {
      ok: true,
      hasSession: Boolean(activeSession),
      sessionId: activeSession?.sessionId || null,
      promptInFlight,
      config,
    };
  });

  // -------- Phase 10: history session UI --------

  ipcMain.handle('knowclaw:listSessions', async () => {
    try {
      const runtime = await ensurePiRuntime();
      const cwd = getUserFileRoot();
      const sessions = await runtime.listSessions(cwd);
      // Convert Date instances to ms-since-epoch so the renderer can
      // render with `Intl.RelativeTimeFormat` without losing fidelity
      // through the `JSON.stringify` IPC boundary (Date → string ISO).
      const safe = sessions.map((s) => ({
        path: s.path,
        id: s.id,
        cwd: s.cwd,
        name: s.name || null,
        created: s.created ? new Date(s.created).getTime() : null,
        modified: s.modified ? new Date(s.modified).getTime() : null,
        messageCount: typeof s.messageCount === 'number' ? s.messageCount : 0,
        firstMessage: s.firstMessage || '',
      }));
      return { ok: true, sessions: safe };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), sessions: [] };
    }
  });

  ipcMain.handle('knowclaw:openSession', async (evt, payload) => {
    const sessionFile = String(payload?.sessionFile || '').trim();
    const pathError = validateSessionFilePath(sessionFile);
    if (pathError) return { ok: false, error: pathError };
    if (!fs.existsSync(sessionFile)) return { ok: false, error: 'sessionFile does not exist' };

    // Tear down any current session to avoid the `ensureSession` reuse
    // path (which would silently keep the old session alive).
    disposeCurrentSession();

    const runtime = await ensurePiRuntime();
    const cwd = getUserFileRoot();
    const toolDeps = haveToolDeps
      ? {
          getWorkspaceDirs,
          readState,
          getWorkspaceDirOrThrow,
          buildProjectRegistry,
          getProjectDb,
          listEvents,
          listLogs,
        }
      : undefined;

    let prefs = {};
    if (typeof readState === 'function') {
      try {
        const state = readState();
        prefs = state?.prefs && typeof state.prefs === 'object' ? state.prefs : {};
      } catch { /* ignore */ }
    }

    let result;
    try {
      result = await runtime.createSession({
        cwd,
        mode: 'open',
        sessionFile,
        toolDeps,
        prefs,
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    if (!result?.session) {
      return {
        ok: false,
        error: result?.error || 'failed to open session',
        sessionId: result?.sessionId || null,
      };
    }

    activeSession = result.session;
    activeSender = evt.sender;
    activeUnsub = activeSession.subscribe((event) => {
      pushEvent(activeSender, result.sessionId, event);
    });

    pushEvent(
      activeSender,
      result.sessionId,
      buildHistoryLoadedEvent(activeSession, result.sessionFile),
    );

    return {
      ok: true,
      sessionId: result.sessionId,
      sessionFile: result.sessionFile,
    };
  });

  ipcMain.handle('knowclaw:deleteSession', async (_evt, payload) => {
    const sessionFile = String(payload?.sessionFile || '').trim();
    const pathError = validateSessionFilePath(sessionFile);
    if (pathError) return { ok: false, error: pathError };

    // If we're deleting the currently-loaded session, drop it first so
    // pi doesn't keep an open file handle on Windows.
    let wasActive = false;
    try {
      const sm = activeSession?.sessionManager;
      const currentFile = typeof sm?.getSessionFile === 'function' ? sm.getSessionFile() : null;
      if (currentFile && path.resolve(currentFile) === path.resolve(sessionFile)) {
        wasActive = true;
        disposeCurrentSession();
      }
    } catch { /* ignore */ }

    try {
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
      }
      return { ok: true, wasActive };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), wasActive };
    }
  });

  ipcMain.handle('knowclaw:forkSession', async (evt, payload) => {
    const sessionFile = String(payload?.sessionFile || '').trim();
    const entryIndexRaw = payload?.entryIndex;
    const pathError = validateSessionFilePath(sessionFile);
    if (pathError) return { ok: false, error: pathError };
    if (!fs.existsSync(sessionFile)) return { ok: false, error: 'sessionFile does not exist' };

    let entries;
    try {
      entries = readJsonlEntries(sessionFile);
    } catch (err) {
      return { ok: false, error: `failed to read source session: ${err?.message || err}` };
    }
    if (entries.length === 0) {
      return { ok: false, error: 'source session is empty' };
    }

    // First entry is the SessionHeader: `{ type: "session", version,
    // id, timestamp, cwd, parentSession? }`. We always preserve it
    // but mint a new `id` for the fork so listSessions does not see
    // two sessions sharing the same UUID.
    const header = entries[0];
    if (!header || typeof header !== 'object' || header.type !== 'session') {
      return { ok: false, error: 'source session is missing a valid header (expected type:"session")' };
    }
    const messageEntries = entries.slice(1);
    if (messageEntries.length === 0) {
      return { ok: false, error: 'source session has no entries to fork from' };
    }

    // Resolve fork point. `entryIndex` is interpreted as a 0-based
    // index into the *message entries* (not including the header).
    // Defaults to "include all" (a plain duplicate that the user can
    // diverge from).
    let cutoff = messageEntries.length;
    if (Number.isFinite(entryIndexRaw)) {
      cutoff = Math.max(1, Math.min(Number(entryIndexRaw) + 1, messageEntries.length));
    }
    const keptEntries = messageEntries.slice(0, cutoff);

    // Mint a new session UUID + filename. Use crypto.randomUUID for
    // the id (matches pi's UUIDv4 footprint closely enough for our
    // listing UI; pi internally uses UUIDv7 but never validates the
    // version on load).
    const { randomUUID } = await import('node:crypto');
    const newId = randomUUID();
    const dir = path.dirname(sessionFile);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const newPath = path.join(dir, `${stamp}_${newId}.jsonl`);

    const newHeader = {
      ...header,
      id: newId,
      // Stamp lineage so we can later show "forked from X" in the UI.
      forkedFrom: header.id || null,
      forkedFromFile: path.basename(sessionFile),
      forkedAt: new Date().toISOString(),
    };

    try {
      const lines = [JSON.stringify(newHeader), ...keptEntries.map((e) => JSON.stringify(e))];
      fs.writeFileSync(newPath, lines.join('\n') + '\n', 'utf-8');
    } catch (err) {
      return { ok: false, error: `failed to write fork: ${err?.message || err}` };
    }

    // Open the new session immediately so the renderer flips to it.
    disposeCurrentSession();
    const runtime = await ensurePiRuntime();
    const cwd = getUserFileRoot();
    const toolDeps = haveToolDeps
      ? {
          getWorkspaceDirs,
          readState,
          getWorkspaceDirOrThrow,
          buildProjectRegistry,
          getProjectDb,
          listEvents,
          listLogs,
        }
      : undefined;
    let prefs = {};
    if (typeof readState === 'function') {
      try {
        const state = readState();
        prefs = state?.prefs && typeof state.prefs === 'object' ? state.prefs : {};
      } catch { /* ignore */ }
    }

    let result;
    try {
      result = await runtime.createSession({
        cwd,
        mode: 'open',
        sessionFile: newPath,
        toolDeps,
        prefs,
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err), sessionFile: newPath };
    }
    if (!result?.session) {
      return {
        ok: false,
        error: result?.error || 'fork created but failed to open',
        sessionFile: newPath,
        sessionId: result?.sessionId || null,
      };
    }

    activeSession = result.session;
    activeSender = evt.sender;
    activeUnsub = activeSession.subscribe((event) => {
      pushEvent(activeSender, result.sessionId, event);
    });

    pushEvent(activeSender, result.sessionId, {
      ...buildHistoryLoadedEvent(activeSession, result.sessionFile),
      forkedFrom: header.id || null,
    });

    return {
      ok: true,
      sessionId: result.sessionId,
      sessionFile: newPath,
      forkedFrom: header.id || null,
      keptEntries: keptEntries.length,
    };
  });
}

/**
 * Build a `history_loaded` event payload from a freshly opened
 * AgentSession. Walks the live `session.messages` array (which
 * resolves the active branch leaf, including compaction). Falls back
 * to an empty list if extraction throws.
 */
function buildHistoryLoadedEvent(session, sessionFile) {
  let historyMessages = [];
  try {
    const piMessages = Array.isArray(session?.messages) ? session.messages : [];
    historyMessages = mapPiMessagesForRenderer(piMessages);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[KnowClaw] history extraction failed:', err?.message || err);
  }
  return {
    type: 'history_loaded',
    messages: historyMessages,
    sessionFile: sessionFile || null,
  };
}
