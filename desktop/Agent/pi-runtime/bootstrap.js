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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';

import {
  describeIpmConfig,
  describeSearchApiConfig,
  getIpmLlmConfig,
  getIpmLlmConfigs,
  getSearchApiConfig,
} from './ipmConfig.js';
import { applyIpmRuntimeKeys, buildAuthStorage } from './auth.js';
import {
  registerIpmProviders,
  buildModelRegistry,
  findIpmModel,
  getDefaultIpmModel,
  listIpmModelsAsync,
} from './models.js';
import { describeSessionManager, makeSessionManager } from './sessionFactory.js';
import { buildProjectTools } from './tools/projectTools.js';
import { buildWebTools } from './tools/webTools.js';
import { buildAskUserTool } from './tools/askUserTool.js';
import { buildSavePlanTool } from './tools/savePlanTool.js';
import { buildEnvTools } from './tools/envTools.js';
import { buildDelegateTool } from './tools/delegateTool.js';
import { buildTaskTool } from './tools/taskTool.js';
import { buildKnowClawPrompt, describeKnowClawPrompt } from './promptBuilder.js';

const TAG = '[KnowClaw]';

// Built-in skills directory (Phase 8). Resolved from this file's location so it
// works in both dev (running from source) and packaged builds (asar-extracted
// Agent/ tree). pi's loadSkillsFromDir() will recurse and pick up any
// `<name>/SKILL.md` under here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILLS_DIR = path.join(__dirname, 'skills');

// U2a: expose the built-in skills directory to skill scripts via an env var
// so that SKILL.md instructions can reference shared helpers under
// `_shared/` with an absolute, portable path. Without this, every Skill
// would need to duplicate office/pdf helpers locally (or guess paths
// relative to the user's cwd, which doesn't work because pi runs scripts
// with cwd = the user workspace, not the skill directory).
//
// Concrete example from a SKILL.md:
//   bash: python "$KNOWCLAW_SKILLS_DIR/_shared/office/validate.py" report.docx
//
// Set once on module load (idempotent across sessions). Never overwrite if
// the env var was already supplied by the caller — useful for tests that
// want to point at a fixture skills tree.
if (!process.env.KNOWCLAW_SKILLS_DIR) {
  process.env.KNOWCLAW_SKILLS_DIR = BUILTIN_SKILLS_DIR;
}

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

// ---------------------------------------------------------------------------
// Bundled-bash plumbing
//
// IPM's main process (see `src/main/ipc/knowclaw.js → resolveBashShell()`)
// figures out which `bash.exe` to use — preferring system Git for Windows,
// falling back to the MinGit bundle shipped under `vendor/MinGit/` /
// `resources/MinGit/`. It then exposes the absolute path via the
// `KNOWCLAW_BASH_PATH` env var on this process.
//
// pi's SDK reads its `shellPath` from `<agentDir>/settings.json` (see
// `SettingsManager.getShellPath()`); there is no in-process API to set it
// before `createAgentSession()` builds its own SettingsManager. So we
// write the field into settings.json ourselves right before each session
// is created. We touch only the `shellPath` key, preserve any other
// global settings the user (or future code) may have added, and tolerate
// a missing / malformed file (treated as "start fresh").
//
// Idempotent: skipped when the env var is unset (Linux/macOS path) or
// when the file already has the same value.
function applyResolvedBashPath() {
  const resolved = process.env.KNOWCLAW_BASH_PATH;
  if (!resolved) return; // Nothing to do — pi will fall back to its own probe.

  let agentDir;
  try {
    agentDir = getAgentDir();
  } catch (err) {
    log('applyResolvedBashPath: getAgentDir() failed:', err?.message || err);
    return;
  }
  if (!agentDir) return;

  const settingsPath = path.join(agentDir, 'settings.json');
  let current = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed;
      }
    }
  } catch (err) {
    // Malformed JSON: don't blow up — overwrite with a clean object that
    // still carries our shellPath. Worst case the user loses unrelated
    // settings.json edits, which we log loudly so anyone debugging can
    // see exactly what happened.
    log('applyResolvedBashPath: existing settings.json unreadable, will overwrite:', err?.message || err);
    current = {};
  }

  if (current.shellPath === resolved) return; // Already up to date.
  current.shellPath = resolved;
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf8');
    log('applyResolvedBashPath: wrote shellPath →', resolved);
  } catch (err) {
    log('applyResolvedBashPath: write failed (non-fatal):', err?.message || err);
  }
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
 * @param {'off' | 'minimal' | 'low' | 'medium' | 'high'} [opts.thinkingLevel='medium']
 *                                     Extended thinking depth. pi SDK will clamp to the
 *                                     model's supported levels (off for non-reasoning models).
 * @param {boolean} [opts.noContextFiles=true]
 *                                     U1: when `false`, pi's `DefaultResourceLoader` will
 *                                     scan `cwd` (and its ancestor chain) for `AGENTS.md` /
 *                                     `CLAUDE.md` project-context files and append them to
 *                                     the system prompt. KnowClaw IPC sets this to `false`
 *                                     for project-mode workspaces and keeps the default
 *                                     `true` for "global" mode (cwd = userfile root).
 * @param {Function} [opts.beforeToolCall]
 *                                     U3: async hook `({ toolCall, args, assistantMessage,
 *                                     context }, signal) => undefined | { block: true,
 *                                     reason }`. Invoked by the pi agent-loop *before*
 *                                     every tool execution. Returning `{ block: true }`
 *                                     short-circuits the call and surfaces `reason` to
 *                                     the model as an error result. KnowClaw uses this
 *                                     to gate `pip install` / `npm install` commands
 *                                     and hard-block `sudo apt install` style system
 *                                     installers. pi's `AgentSession` constructor
 *                                     installs its own `beforeToolCall` that delegates
 *                                     to the extension runtime — we chain ours in front
 *                                     of it so both run.
 * @param {(questions: any[], signal?: AbortSignal) => Promise<any>} [opts.askUser]
 *                                     E.5: optional bridge for the `ask_user`
 *                                     customTool. When the model calls `ask_user`,
 *                                     the tool defers to this function to surface
 *                                     a structured-question dialog in the
 *                                     renderer and await the user's reply. Wired
 *                                     by knowclaw.js's `askUserViaRenderer` which
 *                                     reuses the same IPC roundtrip pattern as
 *                                     install-confirm. When absent, ask_user
 *                                     degrades to an error result so the model
 *                                     can fall back to plain text.
 * @param {boolean} [opts.subAgentEnabled=true]
 *                                     U6: when truthy (the default), register the
 *                                     `delegate_task` customTool so the main agent can
 *                                     spawn isolated sub-agent sessions. When `false`,
 *                                     `delegate_task` is NOT registered (the model
 *                                     literally cannot see/use it), giving the user a
 *                                     hard kill-switch for sub-agent delegation. The
 *                                     change takes effect on the *next* session
 *                                     creation — existing sessions keep their tool
 *                                     set frozen until they're disposed.
 * @param {string[]} [opts.disabledSkills=[]]
 *                                     SK0: list of skill names to exclude from
 *                                     this session's system prompt. Threaded
 *                                     into a `skillsOverride` callback on
 *                                     `DefaultResourceLoader` which filters the
 *                                     loaded skill list after pi's normal
 *                                     scan/validate pass. Effect:
 *                                       - the model never sees disabled skills in
 *                                         `<available_skills>`, so it won't
 *                                         spontaneously invoke them;
 *                                       - `/skill:name` commands still work (the
 *                                         command path doesn't consult prompt
 *                                         injection);
 *                                       - disabled-skill files remain on disk
 *                                         untouched — toggle is a soft mute.
 *                                     Like `subAgentEnabled`, this is captured
 *                                     at session-creation time; running sessions
 *                                     keep their skill set frozen.
 * @returns {Promise<CreateSessionResult>}
 */
export async function createSession(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const modelIdOverride = opts.modelId ? String(opts.modelId).trim() : '';
  // 多 Provider 升级：runtime / IPC 端可显式指定 pi 端的 provider id，
  // 让 setModel('ipm-openai-abc', 'gpt-5.1') 这种用法精确生效。
  const providerIdOverride = opts.providerId ? String(opts.providerId).trim() : '';
  const mode = opts.mode || 'continueRecent';
  const sessionFile = opts.sessionFile || undefined;
  const toolDeps = opts.toolDeps && typeof opts.toolDeps === 'object' ? opts.toolDeps : null;
  const prefs = opts.prefs && typeof opts.prefs === 'object' ? opts.prefs : {};
  const thinkingLevel = opts.thinkingLevel || 'medium';
  // U6: sub-agent kill-switch. Default true (delegate_task registered);
  // pass `false` to skip registration entirely so the model can't even
  // see the tool.
  const subAgentEnabled = opts.subAgentEnabled !== false;
  // SK0: skill mute-list. Names appearing here get filtered out of the
  // ResourceLoader's skill set via `skillsOverride` (see § 8c below).
  const disabledSkills = Array.isArray(opts.disabledSkills)
    ? opts.disabledSkills.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())
    : [];

  // --- 1. Read IPM configs (KnowClaw 多模型) ---
  const ipmConfigs = getIpmLlmConfigs();
  const ipmConfig = ipmConfigs[0] || null;
  log('IPM KnowClaw configs:', ipmConfigs.length, describeIpmConfig(ipmConfig));

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

  // --- 3. Register all KnowClaw providers on ModelRegistry ---
  try {
    registerIpmProviders(modelRegistry, ipmConfigs);
  } catch (err) {
    log('failed to register KnowClaw providers:', err?.message || err);
    return { sessionId: null, resumed: false, sessionFile: null, error: String(err?.message || err) };
  }

  // --- 4. Inject runtime API keys (一次性把所有 provider 的 Key 都装上) ---
  applyIpmRuntimeKeys(authStorage, ipmConfigs);

  // --- 5. Check available models ---
  const ipmModels = await listIpmModelsAsync(modelRegistry);
  log(
    `KnowClaw models registered: ${ipmModels.length}`,
    ipmModels.map((m) => `${m.provider}/${m.id}`),
  );

  if (!ipmConfig || ipmModels.length === 0) {
    log('no usable IPM LLM config — skipping session creation.');
    return { sessionId: null, resumed: false, sessionFile: null, skipped: true };
  }

  // --- 6. Resolve model ---
  // modelIdOverride 既可以是 "providerId/modelId"，也可以是单纯的 modelId
  // （兼容旧调用方式）。providerIdOverride 优先于 modelIdOverride 中的
  // providerId 前缀。
  let resolvedProviderId = providerIdOverride;
  let resolvedModelId = modelIdOverride;
  if (modelIdOverride && modelIdOverride.includes('/')) {
    const [maybeProvider, ...rest] = modelIdOverride.split('/');
    if (maybeProvider && rest.length > 0) {
      resolvedProviderId = resolvedProviderId || maybeProvider;
      resolvedModelId = rest.join('/');
    }
  }

  let model = null;
  if (resolvedModelId) {
    model = findIpmModel(modelRegistry, resolvedModelId, resolvedProviderId);
  }
  if (!model) {
    model = getDefaultIpmModel(modelRegistry, ipmConfig);
  }
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

  // --- 8b. Build web tools (Phase 6 + K1 upgrade) ---
  // - `searchApiKey`: read from state.prefs.searchApi via ipmConfig.getSearchApiConfig().
  //   When null/unset, search_web is still registered but returns a degraded
  //   prompt telling the model to ask the user for a URL.
  // - `fetchWebRendered`: bridge to the main-process F2 BrowserWindow pipeline,
  //   injected via toolDeps when KnowClaw runs inside Electron. When absent
  //   (e.g. unit tests, headless smoke runs), fetch_web silently falls back
  //   to the lightweight Node fetch path.
  try {
    const searchApiConfig = getSearchApiConfig();
    const webTools = buildWebTools({
      searchApiKey: searchApiConfig?.apiKey || null,
      fetchWebRendered: typeof toolDeps?.fetchWebRendered === 'function'
        ? toolDeps.fetchWebRendered
        : null,
    });
    customTools = customTools.concat(webTools);
    const searchDesc = describeSearchApiConfig(searchApiConfig);
    log(
      `customTools: ${webTools.length} web tools registered (total ${customTools.length}); ` +
      `searchApi=${searchDesc ? searchDesc.provider + '/' + searchDesc.apiKeyPreview : 'none'}; ` +
      `renderedBridge=${toolDeps?.fetchWebRendered ? 'yes' : 'no'}`,
    );
  } catch (err) {
    log('buildWebTools failed (continuing without web tools):', err?.message || err);
  }

  // --- 8b.1 Build env-probe tools (U3) ---
  // `check_environment` lets the model verify python/node/pip/npm/bash
  // availability and look up specific packages BEFORE issuing
  // `pip install` / `npm install`, which would otherwise trip the
  // beforeToolCall install guard and prompt the user unnecessarily.
  // Registered alongside the web tools so it's always available.
  try {
    const envTools = buildEnvTools();
    customTools = customTools.concat(envTools);
    log(`customTools: ${envTools.length} env tools registered (total ${customTools.length})`);
  } catch (err) {
    log('buildEnvTools failed (continuing without env tools):', err?.message || err);
  }

  // --- 8b.2 Build delegate_task tool (U6, conditional) ---
  // Registers a customTool that lets the main agent spawn an isolated
  // sub-agent (fresh AgentSession, in-memory SessionManager, restricted
  // tool allowlist, no AGENTS.md scan) and synchronously collect a
  // structured summary. The dependencies handed in here capture the
  // *parent* session's identity (cwd, thinking, auth, model) so the
  // sub-agent reuses the same provider/credentials without
  // re-registering anything.
  //
  // Skipped entirely when `opts.subAgentEnabled === false` — the
  // model literally won't see the tool, which is the user-facing
  // "off switch" from the header SubAgentToggle. Failures here are
  // non-fatal: we log and continue so the main session still works
  // (worst case: no sub-agent delegation, identical to the off path).
  if (subAgentEnabled) {
    try {
      const delegateTools = buildDelegateTool({
        authStorage,
        modelRegistry,
        model,
        parentCwd: cwd,
        thinkingLevel,
        parentBeforeToolCall: typeof opts.beforeToolCall === 'function' ? opts.beforeToolCall : null,
        builtinSkillsDir: BUILTIN_SKILLS_DIR,
        userSkillsRoot: getUserSkillsRoot(),
        log,
      });
      customTools = customTools.concat(delegateTools);
      log(`customTools: ${delegateTools.length} delegate tools registered (total ${customTools.length})`);
    } catch (err) {
      log('buildDelegateTool failed (continuing without sub-agent):', err?.message || err);
    }
  } else {
    log('customTools: sub-agent delegation disabled by user — delegate_task NOT registered');
  }

  // --- 8b.3 Build task_manager tool (U7) ---
  // Registers a customTool that lets the model maintain a session-scoped
  // task checklist (Claude Code TodoWrite style). Each call atomically
  // replaces the list and appends a snapshot to the session JSONL as a
  // pi `CustomEntry` — that entry survives reload but does NOT enter
  // LLM context (the model already knows the list via its own tool_call
  // args, so re-injecting would waste tokens).
  //
  // We must register AFTER `makeSessionManager` (step 7) so we can
  // inject the live sessionManager into the tool; the position here
  // (post-delegate) is intentional so child sub-agents — which don't
  // see `customTools` from the parent — can't recursively call
  // task_manager either (D5).
  try {
    const taskTools = buildTaskTool({ sessionManager, log });
    customTools = customTools.concat(taskTools);
    log(`customTools: ${taskTools.length} task tools registered (total ${customTools.length})`);
  } catch (err) {
    log('buildTaskTool failed (continuing without task tracking):', err?.message || err);
  }

  // --- 8b.4 E.5: ask_user + save_plan tools (Plan mode) ---
  // ask_user bridges back to the renderer's AskUserCard so the model can
  // pose structured multiple-choice questions while planning. save_plan
  // writes the agreed-upon plan to `.knowclaw/plans/` regardless of the
  // active mode (it bypasses the Plan-mode write block — that's the
  // point: the model needs ONE way to persist the plan even while
  // generic write tools are blocked). Both are registered for ALL
  // sessions so the workflow is uniform; the prompt's mode guidance
  // tells the model when each is appropriate. Child sub-agents do NOT
  // inherit them — only the parent talks to the user.
  try {
    const askTools = buildAskUserTool({ askUser: opts.askUser });
    customTools = customTools.concat(askTools);
    log(`customTools: ${askTools.length} ask_user tools registered (total ${customTools.length})`);
  } catch (err) {
    log('buildAskUserTool failed (continuing without ask_user):', err?.message || err);
  }
  try {
    const planTools = buildSavePlanTool({ cwd });
    customTools = customTools.concat(planTools);
    log(`customTools: ${planTools.length} save_plan tools registered (total ${customTools.length})`);
  } catch (err) {
    log('buildSavePlanTool failed (continuing without save_plan):', err?.message || err);
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

    // SK4: workspace-level skills live under `<cwd>/.knowclaw/skills/`.
    // Insert BEFORE the user root so pi SDK's first-discovered-wins
    // collision rule yields the workspace copy when a global user skill
    // shares the same name. This matches the priority applied by the
    // `listSkills` IPC (builtin > workspace > user) so the UI and the
    // runtime stay in sync.
    //
    // We only append the path when (a) a non-global cwd is bound to
    // this session and (b) the directory actually exists — pi SDK is
    // fine with non-existent paths (they yield zero skills) but we skip
    // the entry to keep the diagnostic logs cleaner.
    if (cwd) {
      try {
        const wsSkillDir = path.join(cwd, '.knowclaw', 'skills');
        if (fs.existsSync(wsSkillDir)) {
          additionalSkillPaths.push(wsSkillDir);
        }
      } catch {
        // ignore — workspace skills are best-effort
      }
    }

    if (userSkillsRoot) {
      additionalSkillPaths.push(userSkillsRoot);
    }

    // U1: when KnowClaw runs in "global" mode (cwd === userfile root)
    // we keep `noContextFiles: true` so pi doesn't climb the IPM data
    // tree looking for `AGENTS.md`/`CLAUDE.md`. When the IPC layer
    // binds the session to a real workspace it passes
    // `noContextFiles: false` so the workspace's own context files
    // get scanned and prepended to the system prompt.
    //
    // Default remains `true` (the historical behaviour) so any future
    // caller that forgets to pass the flag stays safe.
    const noContextFiles = opts.noContextFiles !== undefined
      ? Boolean(opts.noContextFiles)
      : true;

    // SK0: build a `skillsOverride` callback when the caller asked to
    // mute one or more skills. `DefaultResourceLoader` invokes it during
    // `reload()` AFTER `loadSkills()` has finished scanning + validating,
    // letting us drop entries by name without re-implementing the SDK's
    // discovery logic. When the mute list is empty we leave the override
    // undefined so pi takes its happy-path branch.
    const disabledSkillsSet = new Set(disabledSkills);
    const skillsOverride = disabledSkillsSet.size > 0
      ? ({ skills, diagnostics }) => ({
          skills: skills.filter((s) => !disabledSkillsSet.has(s.name)),
          diagnostics,
        })
      : undefined;

    resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      systemPrompt,
      noContextFiles,
      additionalSkillPaths,
      skillsOverride,
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
        {
          builtin: BUILTIN_SKILLS_DIR,
          user: userSkillsRoot || '(none)',
          disabled: disabledSkillsSet.size > 0 ? [...disabledSkillsSet] : '(none)',
        },
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

  // Make sure pi's SettingsManager picks up the bash path IPM resolved
  // (see comment block on `applyResolvedBashPath`). Must run BEFORE
  // `createAgentSession` because the SDK reads `settings.json` during
  // its own SettingsManager construction.
  applyResolvedBashPath();

  let session;
  let modelFallbackMessage;
  try {
    log('thinkingLevel requested:', thinkingLevel);
    const result = await createAgentSession({
      cwd,
      sessionManager,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel,
      customTools,
      resourceLoader,
    });
    session = result.session;
    modelFallbackMessage = result.modelFallbackMessage;
  } catch (err) {
    log('createAgentSession failed:', err?.message || err);
    return { sessionId: null, resumed: false, sessionFile: smInfo.sessionFile, error: String(err?.message || err) };
  }

  // --- 9a. Chain the U3 install-guard hook onto the agent ---
  //
  // pi's `createAgentSession` doesn't expose `beforeToolCall` in its
  // options, but the underlying `Agent` instance does carry the field
  // (it's read by `agent-loop.js` before every tool execution). The
  // `AgentSession` constructor installs its own hook that delegates
  // to the extension runtime; we wrap that with ours so:
  //
  //   1. our install-guard runs first and can short-circuit dangerous
  //      bash commands (sudo / apt / brew / ...) or require user
  //      confirmation for pip/npm/pnpm installs;
  //   2. if we *don't* block, we still call through to the original
  //      hook so any future pi extension that registers a `tool_call`
  //      handler keeps working.
  //
  // We monkey-patch *after* createAgentSession returns because the SDK
  // does not let us pass this through cleanly. Future pi versions that
  // add a public option here should let us delete this dance.
  if (session && typeof opts.beforeToolCall === 'function') {
    try {
      const agent = session.agent;
      const inner = agent.beforeToolCall;
      agent.beforeToolCall = async (event, signal) => {
        const mine = await opts.beforeToolCall(event, signal);
        if (mine && mine.block) return mine;
        if (typeof inner === 'function') return inner.call(agent, event, signal);
        return undefined;
      };
      log('beforeToolCall: install-guard hook chained onto agent');
    } catch (err) {
      log('failed to install beforeToolCall hook (continuing without guard):', err?.message || err);
    }
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
