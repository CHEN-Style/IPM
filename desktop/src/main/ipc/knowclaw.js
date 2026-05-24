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
import { execSync } from 'node:child_process';
import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { app, dialog, shell } from 'electron';

// IPM business helpers used by Phase-5 customTools. These modules live
// in the Vite-bundled main process; pi-runtime (ESM, standalone) cannot
// import them directly, so we inject them as function references via
// `toolDeps` instead.
import { buildProjectRegistry } from '../../../Agent/shared/projectRegistry.js';
import { getProjectDb } from '../../../Agent/db/index.js';
import { listEvents } from '../../../Agent/db/events.js';
import { listLogs } from '../../../Agent/db/activityLog.js';
import { fetchWeb } from '../../../Agent/services/webFetch.js';

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
 *
 * In packaged builds, `Agent/` lives in `app.asar.unpacked/` (because
 * Node's native ESM loader doesn't support loading from inside asar
 * archives). Electron's ASAR patch transparently redirects `fs.*` calls,
 * but `import()` bypasses the patch — so we must explicitly point the
 * URL at the unpacked location when running inside an asar.
 */
function piRuntimeUrl() {
  let p = path.resolve(__dirname, '..', '..', 'Agent', 'pi-runtime', 'index.js');
  if (p.includes('app.asar' + path.sep) || p.includes('app.asar/')) {
    p = p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  }
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
 * U8b: extract image attachments from a pi-style user message content
 * array. pi persists image blocks as
 * `{ type: 'image', mimeType: 'image/jpeg', data: <base64-without-prefix> }`
 * so historical messages can be rehydrated with the same attachments
 * the user originally sent. We pass these straight through to the
 * renderer (the MessageBubble component renders a thumbnail row).
 *
 * Returns `[]` for string content or messages that have no image
 * blocks at all.
 */
function extractImagesFromContent(content) {
  if (!Array.isArray(content)) return [];
  const images = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type !== 'image') continue;
    const mimeType = typeof block.mimeType === 'string' ? block.mimeType : null;
    const data = typeof block.data === 'string' ? block.data : null;
    if (!mimeType || !data) continue;
    images.push({ mimeType, data });
  }
  return images;
}

// U8b-2: IPC-layer image-payload validation.
//
// The renderer is supposed to resize images down to maxEdge=2048 and
// JPEG q=0.85 (see `imageResize.js`), which generally yields base64
// payloads well under 1 MB. We enforce a hard safety ceiling here
// nonetheless — a malicious or buggy renderer should never be able
// to ship a multi-hundred-MB string across IPC and OOM the main
// process.
//
//   - MIME whitelist: only image/jpeg, image/png, image/gif, image/webp.
//     Refused mimes get dropped (no error — UI should pre-filter, but
//     we never throw out of a prompt call over a corrupt attachment).
//   - Per-image cap: 10 MB of base64-encoded data (≈7.5 MB raw bytes).
//     Anything larger is silently dropped; the renderer is responsible
//     for surfacing the count discrepancy.
//   - Batch cap: 8 attachments per prompt. Surplus images are dropped
//     from the tail of the array.
//
// Returns a *fresh* array of `{ mimeType, data }` objects. Returns an
// empty array on any non-array input — never null/undefined, so the
// call sites can branch on `validImages.length`.
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // base64 string length cap
const MAX_IMAGES_PER_PROMPT = 8;

function sanitizeImagesPayload(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const valid = [];
  for (const item of images) {
    if (!item || typeof item !== 'object') continue;
    const mimeType = String(item.mimeType || '').toLowerCase();
    const data = typeof item.data === 'string' ? item.data : '';
    if (!ALLOWED_IMAGE_MIMES.has(mimeType)) continue;
    if (!data) continue;
    if (data.length > MAX_IMAGE_BYTES) continue;
    valid.push({ mimeType, data });
    if (valid.length >= MAX_IMAGES_PER_PROMPT) break;
  }
  return valid;
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
      // U8b-4: pull out any persisted image blocks so the bubble can
      // re-render its attachment row after a session reload / fork.
      // Without this the `image_only` user turns would be filtered
      // out entirely (the legacy check used `if (!text) continue`).
      const images = extractImagesFromContent(msg.content);
      if (!text && images.length === 0) continue;
      // E.5: strip the `[MODE: plan]\n` / `[MODE: agent]\n` prefix that
      // knowclaw:send / steer / followUp inject for the model's benefit.
      // The user typed `text` without the tag; rehydrating bubbles with
      // the tag would be confusing.
      const cleanText = (text || '').replace(/^\[MODE: (?:plan|agent)\]\n/, '');
      const bubble = { role: 'user', content: cleanText, ts };
      if (images.length > 0) bubble.attachments = images;
      bubbles.push(bubble);
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
            // E.2: carry the original LLM `arguments` over to the
            // renderer so historic write/edit bubbles can render
            // their content/diff preview just like live ones do.
            // Without this, reopening a past session showed every
            // file-mutator as a bare "WRITE 写入 path" header with
            // no way to see what was actually written.
            const argsObj = (block.arguments && typeof block.arguments === 'object') ? block.arguments : null;
            tools.push({
              name: String(block.name || 'tool'),
              toolCallId,
              status: 'running', // overwritten when matching toolResult arrives
              ...(argsObj ? { args: argsObj } : {}),
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
 * Read just the JSONL session header (first non-empty line) without
 * parsing the entire file. The header is pi's
 * `{ type: "session", id, cwd, ... }` record. Returns `null` if the
 * file is empty / malformed / not a session JSONL — callers should
 * fall back gracefully.
 */
function readSessionHeader(absPath) {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const newline = raw.indexOf('\n');
    const firstLine = (newline === -1 ? raw : raw.slice(0, newline)).trim();
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine);
    if (parsed && typeof parsed === 'object' && parsed.type === 'session') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
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

// ---- U3: install-guard module (lazy-loaded) ------------------------------
//
// `installGuard.js` lives in `Agent/pi-runtime/tools/` — the same
// pure-ESM tree as the pi runtime entry point. The Electron main bundle
// is Vite-compiled CJS; if we add a top-level `import` to the ESM file
// Vite tries to inline it, which conflicts with `installGuard.js`
// using ESM `export`. We instead lazy-load via `pathToFileURL` +
// dynamic `import()` (same trick as `piRuntimeUrl()` above) and cache
// the resolved module reference on first hit. Failures fall back to
// "no guard" (so `pip install` still works, just without confirmation)
// rather than throwing — better degraded UX than no UX.
let installGuardModule = null;
async function ensureInstallGuard() {
  if (installGuardModule) return installGuardModule;
  try {
    let p = path.resolve(__dirname, '..', '..', 'Agent', 'pi-runtime', 'tools', 'installGuard.js');
    if (p.includes('app.asar' + path.sep) || p.includes('app.asar/')) {
      p = p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    }
    installGuardModule = await import(/* @vite-ignore */ pathToFileURL(p).href);
    return installGuardModule;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[KnowClaw] failed to load installGuard module:', err?.message || err);
    return null;
  }
}

// ---- U3 + bundled-bash: shell resolution ---------------------------------
//
// pi's bash tool resolves the shell at execution time via the
// `getShellConfig` utility: on Windows it prefers Git Bash (looking
// for `bash.exe` on PATH and in the canonical Git for Windows
// install dirs). When neither is present pi throws "No bash shell
// found" at the user, which surfaces as a bewildering error halfway
// through a Skill workflow.
//
// We mirror pi's resolution order here (so our banner matches pi's
// reality 1:1) and additionally tack on a bundled MinGit fallback,
// shipped under `vendor/MinGit/` in dev and `resources/MinGit/` in
// the packaged app. That gives users a one-click "your KnowClaw
// just works, no separate Git install needed" experience.
//
// Resolution order:
//
//   1. `KNOWCLAW_BASH_PATH` env override (tests / manual escape hatch)
//   2. `%ProgramFiles%\Git\bin\bash.exe`
//   3. `%ProgramFiles(x86)%\Git\bin\bash.exe`
//   4. `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`   (per-user Git install)
//   5. PATH lookup (`where bash`)                    — Cygwin, MSYS2, WSL, …
//   6. Bundled MinGit (`<vendor>/usr/bin/bash.exe`)
//
// Result is cached in-memory across IPC calls; the renderer can
// force a rescan via `knowclaw:rescanBash` (e.g. after the user
// has just finished installing Git for Windows in the background).
//
// macOS / Linux: `bash` is always at /bin/bash, so we short-circuit
// to `{ available: true, path: '/bin/bash', source: 'system' }`.

const BASH_SOURCE_OVERRIDE = 'override';
const BASH_SOURCE_SYSTEM = 'system';
const BASH_SOURCE_BUNDLED = 'bundled';

function getBundledMinGitDir() {
  // dev path: `<repo>/desktop/vendor/MinGit/` — colocated with the source
  // tree so `npm start` can pick it up without going through `npm run make`.
  // packaged path: `<resources>/MinGit/` — placed by Electron Forge via
  // `extraResource` (see `forge.config.js`).
  try {
    if (app && app.isPackaged) {
      return path.join(process.resourcesPath, 'MinGit');
    }
  } catch { /* `app` not available in some test contexts */ }
  return path.resolve(__dirname, '..', '..', '..', 'vendor', 'MinGit');
}

function probeBashCandidate(candidate, source) {
  if (!candidate) return null;
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { available: true, path: candidate, source };
    }
  } catch { /* ignore: missing / permission denied / etc. */ }
  return null;
}

let bashResolutionCache = null;
function resolveBashShell() {
  if (bashResolutionCache !== null) return bashResolutionCache;

  if (process.platform !== 'win32') {
    bashResolutionCache = { available: true, path: '/bin/bash', source: BASH_SOURCE_SYSTEM };
    return bashResolutionCache;
  }

  // 1. Explicit override.
  const override = process.env.KNOWCLAW_BASH_PATH;
  if (override) {
    const hit = probeBashCandidate(override, BASH_SOURCE_OVERRIDE);
    if (hit) { bashResolutionCache = hit; return hit; }
  }

  // 2-4. Canonical Git for Windows install locations.
  const candidates = [];
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'));
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  for (const c of candidates) {
    const hit = probeBashCandidate(c, BASH_SOURCE_SYSTEM);
    if (hit) { bashResolutionCache = hit; return hit; }
  }

  // 5. PATH lookup. `where` prints all matches; we take the first
  // and verify it exists (defensive against stale PATH entries).
  try {
    const raw = execSync('where bash', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000, windowsHide: true });
    const first = String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    const hit = probeBashCandidate(first, BASH_SOURCE_SYSTEM);
    if (hit) { bashResolutionCache = hit; return hit; }
  } catch { /* `where` exits non-zero when nothing found — that's fine. */ }

  // 6. Bundled MinGit (last resort). Tries both `usr/bin/bash.exe` (full
  // MinGit/PortableGit layout) and `bin/bash.exe` (some slimmer builds).
  const minGitDir = getBundledMinGitDir();
  const bundledCandidates = [
    path.join(minGitDir, 'usr', 'bin', 'bash.exe'),
    path.join(minGitDir, 'bin', 'bash.exe'),
  ];
  for (const c of bundledCandidates) {
    const hit = probeBashCandidate(c, BASH_SOURCE_BUNDLED);
    if (hit) { bashResolutionCache = hit; return hit; }
  }

  bashResolutionCache = { available: false, path: null, source: null };
  return bashResolutionCache;
}

function clearBashResolutionCache() {
  bashResolutionCache = null;
}

// Legacy API kept so older callers in this file that just want a
// yes/no answer don't need to learn the new shape.
function detectBashAvailable() {
  return resolveBashShell().available;
}

export function registerKnowClawIpc({
  ipcMain,
  getUserFileRoot,
  getWorkspaceDirs,
  readState,
  writeState,
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

  // Whether we can persist user-managed workspace lists (pinned /
  // hidden). When `writeState` was not injected the pin/hide IPCs
  // become best-effort no-ops — features still work for the current
  // run but lose state on reload.
  const canPersist = typeof readState === 'function' && typeof writeState === 'function';

  // ---- U1 hotfix-2: persistent pinned / hidden workspace lists ----
  //
  // We store two arrays inside `state.knowclaw`:
  //
  //   pinnedWorkspaces  — absolute paths the user explicitly added via
  //                       「选择自定义目录…」. They appear in the
  //                       dropdown's "自定义目录" group.
  //   hiddenWorkspaces  — absolute paths the user clicked the "X" on
  //                       in the dropdown. Filtered out of every
  //                       group EXCEPT global. Re-pinning a path
  //                       implicitly removes it from this list.
  //
  // Path normalisation is critical on Windows where `D:\Foo` and
  // `d:/foo` mean the same directory. We always compare/store using
  // `normalizeWorkspacePath` (resolve + lowercase the drive letter).

  function normalizeWorkspacePath(p) {
    try { return path.resolve(String(p)); }
    catch { return null; }
  }

  function pathKey(p) {
    return p ? path.resolve(p).toLowerCase() : '';
  }

  function readKnowClawState() {
    if (typeof readState !== 'function') return {};
    try {
      const state = readState();
      const kc = state?.knowclaw && typeof state.knowclaw === 'object' ? state.knowclaw : {};
      return {
        pinned: Array.isArray(kc.pinnedWorkspaces) ? kc.pinnedWorkspaces.filter((x) => typeof x === 'string') : [],
        hidden: Array.isArray(kc.hiddenWorkspaces) ? kc.hiddenWorkspaces.filter((x) => typeof x === 'string') : [],
        // U6: persistent sub-agent kill-switch. Defaults to `true`
        // (delegate_task registered) — only `false` opts out. We
        // accept the field being missing on first run and lazily
        // create it the first time the user toggles it off.
        subAgentEnabled: kc.subAgentEnabled === false ? false : true,
      };
    } catch {
      return { pinned: [], hidden: [], subAgentEnabled: true };
    }
  }

  function patchKnowClawState(patcher) {
    if (!canPersist) return null;
    try {
      const state = readState() || {};
      const kc = state.knowclaw && typeof state.knowclaw === 'object' ? { ...state.knowclaw } : {};
      const next = patcher({
        pinnedWorkspaces: Array.isArray(kc.pinnedWorkspaces) ? [...kc.pinnedWorkspaces] : [],
        hiddenWorkspaces: Array.isArray(kc.hiddenWorkspaces) ? [...kc.hiddenWorkspaces] : [],
      });
      state.knowclaw = { ...kc, ...next };
      writeState(state);
      return next;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[KnowClaw] patchKnowClawState failed:', err?.message || err);
      return null;
    }
  }

  // ---- U1 hotfix-3: protected workspaces ----
  //
  // The "global" entry plus everything inside IPM's structured roots
  // (projects/, cases/, study/) are treated as first-class business
  // data. Users may never hide them from the dropdown — they're
  // load-bearing for the rest of the app and accidentally hiding a
  // case folder would be confusing. `isProtectedWorkspacePath`
  // returns true if the absolute path is the user file root itself
  // OR sits underneath any of the three structured roots.
  //
  // We do prefix matching (with a trailing-separator boundary so
  // `<projectsRoot>foo` doesn't match) rather than asking the project
  // registry, because some projects (e.g. archived ones) might be
  // missing from the live registry but still live on disk under the
  // protected roots. Path comparisons are case-insensitive on
  // Windows via `pathKey`.
  function isProtectedWorkspacePath(absPath) {
    const targetKey = pathKey(absPath);
    if (!targetKey) return false;
    if (targetKey === pathKey(getUserFileRoot())) return true;
    if (typeof getWorkspaceDirs !== 'function') return false;
    let dirs;
    try { dirs = getWorkspaceDirs() || {}; } catch { return false; }
    const roots = [dirs.projectsRoot, dirs.casesRoot, dirs.studyRoot]
      .filter((r) => typeof r === 'string' && r);
    for (const root of roots) {
      const rootKey = pathKey(root);
      if (!rootKey) continue;
      if (targetKey === rootKey) return true;
      // Use platform-correct separator boundary so `projectsRoot` /
      // `projectsRoot-archived` don't collide.
      if (targetKey.startsWith(rootKey + path.sep.toLowerCase())) return true;
      // Some POSIX-ish callers may have stored forward-slash paths;
      // also accept `/` as a boundary just in case.
      if (targetKey.startsWith(rootKey + '/')) return true;
    }
    return false;
  }

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
  /**
   * In-memory thinking level preference. Survives across sessions
   * within the same Electron run but is intentionally NOT persisted
   * to user prefs in U0 — the next launch resets to 'medium'.
   * @type {'off' | 'minimal' | 'low' | 'medium' | 'high'}
   */
  let currentThinkingLevel = 'medium';

  /**
   * E.5: in-memory Plan-mode flag. When true:
   *   - knowclaw:send prepends `[MODE: plan]\n` to the user message so the
   *     model can switch behaviour per-turn without rebuilding system prompt
   *   - knowclawBeforeToolCall blocks `write` / `edit` / `bash` and
   *     `delegate_task(kind=edit)` as a safety net regardless of what the
   *     model decides to do
   * Same lifetime as `currentThinkingLevel`: in-memory only, resets to
   * `false` on next Electron launch.
   * @type {boolean}
   */
  let currentPlanMode = false;

  /**
   * U1: in-memory dynamic workspace.
   *
   *   null  → "global" mode — cwd falls back to `getUserFileRoot()`
   *           (the historical behaviour). Project context files
   *           (AGENTS.md / CLAUDE.md) are NOT scanned in this mode
   *           because pi would otherwise climb into the user's whole
   *           IPM data root.
   *   path  → "project" mode — cwd is bound to a specific directory
   *           (an IPM project/case/study folder, an imported local
   *           folder, a user-picked custom directory, or a
   *           freshly-created `userfile/workspaces/...` folder).
   *           Context files ARE scanned for this directory.
   *
   * Set via `knowclaw:setCwd` and auto-restored from session metadata
   * when the user opens a historical session via `knowclaw:openSession`.
   * Persists across session creations within the same Electron run
   * (next launch resets to global), mirroring `currentThinkingLevel`'s
   * lifecycle.
   *
   * @type {string | null}
   */
  let currentCwd = null;

  // ---- U3: pending install-confirmation map ----
  //
  // Each entry maps a generated `requestId` to `{ resolve, abortCleanup }`.
  // `resolve(true|false)` is invoked from the IPC reply handler (renderer
  // confirmed/cancelled), from a hard 60s timeout (defensive — the user
  // closed the dialog before answering), or from the pi abort signal
  // (renderer hit "Stop" mid-prompt). After each resolution we remove
  // the entry so duplicate replies are safe no-ops.
  //
  // We deliberately do NOT survive across IPC handler reloads (hot
  // reload during dev) — a stuck pending entry there would block all
  // future tool calls, and the renderer always gets a fresh
  // `onConfirmInstall` subscription on mount anyway.
  /** @type {Map<string, { resolve: (allow: boolean) => void, timer: NodeJS.Timeout | null, onSignalAbort?: () => void, signal?: AbortSignal }>} */
  const pendingConfirmations = new Map();

  // ---- E.5: pending ask_user requests (Plan mode structured questions) ----
  // Same shape as pendingConfirmations but resolves with an answers object
  // (`{ [questionId]: optionId | optionId[] }`) instead of a boolean. The
  // ask_user tool returns this object to the model as its tool result.
  // 5 minute timeout: long enough for thoughtful answers, short enough that
  // a forgotten dialog doesn't pin a session indefinitely.
  /** @type {Map<string, { resolve: (answers: any) => void, timer: NodeJS.Timeout | null, onSignalAbort?: () => void, signal?: AbortSignal }>} */
  const pendingAskUser = new Map();

  async function askUserViaRenderer(questions, signal) {
    const sender = activeSender;
    if (!sender || sender.isDestroyed?.()) {
      return { error: 'no_active_renderer', message: '当前没有活动的前端会话，无法向用户提问' };
    }
    const requestId = nodeRandomUUID();
    return new Promise((resolve) => {
      const finish = (value) => {
        const entry = pendingAskUser.get(requestId);
        if (!entry) return;
        pendingAskUser.delete(requestId);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.signal && entry.onSignalAbort) {
          try { entry.signal.removeEventListener('abort', entry.onSignalAbort); } catch { /* ignore */ }
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish({ timeout: true, message: '用户未在 5 分钟内回复' }), 5 * 60 * 1000);
      const onSignalAbort = () => finish({ aborted: true });
      pendingAskUser.set(requestId, {
        resolve: (answers) => finish(answers),
        timer,
        signal,
        onSignalAbort,
      });
      if (signal) {
        if (signal.aborted) {
          finish({ aborted: true });
          return;
        }
        try { signal.addEventListener('abort', onSignalAbort, { once: true }); } catch { /* older Node */ }
      }

      try {
        sender.send('knowclaw:askUser', { requestId, questions });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[KnowClaw] failed to send ask_user IPC:', err?.message || err);
        finish({ error: 'send_failed', message: String(err?.message || err) });
      }
    });
  }

  /**
   * U3: beforeToolCall hook. Invoked by pi BEFORE every tool call.
   * Returns:
   *   - `undefined`            → allow execution
   *   - `{ block: true, reason }` → pi delivers `reason` to the model
   *                                 as an error result; tool is NOT run
   *
   * Behaviour:
   *   1. Only inspect `bash` calls. Everything else passes through.
   *   2. Classify with `detectInstallCommand`. `block` kind is
   *      short-circuited synchronously with the parser's `reason`.
   *      `install` kind opens a roundtrip to the renderer.
   *   3. If no renderer is attached (e.g. tests, abort race), we
   *      conservatively block the install — running `pip install`
   *      silently without ANY user awareness is worse than failing
   *      loudly.
   *
   * The pi abort signal is honoured: when the user clicks "Stop" we
   * resolve the pending confirmation as `false` and let agent-loop
   * surface its own AbortError.
   */
  async function knowclawBeforeToolCall(event, signal) {
    // E.5: Plan-mode safety net. The system prompt already instructs the
    // model to avoid write tools in plan mode, but we enforce hard-block
    // here so prompt drift / jailbreaks can't accidentally mutate user
    // files. The reason text is returned to the model as a tool error
    // result so it can recover gracefully (typically by switching to
    // ask_user / save_plan instead).
    if (currentPlanMode && event?.toolCall?.name) {
      const name = event.toolCall.name;
      // Cover both possible pi builtin names (write vs write_file). Today
      // only `write`/`edit` are emitted, but legacy aliases may exist.
      const BLOCKED_IN_PLAN = new Set(['write', 'write_file', 'edit', 'edit_file', 'bash']);
      if (BLOCKED_IN_PLAN.has(name)) {
        return {
          block: true,
          reason:
            '当前为 Plan 模式，禁止执行写入/编辑/Shell 命令。请用只读工具（read/list_files/grep 等）继续收集信息，' +
            '用 ask_user 向用户确认细节，用 save_plan 保存方案。规划完成后由用户点击「开始执行」切换到 Agent 模式。',
        };
      }
      if (name === 'delegate_task') {
        const kind = event?.args?.kind || 'research';
        if (kind === 'edit') {
          return {
            block: true,
            reason:
              '当前为 Plan 模式，不允许启动 kind="edit" 的写入类子代理。可以改用 kind="research" 的只读子代理收集信息。',
          };
        }
      }
    }

    if (!event || event.toolCall?.name !== 'bash') return undefined;
    const command = String(event.args?.command || '').trim();
    if (!command) return undefined;

    const guard = await ensureInstallGuard();
    if (!guard?.detectInstallCommand) return undefined;
    const detected = guard.detectInstallCommand(command);
    if (!detected) return undefined;

    if (detected.kind === 'block') {
      return { block: true, reason: detected.reason };
    }

    // install kind: ask the renderer.
    const sender = activeSender;
    if (!sender || sender.isDestroyed?.()) {
      return {
        block: true,
        reason:
          '当前没有活动的前端会话，无法弹出安装确认。请用户在 KnowClaw 界面重新发起请求，或在终端中手动执行：\n  ' +
          command,
      };
    }
    const requestId = nodeRandomUUID();
    const cwd = getEffectiveCwd();

    const allowed = await new Promise((resolve) => {
      const finish = (value) => {
        const entry = pendingConfirmations.get(requestId);
        if (!entry) return; // already resolved
        pendingConfirmations.delete(requestId);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.signal && entry.onSignalAbort) {
          try { entry.signal.removeEventListener('abort', entry.onSignalAbort); } catch { /* ignore */ }
        }
        resolve(value);
      };

      const timer = setTimeout(() => finish(false), 60_000);
      const onSignalAbort = () => finish(false);
      pendingConfirmations.set(requestId, {
        resolve: (allow) => finish(Boolean(allow)),
        timer,
        signal,
        onSignalAbort,
      });
      if (signal) {
        if (signal.aborted) {
          finish(false);
          return;
        }
        try { signal.addEventListener('abort', onSignalAbort, { once: true }); } catch { /* older Node */ }
      }

      try {
        sender.send('knowclaw:confirm-install', {
          requestId,
          manager: detected.manager,
          packages: detected.packages,
          command,
          segment: detected.segment,
          cwd,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[KnowClaw] failed to send confirm-install IPC:', err?.message || err);
        finish(false);
      }
    });

    if (allowed) return undefined;
    return {
      block: true,
      reason:
        '用户拒绝了依赖安装。请向用户解释：可以稍后在终端中手动执行：\n  ' +
        command +
        '\n执行完毕后告诉 KnowClaw 重试即可继续。',
    };
  }

  /**
   * Compute the cwd to hand to pi for the *next* session creation.
   * Always normalised to an absolute path so pi's session JSONL
   * encodes the cwd consistently (and `listSessions` can match
   * sessions back to their workspace).
   */
  function getEffectiveCwd() {
    if (currentCwd) {
      try {
        return path.resolve(currentCwd);
      } catch {
        return getUserFileRoot();
      }
    }
    return getUserFileRoot();
  }

  /**
   * U1: when a turn finishes (or a session is opened), pi is the
   * source of truth for `noContextFiles` semantics. We pass `false`
   * (i.e. "do scan AGENTS.md/CLAUDE.md") whenever the user has
   * explicitly chosen a workspace; otherwise we keep the legacy
   * `true` to avoid pi climbing the IPM data tree.
   */
  function shouldDisableContextFiles() {
    return !currentCwd;
  }

  async function ensurePiRuntime() {
    if (piRuntime) return piRuntime;
    // Resolve bash once and surface the chosen path to pi-runtime via an
    // env var. pi-runtime's `bootstrap.js` reads `KNOWCLAW_BASH_PATH`
    // and writes it into pi's `settings.json` so the SDK's
    // `getShellConfig()` uses our absolute path rather than its own
    // PATH/known-locations scan. This is what lets a bundled MinGit
    // work without ever touching the system PATH.
    try {
      const resolved = resolveBashShell();
      if (resolved.available && resolved.path) {
        process.env.KNOWCLAW_BASH_PATH = resolved.path;
      }
    } catch { /* non-fatal: pi will fall back to its own probe */ }
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
    // U3: drain any pending install confirmations belonging to the
    // session we just tore down. The abort signal each entry holds
    // probably aborted them already, but resolve them defensively as
    // "denied" so nothing remains in the map waiting on a renderer
    // reply that will never come.
    for (const [requestId, entry] of pendingConfirmations) {
      try { entry.resolve(false); }
      catch { /* finish() already removed entry */ }
      pendingConfirmations.delete(requestId);
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
    const cwd = getEffectiveCwd();
    const toolDeps = haveToolDeps
      ? {
          getWorkspaceDirs,
          readState,
          getWorkspaceDirOrThrow,
          buildProjectRegistry,
          getProjectDb,
          listEvents,
          listLogs,
          // K1: bridge to main-process F2 webFetch.fetchWeb so the pi-runtime
          // `fetch_web` tool can run pages through Electron's BrowserWindow
          // for JS-heavy SPAs (rendered: true) and return Markdown bodies.
          fetchWebRendered: async (url, opts = {}) => {
            return fetchWeb(url, { mode: 'auto', screenshot: false, ...(opts || {}) });
          },
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

    // U6: read the persistent sub-agent kill-switch from state.json.
    // `readKnowClawState` defaults the flag to `true` when missing
    // (first run / no state file), so this is safe to call
    // unconditionally even when `readState` is the no-op fallback.
    const { subAgentEnabled } = readKnowClawState();

    const result = await runtime.createSession({
      cwd,
      mode,
      toolDeps,
      prefs,
      thinkingLevel: currentThinkingLevel,
      noContextFiles: shouldDisableContextFiles(),
      beforeToolCall: knowclawBeforeToolCall,
      subAgentEnabled,
      // E.5: thread the ask_user IPC bridge into the runtime so the
      // ask_user customTool can pause execution and await the renderer
      // reply. Same lifetime as the session — the closure captures the
      // bound `activeSender` via askUserViaRenderer.
      askUser: askUserViaRenderer,
    });
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
    // U8b-2: image attachments are optional. An empty message is still
    // refused, but a text-less prompt that carries images is allowed
    // (e.g. "what's in this screenshot?" with the question typed
    // earlier and only the screenshot pasted now). pi accepts an
    // empty string with non-empty `images` array.
    const validImages = sanitizeImagesPayload(payload?.images);
    if (!message && validImages.length === 0) {
      return { ok: false, error: 'empty message' };
    }

    // D.2: defensive default. The renderer side now eagerly creates
    // a session on workspace switch / cold start / model change, so
    // `activeSession` is normally non-null when we get here and the
    // mode parameter is irrelevant (the first branch of
    // ensureSession returns `{ reused: true }`). However if any of
    // those eager-creation paths failed silently (network blip,
    // hot-reload race) we don't want the first user message to
    // walk through `continueRecent` and silently resurrect an
    // unrelated old JSONL — that's the exact pathology D.2 is
    // closing. Default to `'new'` so the fallback is a fresh
    // session, not a surprise resume.
    const ensured = await ensureSession(evt.sender, 'new');
    if (!ensured.ok) {
      return ensured;
    }

    if (promptInFlight) {
      return { ok: false, error: 'a prompt is already in flight; abort first' };
    }
    promptInFlight = true;

    // Fire and forget: do not block the IPC handle on the LLM turn.
    // The renderer consumes the turn via the `knowclaw:event` channel.
    const promptOptions = validImages.length > 0 ? { images: validImages } : undefined;
    // E.5: tag the prompt with the current mode so the model can switch
    // behaviour per-turn without a session rebuild. The renderer strips
    // this prefix back out in mapPiMessagesForRenderer so the user
    // bubble shows the original text on rehydrate.
    const taggedMessage = currentPlanMode ? `[MODE: plan]\n${message}` : message;
    Promise.resolve()
      .then(() => activeSession.prompt(taggedMessage, promptOptions))
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
    // U4: drain queued steer/followUp messages BEFORE aborting. Default
    // pi behaviour keeps queued messages around, so a subsequent
    // (unrelated) prompt would silently flush them at the next run
    // start — the user clicked "中止" because they wanted to stop,
    // not because they wanted to reschedule. clearQueue() is sync and
    // emits a `queue_update` event with empty arrays, which the
    // renderer uses to drop its pendingSteer/pendingFollowUp state.
    let queueCleared = false;
    try {
      if (typeof activeSession.clearQueue === 'function') {
        activeSession.clearQueue();
        queueCleared = true;
      }
    } catch { /* best-effort: never block abort on queue failure */ }
    try {
      if (typeof activeSession.abort === 'function') {
        await activeSession.abort();
      }
      return { ok: true, hadSession: true, queueCleared };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), queueCleared };
    }
  });

  // ---- U4: steer / followUp / clearQueue ----
  //
  // These map 1:1 onto pi's `AgentSession` methods. Three guard rails:
  //   (a) `activeSession` must exist;
  //   (b) for steer/followUp, the session must be streaming — otherwise
  //       the message would sit in the queue indefinitely (pi enqueues
  //       it but only drains at next run boundary). We surface this
  //       to the renderer as an error so the optimistic user bubble
  //       can be rolled back; the renderer's normal `sendMessage`
  //       path covers the non-streaming case anyway;
  //   (c) pi's `steer`/`followUp` throw for `/extension-command` text
  //       (they can't be queued, only run synchronously). We catch
  //       and surface that as a structured error too.
  ipcMain.handle('knowclaw:steer', async (_evt, payload) => {
    const message = String(payload?.message ?? '').trim();
    // U8b-2: steer/followUp accept the same `{ images }` second-arg
    // shape that `prompt()` does (see pi-coding-agent AgentSession).
    // Same empty-payload + sanitisation policy as `knowclaw:send`.
    const validImages = sanitizeImagesPayload(payload?.images);
    if (!message && validImages.length === 0) return { ok: false, error: 'empty message' };
    if (!activeSession) return { ok: false, error: 'no active session' };
    if (!activeSession.isStreaming) {
      return { ok: false, error: 'session is not streaming' };
    }
    try {
      const opts = validImages.length > 0 ? { images: validImages } : undefined;
      // E.5: tag steer/followUp with the current mode too — otherwise a
      // followUp during plan mode would arrive un-tagged and the model
      // could revert to agent behaviour mid-turn.
      const tagged = currentPlanMode ? `[MODE: plan]\n${message}` : message;
      await activeSession.steer(tagged, opts);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('knowclaw:followUp', async (_evt, payload) => {
    const message = String(payload?.message ?? '').trim();
    const validImages = sanitizeImagesPayload(payload?.images);
    if (!message && validImages.length === 0) return { ok: false, error: 'empty message' };
    if (!activeSession) return { ok: false, error: 'no active session' };
    if (!activeSession.isStreaming) {
      return { ok: false, error: 'session is not streaming' };
    }
    try {
      const opts = validImages.length > 0 ? { images: validImages } : undefined;
      const tagged = currentPlanMode ? `[MODE: plan]\n${message}` : message;
      await activeSession.followUp(tagged, opts);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('knowclaw:clearQueue', async () => {
    if (!activeSession) return { ok: false, error: 'no active session' };
    try {
      const cleared = typeof activeSession.clearQueue === 'function'
        ? activeSession.clearQueue()
        : { steering: [], followUp: [] };
      // pi's clearQueue returns `{ steering, followUp }` arrays of the
      // strings that *were* in flight — handy for the UI if it ever
      // wants to show "已清空 N 条" toast. We pass them through.
      return { ok: true, cleared };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // ---- U5: manual context compaction ----
  //
  // Wraps `session.compact(customInstructions?)`. pi handles the
  // heavy lifting (disconnect agent, prepare, summarize, rebuild
  // `agent.state.messages`, persist) and emits a
  // `compaction_start` / `compaction_end` pair we already forward to
  // the renderer via `activeSession.subscribe`, so the UI gets the
  // progress banner for free.
  //
  // Three guard rails:
  //   (a) `activeSession` must exist;
  //   (b) pi internally calls `agent.abort()` before compacting, but
  //       triggering it during a user-visible streaming turn is still
  //       confusing UX — we return an error and let the renderer
  //       gate its button on `!streaming`;
  //   (c) any throw from pi (model unavailable, abort race) returns
  //       `{ ok: false, error }`; the corresponding `compaction_end`
  //       event with `aborted=true` / `errorMessage` will also arrive
  //       so the renderer can clear its banner either way.
  ipcMain.handle('knowclaw:compact', async (_evt, payload) => {
    if (!activeSession) return { ok: false, error: 'no active session' };
    if (activeSession.isStreaming) {
      return { ok: false, error: 'cannot compact while a turn is streaming — abort or wait, then retry' };
    }
    if (typeof activeSession.compact !== 'function') {
      return { ok: false, error: 'compact is not supported by this pi version' };
    }
    const customInstructions = typeof payload?.customInstructions === 'string'
      ? payload.customInstructions
      : undefined;
    try {
      const result = await activeSession.compact(customInstructions);
      return { ok: true, result };
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

  // U0 (revised): change thinking depth.
  //
  // We always honour the user's choice. Internally pi-ai's
  // `AgentSession.setThinkingLevel()` will clamp the value to the
  // model's declared support — but because `pi-runtime/models.js` now
  // registers every IPM model with `reasoning: true`, that clamp is
  // a no-op (`getSupportedThinkingLevels` returns all levels except
  // 'xhigh'). Even so, we *return the user-requested level* to the
  // renderer rather than the clamped value, so the UI never silently
  // reverts the user's selection. If thinking never produces content
  // at runtime, the renderer will surface a soft hint after the turn
  // ends.
  ipcMain.handle('knowclaw:setThinkingLevel', async (_evt, payload) => {
    const level = String(payload?.level || '').trim();
    const validLevels = ['off', 'minimal', 'low', 'medium', 'high'];
    if (!validLevels.includes(level)) {
      return {
        ok: false,
        error: `invalid level: ${level}. Must be one of: ${validLevels.join(', ')}`,
      };
    }
    currentThinkingLevel = level;
    if (activeSession && typeof activeSession.setThinkingLevel === 'function') {
      try {
        activeSession.setThinkingLevel(level);
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
      return { ok: true, level };
    }
    return { ok: true, level, deferred: true };
  });

  // ===== U1: dynamic workspace =====
  //
  // The "current workspace" is a single in-memory cwd that all newly
  // created pi sessions inherit. Switching workspaces is a hard
  // session boundary (pi's AgentSession binds cwd at creation time
  // and provides no runtime mutation), so the contract here is:
  //
  //   1. Caller invokes `setCwd` with an absolute directory path or
  //      `null` ("global" / userfile root).
  //   2. We dispose the active session — the renderer is expected to
  //      clear its visible transcript when it sees `ok: true`.
  //   3. The next `send` triggers `ensureSession`, which picks up the
  //      new cwd via `getEffectiveCwd()` and creates a fresh pi
  //      session under the workspace's dedicated session directory.

  ipcMain.handle('knowclaw:setCwd', async (_evt, payload) => {
    const raw = payload?.cwd;
    let nextCwd = null;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      try {
        nextCwd = path.resolve(String(raw).trim());
      } catch (err) {
        return { ok: false, error: `invalid cwd: ${err?.message || err}` };
      }
      if (!fs.existsSync(nextCwd)) {
        return { ok: false, error: `目录不存在: ${nextCwd}` };
      }
      let stat;
      try { stat = fs.statSync(nextCwd); } catch (err) {
        return { ok: false, error: `无法访问目录: ${err?.message || err}` };
      }
      if (!stat.isDirectory()) {
        return { ok: false, error: `不是文件夹: ${nextCwd}` };
      }
      // Treat the user file root as "global" — collapsing both spellings
      // (null vs. literal userfile path) keeps the UI badge consistent.
      if (path.resolve(nextCwd) === path.resolve(getUserFileRoot())) {
        nextCwd = null;
      }
    }

    currentCwd = nextCwd;
    // The active session is bound to the *old* cwd; tear it down so
    // the next `send` rebuilds with the new workspace.
    disposeCurrentSession();

    return {
      ok: true,
      cwd: getEffectiveCwd(),
      isGlobal: !currentCwd,
    };
  });

  ipcMain.handle('knowclaw:getCwd', async () => {
    return {
      ok: true,
      cwd: getEffectiveCwd(),
      isGlobal: !currentCwd,
      userFileRoot: getUserFileRoot(),
    };
  });

  ipcMain.handle('knowclaw:listWorkspaces', async () => {
    /** @type {Array<{name:string, domain:string, path:string, isGlobal?:boolean, status?:string}>} */
    const workspaces = [];

    // Hidden set: any non-global path the user has chosen to remove
    // from the dropdown. Compared case-insensitively because Windows
    // paths from `dialog.showOpenDialog` may differ in casing from
    // paths we resolve ourselves.
    const { hidden } = readKnowClawState();
    const hiddenSet = new Set(
      hidden.map((p) => pathKey(p)).filter(Boolean),
    );
    const seen = new Set();

    function tryAdd(entry) {
      if (!entry?.path) return false;
      const key = pathKey(entry.path);
      if (!key) return false;
      if (seen.has(key)) return false;
      // Tag protected entries up-front so the renderer doesn't have
      // to re-derive the rule. Protected = global OR anywhere under
      // IPM's three structured roots. Protected entries are also
      // exempt from the hide filter (defence in depth — even if a
      // protected path somehow ended up in `hiddenWorkspaces`, we
      // still surface it).
      const isProtected = Boolean(entry.isGlobal) || isProtectedWorkspacePath(entry.path);
      if (!isProtected && hiddenSet.has(key)) return false;
      seen.add(key);
      workspaces.push(isProtected ? { ...entry, protected: true } : entry);
      return true;
    }

    // 1) Global — always first, always present, never hideable.
    tryAdd({
      name: '全局',
      domain: 'global',
      path: getUserFileRoot(),
      isGlobal: true,
    });

    // 2) IPM project / case / study folders — reuse the same registry
    //    that powers the legacy KnowClaw `list_projects` tool. Skipped
    //    when toolDeps weren't injected at `registerKnowClawIpc` time.
    //
    // F1: For attached projects (external folder import), surface the
    // *external* root path as the workspace cwd rather than the shell
    // directory. Otherwise pi Agent's `ls`/`read`/`write` tools would
    // only see `meta/` `temp/` `snippets/` and miss all the actual
    // business content. We fall back to the shell when the link is
    // broken so pi doesn't crash on a non-existent cwd.
    if (haveToolDeps) {
      try {
        const registry = buildProjectRegistry({
          ...getWorkspaceDirs(),
          readState,
        });
        for (const entry of Array.isArray(registry) ? registry : []) {
          const wsPath = (entry.attached && entry.contentRoot && !entry.broken)
            ? entry.contentRoot
            : entry.path;
          tryAdd({
            name: entry.attached ? `${entry.name}（外挂）` : entry.name,
            domain: entry.domain,
            path: wsPath,
            status: entry.status,
            // F1: 让前端 WorkspaceSelector 能区分附属壳并展示警告。
            attached: Boolean(entry.attached),
            broken: Boolean(entry.broken),
            externalRootPath: entry.externalRootPath || '',
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[KnowClaw] listWorkspaces: project registry failed:', err?.message || err);
      }
    }

    // 3) KnowClaw-managed workspaces: every subdirectory of
    //    `<userFileRoot>/workspaces/`. This is the destination for
    //    the "新建工作空间" button (which creates timestamped
    //    folders here), and the IPM data root is stable across runs,
    //    so scanning the directory gives us a self-healing source of
    //    truth — newly-created workspaces show up automatically and
    //    deleted ones drop off without needing a state file.
    const workspacesRoot = path.join(getUserFileRoot(), 'workspaces');
    if (fs.existsSync(workspacesRoot)) {
      try {
        const entries = fs.readdirSync(workspacesRoot, { withFileTypes: true });
        // Sort by modified time (newest first) so recent workspaces
        // surface to the top of the group.
        const dirs = entries
          .filter((e) => e.isDirectory())
          .map((e) => {
            const abs = path.join(workspacesRoot, e.name);
            let mtime = 0;
            try { mtime = fs.statSync(abs).mtimeMs; } catch { /* ignore */ }
            return { name: e.name, abs, mtime };
          })
          .sort((a, b) => b.mtime - a.mtime);
        for (const d of dirs) {
          tryAdd({
            name: d.name,
            domain: 'workspaces',
            path: d.abs,
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[KnowClaw] listWorkspaces: scan workspaces dir failed:', err?.message || err);
      }
    }

    // 4) Pinned custom directories — added by the user via
    //    「选择自定义目录…」 and persisted in
    //    `state.knowclaw.pinnedWorkspaces`. These paths typically
    //    live OUTSIDE userfile/, so they are the only way external
    //    folders (e.g. `D:\my-code`) can appear in the dropdown.
    //    Filter dead paths so the user isn't tricked into selecting
    //    something that no longer exists.
    {
      const { pinned } = readKnowClawState();
      for (const raw of pinned) {
        const abs = normalizeWorkspacePath(raw);
        if (!abs) continue;
        let exists = false;
        try { exists = fs.existsSync(abs) && fs.statSync(abs).isDirectory(); }
        catch { exists = false; }
        if (!exists) continue;
        tryAdd({
          name: path.basename(abs) || abs,
          domain: 'pinned',
          path: abs,
        });
      }
    }

    // 5) Imported local folders (the same list users manage from the
    //    Local Folders panel). Read directly from `state.localFolders`
    //    rather than calling the localFolders IPC channel from inside
    //    the main process. Filter out paths that no longer exist so
    //    the dropdown never points at dead entries.
    if (typeof readState === 'function') {
      try {
        const state = readState();
        const arr = Array.isArray(state?.localFolders) ? state.localFolders : [];
        for (const raw of arr) {
          const abs = normalizeWorkspacePath(raw);
          if (!abs) continue;
          let exists = false;
          try { exists = fs.existsSync(abs) && fs.statSync(abs).isDirectory(); }
          catch { exists = false; }
          if (!exists) continue;
          tryAdd({
            name: path.basename(abs) || abs,
            domain: 'local',
            path: abs,
          });
        }
      } catch { /* ignore */ }
    }

    return { ok: true, workspaces };
  });

  // ---- U1 hotfix-2: pin / hide workspaces ----

  // Add a path to `state.knowclaw.pinnedWorkspaces` and implicitly
  // unhide it (re-pinning is the simplest way for users to recover a
  // workspace they previously hid). Returns the post-update arrays
  // for client-side cache invalidation.
  ipcMain.handle('knowclaw:pinWorkspace', async (_evt, payload) => {
    const abs = normalizeWorkspacePath(payload?.path);
    if (!abs) return { ok: false, error: 'path is required' };
    if (!fs.existsSync(abs)) return { ok: false, error: `目录不存在: ${abs}` };
    if (!canPersist) {
      // Without persistence the pin disappears on reload, but we still
      // succeed so the renderer doesn't show a confusing error.
      return { ok: true, persisted: false, path: abs };
    }
    const updated = patchKnowClawState((cur) => {
      const seenPinned = new Set(cur.pinnedWorkspaces.map((p) => pathKey(p)));
      const next = [...cur.pinnedWorkspaces];
      if (!seenPinned.has(pathKey(abs))) next.push(abs);
      const nextHidden = cur.hiddenWorkspaces.filter((p) => pathKey(p) !== pathKey(abs));
      return { pinnedWorkspaces: next, hiddenWorkspaces: nextHidden };
    });
    return { ok: true, persisted: true, path: abs, knowclaw: updated };
  });

  // Hide a workspace from the dropdown. The path itself is NOT
  // touched on disk — this is a per-user dropdown filter. Protected
  // paths (global root + everything under projects/cases/study) are
  // hard-rejected here, mirroring the UI gate, so a misbehaving
  // renderer can't sneak business data out of view.
  ipcMain.handle('knowclaw:hideWorkspace', async (_evt, payload) => {
    const abs = normalizeWorkspacePath(payload?.path);
    if (!abs) return { ok: false, error: 'path is required' };
    if (isProtectedWorkspacePath(abs)) {
      return { ok: false, error: '该工作空间为系统默认（全局 / 项目 / 案件 / 学习），不可隐藏' };
    }
    if (!canPersist) {
      return { ok: true, persisted: false, path: abs };
    }
    const updated = patchKnowClawState((cur) => {
      // Remove from pinned (if present) AND add to hidden so a
      // pinned-then-hidden directory doesn't bounce back next render.
      const nextPinned = cur.pinnedWorkspaces.filter((p) => pathKey(p) !== pathKey(abs));
      const seenHidden = new Set(cur.hiddenWorkspaces.map((p) => pathKey(p)));
      const nextHidden = [...cur.hiddenWorkspaces];
      if (!seenHidden.has(pathKey(abs))) nextHidden.push(abs);
      return { pinnedWorkspaces: nextPinned, hiddenWorkspaces: nextHidden };
    });
    return { ok: true, persisted: true, path: abs, knowclaw: updated };
  });

  ipcMain.handle('knowclaw:chooseDirectory', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: '选择 KnowClaw 工作空间目录',
      });
      if (result.canceled || !result.filePaths?.length) {
        return { ok: false, canceled: true };
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // U1 (post-fix): open a workspace folder in the OS file manager.
  // Defaults to the *active* workspace when no path is supplied so
  // the UI's "打开文件夹" button can be a single-click affordance.
  // Returns `{ ok, path }` with the absolute path that was opened so
  // the renderer can show a confirmation toast.
  //
  // K2: also used to open *files* clicked in the WorkspaceFileTree.
  // `shell.openPath` handles both directories and files natively, so
  // we only need to relax the error wording.
  ipcMain.handle('knowclaw:openInExplorer', async (_evt, payload) => {
    let target = payload?.path ? String(payload.path).trim() : '';
    if (!target) target = getEffectiveCwd();
    let resolved;
    try { resolved = path.resolve(target); } catch (err) {
      return { ok: false, error: `invalid path: ${err?.message || err}` };
    }
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `路径不存在: ${resolved}` };
    }
    try {
      // shell.openPath returns '' on success, or an error message
      // string on failure (per Electron's documented contract).
      const errMsg = await shell.openPath(resolved);
      if (errMsg) return { ok: false, error: errMsg, path: resolved };
      return { ok: true, path: resolved };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // E.7 — drop external files into the current workspace.
  //
  // Inputs:
  //   filePaths:   array of absolute source paths (from the renderer's
  //                `dataTransfer.files[i].path` — Electron exposes that
  //                non-standard property, plain Web doesn't)
  //   destRelDir?: target directory relative to the workspace cwd; '' or
  //                missing = workspace root.
  //
  // Output:
  //   { ok, uploaded: [{ name, relPath, size, src }], skipped: [{ src, reason }] }
  //
  // Safety:
  //   - cwd must be a real workspace folder (not global mode)
  //   - destAbsDir must resolve INSIDE cwd (defeats `../` traversal)
  //   - per-file size cap = 100 MB (way over the typical office doc size,
  //     under enough to avoid surprise OOM on `copyFileSync` of giant blobs)
  //   - name collision policy: `name (1).ext`, `name (2).ext`, ... never
  //     overwrites existing files. This matches Finder / Explorer when
  //     you drop into a folder that already contains a same-named file.
  //   - directories in `filePaths` are skipped with a reason. We don't
  //     try to recurse — the user can drag the parent's contents instead.
  ipcMain.handle('knowclaw:uploadToWorkspace', async (_evt, payload) => {
    const MAX_BYTES = 100 * 1024 * 1024; // 100 MB / file
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    if (filePaths.length === 0) {
      return { ok: false, error: 'no files supplied', uploaded: [], skipped: [] };
    }

    // Global mode has no real cwd, just the user file root which is
    // shared across projects/cases/etc. Refuse to copy there — the
    // user must pick or create a workspace first.
    if (!currentCwd) {
      return {
        ok: false,
        error: '请先选择一个工作空间，再上传文件。',
        uploaded: [], skipped: [],
      };
    }

    const cwd = getEffectiveCwd();
    const rawDest = typeof payload?.destRelDir === 'string' ? payload.destRelDir : '';
    let destAbsDir;
    try {
      destAbsDir = path.resolve(cwd, rawDest);
    } catch (err) {
      return { ok: false, error: `invalid destRelDir: ${err?.message || err}`, uploaded: [], skipped: [] };
    }
    // Containment check — destAbsDir must be at or under cwd.
    const cwdReal = path.resolve(cwd);
    const destReal = path.resolve(destAbsDir);
    const rel = path.relative(cwdReal, destReal);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, error: '目标目录必须在工作空间内', uploaded: [], skipped: [] };
    }
    if (!fs.existsSync(destReal)) {
      // The caller may legitimately request a subfolder that exists in
      // the tree snapshot. If it's been deleted between hover and drop
      // we surface a clear error instead of silently creating it.
      return { ok: false, error: `目标目录不存在: ${destReal}`, uploaded: [], skipped: [] };
    }
    let destStat;
    try { destStat = fs.statSync(destReal); } catch (err) {
      return { ok: false, error: `无法读取目标目录: ${err?.message || err}`, uploaded: [], skipped: [] };
    }
    if (!destStat.isDirectory()) {
      return { ok: false, error: '目标必须是目录', uploaded: [], skipped: [] };
    }

    const uploaded = [];
    const skipped = [];

    for (const raw of filePaths) {
      const src = typeof raw === 'string' ? raw.trim() : '';
      if (!src) { skipped.push({ src: String(raw), reason: 'empty path' }); continue; }
      let srcStat;
      try { srcStat = fs.statSync(src); } catch (err) {
        skipped.push({ src, reason: `无法访问: ${err?.code || err?.message || err}` });
        continue;
      }
      if (srcStat.isDirectory()) {
        skipped.push({ src, reason: '不支持上传目录' });
        continue;
      }
      if (!srcStat.isFile()) {
        skipped.push({ src, reason: '不是普通文件' });
        continue;
      }
      if (srcStat.size > MAX_BYTES) {
        skipped.push({ src, reason: `文件超出 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限` });
        continue;
      }
      const base = path.basename(src);
      const finalName = nextAvailableName(destReal, base);
      const destFile = path.join(destReal, finalName);
      try {
        // copyFile, not rename: the source may live on a different
        // volume, and we never want to remove the user's original.
        fs.copyFileSync(src, destFile);
      } catch (err) {
        skipped.push({ src, reason: `复制失败: ${err?.message || err}` });
        continue;
      }
      const finalRel = path
        .relative(cwdReal, destFile)
        .split(path.sep)
        .join('/'); // normalise for renderer display + LLM read_file usage
      uploaded.push({
        name: finalName,
        relPath: finalRel,
        size: srcStat.size,
        src,
      });
    }

    return {
      ok: uploaded.length > 0 || skipped.length === 0,
      uploaded,
      skipped,
    };
  });

  // Helper for uploadToWorkspace name-collision resolution. Returns
  // the original name if it's free, otherwise `base (1).ext` /
  // `base (2).ext` / ... up to a generous 999 to avoid runaway loops
  // on a pathological directory.
  function nextAvailableName(dir, name) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) return name;
    const ext = path.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    for (let i = 1; i < 1000; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!fs.existsSync(path.join(dir, candidate))) return candidate;
    }
    // Pathological: fall back to a timestamp suffix so we don't loop forever.
    return `${stem} (${Date.now()})${ext}`;
  }

  // K2 — list the workspace file tree as a flat node array.
  //
  // Inputs:
  //   path?:  override the active cwd (used by callers that want to
  //           preview a workspace before switching to it). Defaults to
  //           `getEffectiveCwd()`.
  //   depth?: max recursion depth (1..6). Defaults to 3, hard-capped
  //           at 6 to keep responses small.
  //
  // Output (always shaped like this so the renderer doesn't have to
  // branch on missing fields):
  //   {
  //     ok: boolean,
  //     cwd: string,                 // absolute, resolved
  //     global: boolean,             // true when cwd === getUserFileRoot()
  //     entries: TreeEntry[],        // flat list; [] for the global case
  //     truncated: boolean,          // true if MAX_ENTRIES hit
  //     error?: string,
  //   }
  //
  // TreeEntry shape: { name, path, relPath, type, depth, size? }
  //
  // Design choices:
  //   * Sync `readdirSync` for now — workspace trees are small (capped
  //     at 500 entries) and synchronous code keeps the listing in a
  //     consistent point-in-time snapshot.
  //   * Excludes the well-known "noise" folders so the tree mirrors
  //     what a human would scan, not what the dev tools care about.
  //   * Global mode (cwd = userFileRoot) returns `entries: []` so the
  //     renderer can render its own guidance message instead of
  //     drowning the user in projects/cases/study/...
  ipcMain.handle('knowclaw:listWorkspaceTree', async (_evt, payload) => {
    const EXCLUDED_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg',
      'dist', 'build', '.vite', '.next', '.cache',
      '__pycache__', '.venv', 'venv', '.pytest_cache',
      '.DS_Store', '.idea', '.vscode',
    ]);
    const MAX_ENTRIES = 500;
    const DEFAULT_DEPTH = 3;
    const MAX_DEPTH = 6;

    let target = payload?.path ? String(payload.path).trim() : '';
    if (!target) target = getEffectiveCwd();
    let resolved;
    try { resolved = path.resolve(target); } catch (err) {
      return { ok: false, error: `invalid path: ${err?.message || err}` };
    }
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `路径不存在: ${resolved}` };
    }

    let stat;
    try { stat = fs.statSync(resolved); } catch (err) {
      return { ok: false, error: `stat 失败: ${err?.message || err}` };
    }
    if (!stat.isDirectory()) {
      return { ok: false, error: `非目录: ${resolved}` };
    }

    const globalMode = path.resolve(resolved) === path.resolve(getUserFileRoot());
    if (globalMode) {
      return { ok: true, cwd: resolved, global: true, entries: [], truncated: false };
    }

    let maxDepth = Number.isFinite(payload?.depth) ? Math.floor(payload.depth) : DEFAULT_DEPTH;
    if (maxDepth < 1) maxDepth = 1;
    if (maxDepth > MAX_DEPTH) maxDepth = MAX_DEPTH;

    const entries = [];
    let truncated = false;

    function walk(dirAbs, depth) {
      if (truncated) return;
      if (depth > maxDepth) return;
      let dirents;
      try {
        dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return; // permission denied / vanished mid-walk → skip silently
      }
      // Directories first, then files; alpha within each group.
      dirents.sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
      for (const dirent of dirents) {
        if (truncated) return;
        if (EXCLUDED_DIRS.has(dirent.name)) continue;
        if (dirent.name.startsWith('.') && depth === 1) {
          // Top-level dotfiles are noise (e.g. .ipm-app-state) but
          // a dotfile nested inside a project may matter.
          continue;
        }
        const childAbs = path.join(dirAbs, dirent.name);
        const relPath = path.relative(resolved, childAbs).split(path.sep).join('/');
        const isDir = dirent.isDirectory();
        let size;
        if (!isDir) {
          try { size = fs.statSync(childAbs).size; } catch { /* ignore */ }
        }
        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
        entries.push({
          name: dirent.name,
          path: childAbs,
          relPath,
          type: isDir ? 'directory' : 'file',
          depth,
          ...(typeof size === 'number' ? { size } : {}),
        });
        if (isDir) walk(childAbs, depth + 1);
      }
    }

    try {
      walk(resolved, 1);
    } catch (err) {
      return { ok: false, error: `扫描失败: ${err?.message || err}` };
    }

    return { ok: true, cwd: resolved, global: false, entries, truncated };
  });

  // U1: one-click "new workspace" — create a fresh, timestamped
  // directory under `<userFileRoot>/workspaces/` and return its path.
  // Renderer pairs this with `setCwd(returnedPath)` to switch into
  // it. Filesystem writes intentionally live in main rather than the
  // renderer (the preload bridge only exposes IPC, not Node APIs).
  ipcMain.handle('knowclaw:createWorkspace', async (_evt, payload) => {
    try {
      const root = getUserFileRoot();
      const workspacesRoot = path.join(root, 'workspaces');
      try { fs.mkdirSync(workspacesRoot, { recursive: true }); }
      catch (err) {
        return { ok: false, error: `failed to create workspaces root: ${err?.message || err}` };
      }
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        '-',
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
      ].join('');
      // Optional caller-supplied label tags the folder (sanitised to
      // a filename-safe slug). Empty/missing label → no suffix.
      const rawLabel = String(payload?.label || '').trim();
      const safeLabel = rawLabel
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);
      const folderName = safeLabel
        ? `workspace-${stamp}-${safeLabel}`
        : `workspace-${stamp}`;
      const folder = path.join(workspacesRoot, folderName);
      try { fs.mkdirSync(folder, { recursive: false }); }
      catch (err) {
        return { ok: false, error: `failed to create workspace folder: ${err?.message || err}` };
      }
      return { ok: true, path: folder, name: folderName };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // ---- U3: renderer-side reply to install confirmation ----
  ipcMain.handle('knowclaw:confirm-install-reply', async (_evt, payload) => {
    const requestId = String(payload?.requestId || '').trim();
    if (!requestId) return { ok: false, error: 'requestId is required' };
    const entry = pendingConfirmations.get(requestId);
    if (!entry) return { ok: true, matched: false };
    try { entry.resolve(Boolean(payload?.allow)); }
    catch { /* finish() already removed entry */ }
    return { ok: true, matched: true };
  });

  // ---- U6: sub-agent kill-switch (read / write) ----
  //
  // Persisted under `state.knowclaw.subAgentEnabled`. Default `true`.
  // The renderer reads this once at mount (via `getStatus` or
  // explicitly via `getSubAgentEnabled`) to hydrate its toggle UI,
  // and writes back through `setSubAgentEnabled` when the user
  // flips the switch. The change does NOT affect the live
  // `activeSession` — pi binds customTools at createAgentSession
  // time and offers no public API to mutate the registered tool
  // set afterwards. Instead the next `ensureSession` /
  // `openSession` / `forkSession` will pick up the new value. The
  // renderer is responsible for surfacing a "下次新对话生效"
  // affordance.
  ipcMain.handle('knowclaw:getSubAgentEnabled', async () => {
    try {
      const { subAgentEnabled } = readKnowClawState();
      return { ok: true, enabled: Boolean(subAgentEnabled) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), enabled: true };
    }
  });

  // ---- E.5: Plan-mode IPC handlers ----
  ipcMain.handle('knowclaw:setPlanMode', async (_evt, payload) => {
    const enabled = typeof payload === 'boolean' ? payload : Boolean(payload?.enabled);
    currentPlanMode = enabled;
    return { ok: true, planMode: currentPlanMode };
  });

  ipcMain.handle('knowclaw:getPlanMode', async () => ({ ok: true, planMode: currentPlanMode }));

  // Renderer's reply to a `knowclaw:askUser` request. payload:
  //   { requestId: string, answers: { [questionId]: string | string[] } }
  // The renderer may also send `{ cancelled: true }` to abandon the
  // dialog; the resolver receives that object verbatim and the model
  // sees the cancellation as its tool result.
  ipcMain.handle('knowclaw:askUserReply', async (_evt, payload) => {
    const requestId = String(payload?.requestId || '').trim();
    if (!requestId) return { ok: false, error: 'requestId is required' };
    const entry = pendingAskUser.get(requestId);
    if (!entry) return { ok: true, matched: false };
    try {
      entry.resolve(
        payload?.cancelled
          ? { cancelled: true }
          : (payload?.answers && typeof payload.answers === 'object' ? payload.answers : {}),
      );
    } catch { /* finish() already removed entry */ }
    return { ok: true, matched: true };
  });

  ipcMain.handle('knowclaw:setSubAgentEnabled', async (_evt, payload) => {
    const enabled = Boolean(payload?.enabled);
    if (!canPersist) {
      // Without persistence the toggle still works in-memory for the
      // current run but is lost on reload. We surface that via
      // `persisted: false` so the renderer can warn the user, then
      // succeed anyway (no point blocking on something we can't fix
      // from inside the IPC handler).
      return { ok: true, persisted: false, enabled };
    }
    try {
      const state = readState() || {};
      const kc = state.knowclaw && typeof state.knowclaw === 'object'
        ? { ...state.knowclaw }
        : {};
      kc.subAgentEnabled = enabled;
      state.knowclaw = kc;
      writeState(state);
      return { ok: true, persisted: true, enabled };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), enabled };
    }
  });

  // Rescan bash availability on demand. Used by the
  // "未检测到 bash 解释器" banner's "重新检测" button so the user
  // doesn't have to restart IPM after installing Git for Windows
  // in a separate process. Forces a fresh probe (clears the
  // in-memory cache) and returns the new resolution shape that
  // matches the `bashShell` field of `knowclaw:getStatus`.
  ipcMain.handle('knowclaw:rescanBash', async () => {
    clearBashResolutionCache();
    const r = resolveBashShell();
    // Also refresh the env var the next session pickup will read.
    // (Existing sessions keep their already-resolved shellPath until
    // the user opens a new session — that's acceptable; the alternative
    // is force-killing live sessions, which is far worse UX.)
    if (r.available && r.path) {
      process.env.KNOWCLAW_BASH_PATH = r.path;
    } else {
      delete process.env.KNOWCLAW_BASH_PATH;
    }
    return { ok: true, available: r.available, source: r.source };
  });

  ipcMain.handle('knowclaw:getStatus', async () => {
    let config = null;
    try {
      const runtime = await ensurePiRuntime();
      config = runtime.describeCurrentConfig?.() || null;
    } catch { /* ignore */ }
    // U0 (revised): we still report the *requested* thinking level so
    // the renderer can re-hydrate the selector on mount. We no longer
    // include `supportsThinking` / `availableThinkingLevels` — the UI
    // doesn't gate on them anymore, and exposing them would invite
    // future code to reintroduce the "block before trying" UX the
    // user explicitly rejected.
    const effectiveLevel = currentThinkingLevel || activeSession?.thinkingLevel || 'medium';
    // U0.5: lift `apiMode` to the top level too. It's already in
    // `config.apiMode` (see ipmConfig.describeIpmConfig) but the UI
    // shouldn't have to grovel through a nested object to render a
    // small header badge.
    const apiMode = config?.apiMode || null;
    return {
      ok: true,
      hasSession: Boolean(activeSession),
      sessionId: activeSession?.sessionId || null,
      promptInFlight,
      config,
      thinkingLevel: effectiveLevel,
      apiMode,
      // U1: surface the active workspace so the renderer can hydrate
      // `WorkspaceSelector` / `WorkspaceBadge` on mount and after each
      // turn (in case the cwd changed via `openSession`/`forkSession`).
      cwd: getEffectiveCwd(),
      isGlobal: !currentCwd,
      userFileRoot: getUserFileRoot(),
      // U3: bash availability — drives the "install Git for Windows"
      // banner in `KnowClawV2Page`. `available` is false ONLY on Windows
      // when none of (env override / canonical Git install dirs / PATH
      // / bundled MinGit) yielded a working bash.exe. `source` lets the
      // banner distinguish "already had Git installed" from "using the
      // app's bundled bash" so we can show a subtle reassurance instead
      // of either nagging or staying silent.
      //
      // Legacy field `bashAvailable` (boolean) is preserved verbatim
      // for any UI / analytics that haven't migrated to `bashShell` yet.
      bashAvailable: detectBashAvailable(),
      bashShell: (() => {
        const r = resolveBashShell();
        return {
          available: r.available,
          source: r.source, // 'system' | 'bundled' | 'override' | null
          // Intentionally NOT exposing the absolute path to the renderer.
          // It's a filesystem detail the UI doesn't need and isn't worth
          // leaking into devtools / screenshots.
        };
      })(),
      // U5: live context-usage snapshot for the header pill. pi's
      // `getContextUsage()` returns `{ tokens, contextWindow, percent }`
      // (or undefined when there's no session yet, or right after a
      // compact when post-LLM-response tokens haven't been recomputed —
      // in that case `tokens` / `percent` come back null and the UI
      // shows "N/A"). We never throw out of this getter; an undefined
      // / failure path collapses to null so the renderer can simply
      // treat null as "no data yet".
      contextUsage: (() => {
        try { return activeSession?.getContextUsage?.() ?? null; }
        catch { return null; }
      })(),
      // U8a: cumulative session statistics (tokens-only, no cost).
      //
      // pi's `getSessionStats()` returns a richer object including
      // `cost: number`, but IPM's `ipm-openai` provider registers all
      // models with `cost: { input: 0, output: 0, ... }` (the gateway
      // pricing isn't public-OpenAI-aligned, see
      // `desktop/Agent/pi-runtime/models.js`). That means any cost
      // figure we surface would be `0.0`, which is misleading. So we
      // deliberately strip the `cost` field at the IPC boundary and
      // only expose token counts + message/tool counters — the things
      // we *can* report accurately. The renderer renders this through
      // the `TokenPill` header chip.
      //
      // Returning null on early calls (no session yet) lets the UI
      // render a placeholder rather than fight `undefined`/missing
      // field plumbing.
      sessionStats: (() => {
        try {
          const s = activeSession?.getSessionStats?.();
          if (!s) return null;
          return {
            tokens: s.tokens, // { input, output, cacheRead, cacheWrite, total }
            userMessages: s.userMessages,
            assistantMessages: s.assistantMessages,
            toolCalls: s.toolCalls,
            toolResults: s.toolResults,
            totalMessages: s.totalMessages,
          };
        } catch { return null; }
      })(),
      // U5: surface compaction state too so the renderer can rebuild
      // its banner after a hot reload / mount-mid-compaction. Normal
      // operation gets the banner via `compaction_start` events; this
      // is just a safety net for late subscribers.
      isCompacting: Boolean(activeSession?.isCompacting),
      // U6: surface the persistent sub-agent kill-switch so the
      // renderer's toggle can hydrate from the same status snapshot
      // it already polls on mount, without an extra IPC roundtrip.
      // The state-backed default is `true`, so missing state never
      // leaves the UI in an "unknown" tri-state.
      subAgentEnabled: (() => {
        try { return readKnowClawState().subAgentEnabled !== false; }
        catch { return true; }
      })(),
      // E.5: surface the in-memory Plan-mode flag so the renderer can
      // hydrate its PlanModeToggle on mount / after refresh.
      planMode: currentPlanMode,
    };
  });

  // -------- D.1: rehydrate (App-level state recovery) --------
  //
  // Returned to renderer on cold start (Electron reload, devtools
  // reload, dev hot module replacement) so the App-level
  // KnowClawPersistProvider can repopulate `messages` / `streaming` /
  // `tasks` / `sessionStats` / `contextUsage` without the user
  // having to manually `openSession`.
  //
  // Page-level (KnowClawV2Page mount/unmount) does NOT need this — the
  // Provider keeps the live state in memory across nav. This handler
  // is purely for the "I refreshed Electron and want my chat back"
  // case.
  //
  // Also rebinds `activeSender` to the calling renderer so any
  // subsequent push events land in the new window without waiting
  // for the next `knowclaw:send`.
  ipcMain.handle('knowclaw:rehydrate', async (evt) => {
    if (!activeSession) {
      return { ok: false, hasSession: false };
    }
    // Rebind sender — same fix that ensureSession() does on its
    // reuse path. Without this, a hot-reloaded renderer would never
    // see the live stream's continuation events.
    activeSender = evt?.sender || activeSender;

    // Resolve the live JSONL path (may be null for in-memory sessions,
    // but pi's default mode is persistent so this is rarely null).
    let sessionFile = null;
    try {
      const sm = activeSession?.sessionManager;
      if (sm && typeof sm.getSessionFile === 'function') {
        sessionFile = sm.getSessionFile() || null;
      }
    } catch { /* ignore */ }

    const historyEvent = buildHistoryLoadedEvent(activeSession, sessionFile);

    // Mirror the per-field defensive try/catch from `knowclaw:getStatus`
    // so a single field failing never breaks the whole rehydrate.
    const contextUsage = (() => {
      try { return activeSession?.getContextUsage?.() ?? null; }
      catch { return null; }
    })();
    const sessionStats = (() => {
      try {
        const s = activeSession?.getSessionStats?.();
        if (!s) return null;
        return {
          tokens: s.tokens,
          userMessages: s.userMessages,
          assistantMessages: s.assistantMessages,
          toolCalls: s.toolCalls,
          toolResults: s.toolResults,
          totalMessages: s.totalMessages,
        };
      } catch { return null; }
    })();

    return {
      ok: true,
      hasSession: true,
      sessionId: activeSession.sessionId || null,
      sessionFile,
      messages: historyEvent.messages,
      tasks: historyEvent.tasks,
      promptInFlight,
      // Convenience alias for the renderer's `streaming` state.
      streaming: promptInFlight,
      contextUsage,
      sessionStats,
      isCompacting: Boolean(activeSession?.isCompacting),
      cwd: getEffectiveCwd(),
      isGlobal: !currentCwd,
    };
  });

  // -------- Phase 10: history session UI --------

  ipcMain.handle('knowclaw:listSessions', async () => {
    try {
      const runtime = await ensurePiRuntime();
      // U1: list sessions belonging to the *current* workspace. pi's
      // session manager encodes cwd into a per-folder hash directory,
      // so each workspace owns an isolated session history. This
      // keeps the SessionPanel naturally scoped to the user's active
      // workspace and reinforces the "one conversation = one folder"
      // mental model.
      const cwd = getEffectiveCwd();
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

    // U1: a historical session was created in some specific cwd; that
    // cwd is the first record in the JSONL header. We restore
    // `currentCwd` to it before creating the pi session so the
    // newly-spawned AgentSession runs in the *same* workspace the
    // conversation originally belonged to. UI reads this back via
    // `knowclaw:getStatus` (or watches the response below).
    let restoredCwd = null;
    try {
      const header = readSessionHeader(sessionFile);
      if (header?.cwd && typeof header.cwd === 'string') {
        restoredCwd = path.resolve(header.cwd);
      }
    } catch { /* fallthrough → keep currentCwd as-is */ }
    const userFileRoot = getUserFileRoot();
    if (restoredCwd) {
      // Sessions originally created in "global" mode have a cwd equal
      // to the user file root. Map those back to `null` so the UI
      // shows "global" rather than a hard-coded path.
      currentCwd = (path.resolve(restoredCwd) === path.resolve(userFileRoot))
        ? null
        : restoredCwd;
    }

    const runtime = await ensurePiRuntime();
    const cwd = getEffectiveCwd();
    const toolDeps = haveToolDeps
      ? {
          getWorkspaceDirs,
          readState,
          getWorkspaceDirOrThrow,
          buildProjectRegistry,
          getProjectDb,
          listEvents,
          listLogs,
          // K1: bridge to main-process F2 webFetch.fetchWeb so the pi-runtime
          // `fetch_web` tool can run pages through Electron's BrowserWindow
          // for JS-heavy SPAs (rendered: true) and return Markdown bodies.
          fetchWebRendered: async (url, opts = {}) => {
            return fetchWeb(url, { mode: 'auto', screenshot: false, ...(opts || {}) });
          },
        }
      : undefined;

    let prefs = {};
    if (typeof readState === 'function') {
      try {
        const state = readState();
        prefs = state?.prefs && typeof state.prefs === 'object' ? state.prefs : {};
      } catch { /* ignore */ }
    }

    // U6: respect the user's sub-agent kill-switch on re-opens too.
    const { subAgentEnabled } = readKnowClawState();

    let result;
    try {
      result = await runtime.createSession({
        cwd,
        mode: 'open',
        sessionFile,
        toolDeps,
        prefs,
        thinkingLevel: currentThinkingLevel,
        noContextFiles: shouldDisableContextFiles(),
        beforeToolCall: knowclawBeforeToolCall,
        subAgentEnabled,
        askUser: askUserViaRenderer,
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
      cwd,
      isGlobal: !currentCwd,
    };
  });

  ipcMain.handle('knowclaw:deleteSession', async (evt, payload) => {
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

    let unlinkError = null;
    try {
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
      }
    } catch (err) {
      unlinkError = String(err?.message || err);
    }

    // D.2: when the user just nuked the currently active session,
    // `activeSession` is now `null`. The next `knowclaw:send` would
    // route through `ensureSession('new')` (post-D.2 default), but
    // that means the header sessionId pill stays empty until the user
    // actually types something. Eagerly create a blank replacement
    // here so the renderer can update the header immediately from
    // the IPC response. We rebind `activeSender` to whichever
    // renderer initiated the delete so subsequent push events land
    // in the right window.
    let nextSessionId = null;
    let nextSessionFile = null;
    let nextError = null;
    if (wasActive) {
      try {
        const ensured = await ensureSession(evt?.sender, 'new');
        if (ensured?.ok) {
          nextSessionId = ensured.sessionId || null;
          nextSessionFile = ensured.sessionFile || null;
        } else {
          nextError = ensured?.error || (ensured?.skipped ? '未配置 LLM 或没有可用模型' : null);
        }
      } catch (err) {
        nextError = String(err?.message || err);
      }
    }

    if (unlinkError && !wasActive) {
      return { ok: false, error: unlinkError, wasActive };
    }
    return {
      ok: true,
      wasActive,
      // present only when we auto-created a fresh session
      nextSessionId,
      nextSessionFile,
      nextError,
      // surface unlink failure as a soft warning so the renderer
      // can decide whether to toast
      unlinkError: unlinkError || undefined,
    };
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

    // U1: a forked session inherits the source session's cwd (encoded
    // in the JSONL header). Restore `currentCwd` to that value before
    // spinning up the pi session so the fork runs in the same
    // workspace as its parent.
    const userFileRootForFork = getUserFileRoot();
    if (header?.cwd && typeof header.cwd === 'string') {
      const resolved = path.resolve(header.cwd);
      currentCwd = (resolved === path.resolve(userFileRootForFork))
        ? null
        : resolved;
    }

    const runtime = await ensurePiRuntime();
    const cwd = getEffectiveCwd();
    const toolDeps = haveToolDeps
      ? {
          getWorkspaceDirs,
          readState,
          getWorkspaceDirOrThrow,
          buildProjectRegistry,
          getProjectDb,
          listEvents,
          listLogs,
          // K1: bridge to main-process F2 webFetch.fetchWeb so the pi-runtime
          // `fetch_web` tool can run pages through Electron's BrowserWindow
          // for JS-heavy SPAs (rendered: true) and return Markdown bodies.
          fetchWebRendered: async (url, opts = {}) => {
            return fetchWeb(url, { mode: 'auto', screenshot: false, ...(opts || {}) });
          },
        }
      : undefined;
    let prefs = {};
    if (typeof readState === 'function') {
      try {
        const state = readState();
        prefs = state?.prefs && typeof state.prefs === 'object' ? state.prefs : {};
      } catch { /* ignore */ }
    }

    // U6: forks honour the same kill-switch as the parent session.
    const { subAgentEnabled } = readKnowClawState();

    let result;
    try {
      result = await runtime.createSession({
        cwd,
        mode: 'open',
        sessionFile: newPath,
        toolDeps,
        prefs,
        thinkingLevel: currentThinkingLevel,
        noContextFiles: shouldDisableContextFiles(),
        beforeToolCall: knowclawBeforeToolCall,
        subAgentEnabled,
        askUser: askUserViaRenderer,
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
 * U7: scan the session's append-only entry log for the most recent
 * `knowclaw:tasks` custom entry. The pi SessionManager stores these
 * via `appendCustomEntry()` as `{ type: 'custom', customType, data }`,
 * which is persisted to the JSONL but NOT injected back into the
 * LLM context — perfect for renderer-side UI state.
 *
 * Returns the `tasks` array from the latest entry, or `null` when the
 * session has no tasks recorded yet (or any error occurred — we
 * never let this throw because history_loaded must always fire).
 *
 * @param {*} session AgentSession instance.
 * @returns {Array | null}
 */
function extractLatestTasksEntry(session) {
  try {
    const sm = session?.sessionManager;
    if (!sm || typeof sm.getEntries !== 'function') return null;
    const entries = sm.getEntries();
    if (!Array.isArray(entries) || entries.length === 0) return null;
    // Walk backwards: the LAST tasks entry on the live branch is the
    // "current" snapshot. (We don't filter by branch here because
    // forks copy the branch entries into the new file, so a linear
    // scan of getEntries() is already on the current leaf chain
    // until pi's tree model surfaces it differently.)
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i];
      if (e && e.type === 'custom' && e.customType === 'knowclaw:tasks') {
        const data = e.data;
        if (data && Array.isArray(data.tasks)) return data.tasks;
        return null;
      }
    }
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[KnowClaw] extractLatestTasksEntry failed:', err?.message || err);
    return null;
  }
}

/**
 * Build a `history_loaded` event payload from a freshly opened
 * AgentSession. Walks the live `session.messages` array (which
 * resolves the active branch leaf, including compaction). Falls back
 * to an empty list if extraction throws.
 *
 * U7 additions:
 *   - `tasks`: latest `knowclaw:tasks` snapshot from the session
 *     entry log, or `null`. The renderer appends a TaskCard bubble
 *     at the tail of the restored transcript when this is a
 *     non-empty array.
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
    tasks: extractLatestTasksEntry(session),
  };
}
