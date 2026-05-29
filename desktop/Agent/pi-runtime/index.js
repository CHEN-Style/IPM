// desktop/Agent/pi-runtime/index.js
//
// Public entry point for the KnowClaw runtime backed by
// `@earendil-works/pi-coding-agent`.
//
// 升级后变化：
//   - 支持多 Provider / 多模型注册。
//   - `listAvailableModels()` 返回所有 KnowClaw 角色分配的模型，并通过
//     `provider` 字段区分来源（pi 端的 provider id，例如 ipm-openai-xxx）。
//   - `setModel(providerId, modelId)` 现在校验 (providerId, modelId) 双键。
//   - `currentModelSelection` 改为 `{ providerId, modelId }`，以前的
//     `currentModelId` 仍以 getter 形式保留。

import {
  createSession as _createSession,
  disposeSession as _disposeSession,
  runPoc,
} from './bootstrap.js';
import {
  describeIpmConfig,
  getIpmLlmConfig,
  getIpmLlmConfigs,
} from './ipmConfig.js';
import {
  applyIpmRuntimeKeys,
  buildAuthStorage,
  IPM_PROVIDER_ID,
} from './auth.js';
import {
  registerIpmProviders,
  buildModelRegistry,
  listIpmModelsAsync,
} from './models.js';
import {
  getSessionDir as _getSessionDir,
  listSessions as _listSessions,
} from './sessionFactory.js';

let booted = false;
let bootPromise = null;
/** @type {{providerId: string, modelId: string} | null} */
let currentSelection = null;

export async function bootstrap() {
  if (booted) return;
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    booted = true;
  })();
  return bootPromise;
}

/**
 * Create a KnowClaw one-shot session.
 *
 * @param {object} opts
 */
export async function createKnowClawSession(opts = {}) {
  await bootstrap();
  const effectiveModelId = opts.modelId || currentSelection?.modelId || '';
  const effectiveProviderId = opts.providerId || currentSelection?.providerId || '';
  return runPoc({ ...opts, modelId: effectiveModelId, providerId: effectiveProviderId });
}

/**
 * Create a live `AgentSession`.
 *
 * @param {object} opts
 */
export async function createSession(opts = {}) {
  await bootstrap();
  const effectiveModelId = opts.modelId || currentSelection?.modelId || '';
  const effectiveProviderId = opts.providerId || currentSelection?.providerId || '';
  return _createSession({ ...opts, modelId: effectiveModelId, providerId: effectiveProviderId });
}

export function disposeSession(session, unsubscribe) {
  return _disposeSession(session, unsubscribe);
}

export async function listSessions(cwd) {
  return _listSessions(cwd);
}

export function getSessionDir(cwd) {
  return _getSessionDir(cwd);
}

/**
 * 列出所有 KnowClaw 可用模型。
 * @returns {Promise<Array<{ provider: string, id: string, name: string, isDefault: boolean, input: string[] }>>}
 */
export async function listAvailableModels() {
  const configs = getIpmLlmConfigs();
  const authStorage = buildAuthStorage();
  const modelRegistry = buildModelRegistry(authStorage);
  registerIpmProviders(modelRegistry, configs);
  applyIpmRuntimeKeys(authStorage, configs);
  const models = await listIpmModelsAsync(modelRegistry);

  // 默认模型：用户运行时手动选过的优先；否则取第一个配置项。
  let defaultProviderId = currentSelection?.providerId;
  let defaultModelId = currentSelection?.modelId;
  if ((!defaultProviderId || !defaultModelId) && configs.length > 0) {
    defaultProviderId = configs[0].piProviderId;
    defaultModelId = configs[0].model;
  }
  return models.map((m) => ({
    ...m,
    isDefault: m.provider === defaultProviderId && m.id === defaultModelId,
  }));
}

/**
 * 选择下一次 createSession 使用的模型。
 * @param {string} providerId pi 端 provider id，例如 ipm-openai-xxx
 * @param {string} modelId
 */
export async function setModel(providerId, modelId) {
  if (!providerId || !modelId) {
    throw new Error('setModel: providerId 与 modelId 均不可为空');
  }
  const models = await listAvailableModels();
  if (!models.some((m) => m.provider === providerId && m.id === modelId)) {
    throw new Error(`model not registered: ${providerId}/${modelId}`);
  }
  currentSelection = { providerId, modelId };
}

export function getCurrentModelId() {
  return currentSelection?.modelId || '';
}

export function getCurrentModelSelection() {
  return currentSelection ? { ...currentSelection } : null;
}

/**
 * 调试用：返回当前默认 KnowClaw 配置的脱敏快照。
 */
export function describeCurrentConfig() {
  return describeIpmConfig(getIpmLlmConfig());
}

export async function shutdown() {
  booted = false;
  bootPromise = null;
  currentSelection = null;
}

export { IPM_PROVIDER_ID };
