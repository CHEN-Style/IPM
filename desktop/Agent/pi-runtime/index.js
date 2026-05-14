// desktop/Agent/pi-runtime/index.js
//
// Public entry point for the new KnowClaw runtime backed by
// `@earendil-works/pi-coding-agent`. See KNOWCLAW_REBUILD_PLAN.md for
// the full migration plan.
//
// Public API (stable across phases):
//   bootstrap()                                  — idempotent init hook
//   createKnowClawSession({ cwd, prompt, modelId, mode, sessionFile })
//                                                — Phase-0/1/2 one-shot wrapper
//   createSession({ cwd, modelId, mode, sessionFile })
//                                                — Phase-3 long-lived session
//   disposeSession(session, unsubscribe?)        — safe dispose helper
//   listAvailableModels()                        — current ipm-openai models
//   setModel(providerId, modelId)                — choose model for next session
//   getCurrentModelId()                          — inspect current selection
//   listSessions(cwd)                            — list persisted JSONL sessions
//   getSessionDir(cwd)                           — diagnostic path lookup
//   shutdown()                                   — release resources

import {
  createSession as _createSession,
  disposeSession as _disposeSession,
  runPoc,
} from './bootstrap.js';
import { describeIpmConfig, getIpmLlmConfig } from './ipmConfig.js';
import { applyIpmRuntimeKey, buildAuthStorage, IPM_PROVIDER_ID } from './auth.js';
import {
  registerIpmProvider,
  buildModelRegistry,
  listIpmModelsAsync,
} from './models.js';
import {
  getSessionDir as _getSessionDir,
  listSessions as _listSessions,
} from './sessionFactory.js';

let booted = false;
let bootPromise = null;
let currentModelId = '';

export async function bootstrap() {
  if (booted) return;
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    booted = true;
  })();
  return bootPromise;
}

/**
 * Create a KnowClaw session. If `modelId` is omitted falls back to the
 * previously set `setModel(...)` value, or to the IPM-configured default
 * model. `mode` controls session storage:
 *   - 'continueRecent' (default): resume most recent session for cwd, or
 *     create a new one if none exists. Persists to JSONL.
 *   - 'new': always create a fresh persistent session.
 *   - 'open': open `opts.sessionFile` (required).
 *   - 'inMemory': no persistence (debug only).
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.prompt]
 * @param {string} [opts.modelId]
 * @param {'new' | 'continueRecent' | 'open' | 'inMemory'} [opts.mode]
 * @param {string} [opts.sessionFile]
 */
export async function createKnowClawSession(opts = {}) {
  await bootstrap();
  const effectiveModelId = opts.modelId || currentModelId || '';
  return runPoc({ ...opts, modelId: effectiveModelId });
}

/**
 * Create a live KnowClaw `AgentSession` for long-lived use (IPC bridge,
 * future UI). Caller owns the lifecycle — use `disposeSession()` when
 * finished. Does NOT auto-prompt or auto-dispose.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.modelId]
 * @param {'new' | 'continueRecent' | 'open' | 'inMemory'} [opts.mode]
 * @param {string} [opts.sessionFile]
 */
export async function createSession(opts = {}) {
  await bootstrap();
  const effectiveModelId = opts.modelId || currentModelId || '';
  return _createSession({ ...opts, modelId: effectiveModelId });
}

/**
 * Safely dispose an AgentSession previously returned by `createSession`.
 * Accepts an optional unsubscribe function from `session.subscribe(...)`.
 *
 * @param {*} session
 * @param {Function} [unsubscribe]
 */
export function disposeSession(session, unsubscribe) {
  return _disposeSession(session, unsubscribe);
}

/**
 * List persisted JSONL sessions for the given cwd, newest-first.
 * Returns an empty array if the storage directory does not exist yet.
 *
 * @param {string} cwd
 */
export async function listSessions(cwd) {
  return _listSessions(cwd);
}

/**
 * Get the absolute directory where JSONL session files for `cwd` are
 * stored. Mainly a diagnostic helper for Phase-3 IPC.
 *
 * @param {string} cwd
 */
export function getSessionDir(cwd) {
  return _getSessionDir(cwd);
}

/**
 * List models registered under `ipm-openai`, marking the one matching
 * the IPM config (or `setModel`) as default.
 *
 * @returns {Promise<Array<{ provider: string, id: string, name: string, isDefault: boolean }>>}
 */
export async function listAvailableModels() {
  const ipmConfig = getIpmLlmConfig();
  const authStorage = buildAuthStorage();
  const modelRegistry = buildModelRegistry(authStorage);
  registerIpmProvider(modelRegistry, ipmConfig);
  applyIpmRuntimeKey(authStorage, ipmConfig);
  const models = await listIpmModelsAsync(modelRegistry);
  const defaultId = currentModelId || (ipmConfig ? ipmConfig.model : '');
  return models.map((m) => ({ ...m, isDefault: m.id === defaultId }));
}

/**
 * Choose which model the next `createKnowClawSession()` will use.
 * Validates that the model exists under `ipm-openai`. Persistence /
 * IPC plumbing comes in Phase 3.
 *
 * @param {string} providerId  Only `ipm-openai` is accepted for now.
 * @param {string} modelId
 */
export async function setModel(providerId, modelId) {
  if (providerId !== IPM_PROVIDER_ID) {
    throw new Error(`unsupported provider: ${providerId}`);
  }
  const models = await listAvailableModels();
  if (!models.some((m) => m.id === modelId)) {
    throw new Error(`model not registered under ${IPM_PROVIDER_ID}: ${modelId}`);
  }
  currentModelId = modelId;
}

export function getCurrentModelId() {
  return currentModelId;
}

/**
 * Debug/inspection helper — returns the redacted IPM config currently
 * visible to pi-runtime. Useful for diagnostics IPC in Phase 3.
 */
export function describeCurrentConfig() {
  return describeIpmConfig(getIpmLlmConfig());
}

export async function shutdown() {
  booted = false;
  bootPromise = null;
  currentModelId = '';
}
