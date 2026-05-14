// desktop/Agent/pi-runtime/bootstrap.js
//
// KnowClaw runtime — builds an `AgentSession` backed by the IPM-configured
// `ipm-openai` provider.
//
// Two entry points:
//
//   - `createSession(opts)`  — Phase-3 long-lived API. Returns the live
//     `AgentSession` plus metadata. The caller is responsible for
//     `session.subscribe(...)`, `session.prompt(...)`, and eventually
//     `disposeSession(...)`.
//
//   - `runPoc(opts)`         — Phase-0/1/2 one-shot wrapper kept for
//     backwards compatibility with the `KNOWCLAW_PI_POC` trigger in
//     `main.js`. Internally builds a session, subscribes a console
//     event logger, optionally sends one prompt, then disposes.
//
// Flow (createSession):
//   1. Read IPM LLM config (state.json → .env → null).
//   2. Build a no-disk AuthStorage and an in-memory ModelRegistry.
//   3. Register the `ipm-openai` provider directly on the ModelRegistry.
//   4. Inject the IPM api key as a runtime override on AuthStorage.
//   5. Look up the chosen model (defaults to `ipmConfig.model`).
//   6. Build a SessionManager (persistent JSONL by default).
//   7. Create the AgentSession.
//
// All failure paths return a structured error object — never throw.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';

import { describeIpmConfig, getIpmLlmConfig } from './ipmConfig.js';
import { applyIpmRuntimeKey, buildAuthStorage } from './auth.js';
import {
  registerIpmProvider,
  buildModelRegistry,
  findIpmModel,
  getDefaultIpmModel,
  listIpmModelsAsync,
} from './models.js';
import { describeSessionManager, makeSessionManager } from './sessionFactory.js';
import { buildProjectTools } from './tools/projectTools.js';
import { buildWebTools } from './tools/webTools.js';
import { buildKnowClawPrompt, describeKnowClawPrompt } from './promptBuilder.js';

const TAG = '[KnowClaw]';

// Built-in skills directory (Phase 8). Resolved from this file's location so it
// works in both dev (running from source) and packaged builds (asar-extracted
// Agent/ tree). pi's loadSkillsFromDir() will recurse and pick up any
// `<name>/SKILL.md` under here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILLS_DIR = path.join(__dirname, 'skills');

/**
 * Resolve the directory holding user-authored skills (Phase 8 follow-up).
 * `KNOWCLAW_USER_SKILLS_ROOT` is set by `main.js` to
 * `app.getPath('userData')/knowclaw-skills`. Returns `null` when running
 * outside Electron or when the env var is unset; callers should treat that
 * as "no user skills configured" rather than fall back to a hard-coded
 * homedir path — user skill data is intentionally tied to IPM's userData.
 */
function getUserSkillsRoot() {
  const fromEnv = process.env.KNOWCLAW_USER_SKILLS_ROOT;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return null;
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(TAG, ...args);
}

function summarizeEvent(event) {
  if (!event || typeof event !== 'object') return '';
  switch (event.type) {
    case 'message_update': {
      const sub = event.assistantMessageEvent;
      if (!sub) return '';
      if (sub.type === 'text_delta') {
        const len = (sub.delta || '').length;
        return `text_delta len=${len}`;
      }
      if (sub.type === 'thinking_delta') return 'thinking_delta';
      return `sub=${sub.type}`;
    }
    case 'tool_execution_start':
      return `tool=${event.toolName || '?'} callId=${event.toolCallId || '?'}`;
    case 'tool_execution_end':
      return `tool=${event.toolName || '?'} isError=${Boolean(event.isError)}`;
    case 'turn_end': {
      const n = Array.isArray(event.toolResults) ? event.toolResults.length : 0;
      return `toolResults=${n}`;
    }
    case 'agent_end': {
      const n = Array.isArray(event.messages) ? event.messages.length : 0;
      return `messages+=${n}`;
    }
    case 'queue_update':
      return `steering=${Boolean(event.steering)} followUp=${Boolean(event.followUp)}`;
    default:
      return '';
  }
}

function makeEventLogger(prefix = '[KnowClaw-PoC]') {
  return (event) => {
    try {
      const extra = summarizeEvent(event);
      // eslint-disable-next-line no-console
      console.log(prefix, '[event]', event.type, extra);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(prefix, '[event] (summarize failed)', err?.message || err);
    }
  };
}

/**
 * @typedef {object} CreateSessionResult
 * @property {*} [session]            AgentSession instance (pi SDK).
 * @property {string | null} sessionId
 * @property {boolean} resumed        true when continueRecent loaded existing history.
 * @property {string | null} sessionFile  Absolute path to the JSONL file (null for inMemory).
 * @property {string | null} [model]  Selected model `provider/id` string.
 * @property {boolean} [skipped]      true when no usable LLM config / model was found.
 * @property {string}  [modelFallbackMessage]
 * @property {string}  [error]
 */

/**
 * Create a live `AgentSession`. Caller owns the session lifecycle — must
 * call `disposeSession(session)` (or the unsubscribe + dispose pair)
 * when done.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.modelId]
 * @param {'new' | 'continueRecent' | 'open' | 'inMemory'} [opts.mode='continueRecent']
 * @param {string} [opts.sessionFile]  Required when mode === 'open'.
 * @param {object} [opts.toolDeps]     IPM business helpers for customTools.
 * @param {object} [opts.prefs]        IPM user preferences (e.g. userName) for prompt personalization.
 * @returns {Promise<CreateSessionResult>}
 */
export async function createSession(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const modelIdOverride = opts.modelId ? String(opts.modelId).trim() : '';
  const mode = opts.mode || 'continueRecent';
  const sessionFile = opts.sessionFile || undefined;
  const toolDeps = opts.toolDeps && typeof opts.toolDeps === 'object' ? opts.toolDeps : null;
  const prefs = opts.prefs && typeof opts.prefs === 'object' ? opts.prefs : {};

  // --- 1. Read IPM config ---
  const ipmConfig = getIpmLlmConfig();
  log('IPM LLM config:', describeIpmConfig(ipmConfig));

  // --- 2. Build AuthStorage + ModelRegistry (in-memory, no disk IO) ---
  let authStorage;
  let modelRegistry;
  try {
    authStorage = buildAuthStorage();
    modelRegistry = buildModelRegistry(authStorage);
  } catch (err) {
    log('failed to build AuthStorage / ModelRegistry:', err?.message || err);
    return { sessionId: null, resumed: false, sessionFile: null, error: String(err?.message || err) };
  }

  // --- 3. Register ipm-openai provider directly on ModelRegistry ---
  try {
    registerIpmProvider(modelRegistry, ipmConfig);
  } catch (err) {
    log('failed to register ipm-openai provider:', err?.message || err);
    return { sessionId: null, resumed: false, sessionFile: null, error: String(err?.message || err) };
  }

  // --- 4. Inject runtime API key ---
  applyIpmRuntimeKey(authStorage, ipmConfig);

  // --- 5. Check available models ---
  const ipmModels = await listIpmModelsAsync(modelRegistry);
  log(
    `ipm-openai models registered: ${ipmModels.length}`,
    ipmModels.map((m) => m.id),
  );

  if (!ipmConfig || ipmModels.length === 0) {
    log('no usable IPM LLM config — skipping session creation.');
    return { sessionId: null, resumed: false, sessionFile: null, skipped: true };
  }

  // --- 6. Resolve model ---
  const model = modelIdOverride
    ? findIpmModel(modelRegistry, modelIdOverride)
    : getDefaultIpmModel(modelRegistry, ipmConfig);
  log('selected model:', model ? `${model.provider}/${model.id}` : null);

  if (!model) {
    log('could not resolve a model — skipping session creation.');
    return { sessionId: null, resumed: false, sessionFile: null, skipped: true };
  }

  // --- 7. Build SessionManager (persistent JSONL by default) ---
  let sessionManager;
  try {
    sessionManager = makeSessionManager({ mode, cwd, sessionFile });
  } catch (err) {
    log('makeSessionManager failed:', err?.message || err);
    return { sessionId: null, resumed: false, sessionFile: null, error: String(err?.message || err) };
  }
  const smInfo = describeSessionManager(sessionManager);
  log('session manager:', { mode, persisted: smInfo.persisted, sessionFile: smInfo.sessionFile });

  // Detect resume: continueRecent / open may have loaded existing history.
  let resumed = false;
  try {
    const ctx = sessionManager.buildSessionContext?.();
    resumed = Boolean(ctx && Array.isArray(ctx.messages) && ctx.messages.length > 0);
  } catch { /* ignore */ }
  if (resumed) {
    log('session resumed from existing history', {
      sessionId: sessionManager.getSessionId?.(),
    });
  }

  // --- 8. Build customTools from injected IPM deps (Phase 5) ---
  let customTools = [];
  if (toolDeps) {
    try {
      customTools = buildProjectTools(toolDeps);
      log(`customTools: ${customTools.length} IPM project tools registered`);
    } catch (err) {
      log('buildProjectTools failed (continuing without custom tools):', err?.message || err);
      customTools = [];
    }
  } else {
    log('customTools: no toolDeps provided — running without IPM project tools');
  }

  // --- 8b. Build web tools (Phase 6, no toolDeps required) ---
  // These have no IPM business dependencies, so we always register them.
  try {
    const webTools = buildWebTools();
    customTools = customTools.concat(webTools);
    log(`customTools: ${webTools.length} web tools registered (total ${customTools.length})`);
  } catch (err) {
    log('buildWebTools failed (continuing without web tools):', err?.message || err);
  }

  // --- 8c. Build ResourceLoader with KnowClaw system prompt (Phase 7) ---
  // The DefaultResourceLoader is normally constructed inside
  // createAgentSession. We construct it here so we can pass our custom
  // `systemPrompt`, replacing pi's "expert coding assistant" template
  // with the KnowClaw / IPM identity. `noContextFiles: true` disables
  // pi's automatic AGENTS.md/CLAUDE.md scan up the cwd ancestors —
  // IPM's cwd is `userfile/`, not a code project, so that scan would
  // pull in unrelated files.
  let resourceLoader;
  try {
    const systemPrompt = buildKnowClawPrompt({
      userName: typeof prefs.userName === 'string' ? prefs.userName : '',
      cwd,
    });
    const userSkillsRoot = getUserSkillsRoot();
    const additionalSkillPaths = [BUILTIN_SKILLS_DIR];
    if (userSkillsRoot) {
      additionalSkillPaths.push(userSkillsRoot);
    }

    resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      systemPrompt,
      noContextFiles: true,
      additionalSkillPaths,
    });
    await resourceLoader.reload();
    log('resourceLoader: systemPrompt injected', describeKnowClawPrompt(systemPrompt));

    // Phase 8: surface what skills got loaded for easy debugging.
    try {
      const skillResult = resourceLoader.getSkills?.();
      const skills = Array.isArray(skillResult?.skills) ? skillResult.skills : [];
      const diagnostics = Array.isArray(skillResult?.diagnostics) ? skillResult.diagnostics : [];
      log(
        `skills loaded: ${skills.length}`,
        skills.map((s) => s.name),
        { builtin: BUILTIN_SKILLS_DIR, user: userSkillsRoot || '(none)' },
      );
      if (diagnostics.length > 0) {
        log('skills diagnostics:', diagnostics.map((d) => d?.message || d));
      }
    } catch (err) {
      log('skills enumeration failed (non-fatal):', err?.message || err);
    }
  } catch (err) {
    log('resourceLoader build failed (falling back to pi default):', err?.message || err);
    resourceLoader = undefined;
  }

  // --- 9. Create AgentSession ---
  log('creating session', { cwd });
  let session;
  let modelFallbackMessage;
  try {
    const result = await createAgentSession({
      cwd,
      sessionManager,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: 'off',
      customTools,
      resourceLoader,
    });
    session = result.session;
    modelFallbackMessage = result.modelFallbackMessage;
  } catch (err) {
    log('createAgentSession failed:', err?.message || err);
    return { sessionId: null, resumed: false, sessionFile: smInfo.sessionFile, error: String(err?.message || err) };
  }

  if (modelFallbackMessage) {
    log('modelFallbackMessage:', modelFallbackMessage);
  }
  log('session ready', { sessionId: session.sessionId, resumed });

  return {
    session,
    sessionId: session.sessionId || null,
    resumed,
    sessionFile: describeSessionManager(sessionManager).sessionFile,
    model: model ? `${model.provider}/${model.id}` : null,
    modelFallbackMessage,
  };
}

/**
 * Safely dispose a session and its subscription. Either or both args
 * may be null/undefined.
 *
 * @param {*} session         AgentSession instance (or null).
 * @param {Function} [unsubscribe]  unsubscribe function from session.subscribe().
 */
export function disposeSession(session, unsubscribe) {
  if (typeof unsubscribe === 'function') {
    try { unsubscribe(); } catch { /* ignore */ }
  }
  if (session && typeof session.dispose === 'function') {
    try { session.dispose(); } catch { /* ignore */ }
  }
}

/**
 * One-shot PoC wrapper (Phase 0/1/2 compatibility): create session,
 * subscribe a console logger, optionally send one prompt, dispose.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.prompt]
 * @param {string} [opts.modelId]
 * @param {'new' | 'continueRecent' | 'open' | 'inMemory'} [opts.mode]
 * @param {string} [opts.sessionFile]
 * @returns {Promise<{ sessionId: string | null, skipped?: boolean, error?: string, resumed?: boolean, sessionFile?: string | null }>}
 */
export async function runPoc(opts = {}) {
  const prompt = opts.prompt ? String(opts.prompt).trim() : '';
  const created = await createSession(opts);

  if (!created.session) {
    // Skipped or error: surface the structured result as-is.
    return {
      sessionId: created.sessionId,
      sessionFile: created.sessionFile,
      resumed: created.resumed,
      skipped: created.skipped,
      error: created.error,
    };
  }

  const { session, sessionId, resumed, sessionFile: sf } = created;
  const unsubscribe = session.subscribe(makeEventLogger('[KnowClaw-PoC]'));

  try {
    if (prompt) {
      // eslint-disable-next-line no-console
      console.log('[KnowClaw-PoC] sending prompt:', prompt);
      await session.prompt(prompt);
      // eslint-disable-next-line no-console
      console.log('[KnowClaw-PoC] prompt finished');
    } else {
      // eslint-disable-next-line no-console
      console.log('[KnowClaw-PoC] no prompt provided — session created without sending a turn');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log('[KnowClaw-PoC] prompt failed:', err?.message || err);
    return {
      sessionId,
      sessionFile: sf,
      resumed,
      error: String(err?.message || err),
    };
  } finally {
    disposeSession(session, unsubscribe);
  }

  return {
    sessionId,
    sessionFile: sf,
    resumed,
  };
}
