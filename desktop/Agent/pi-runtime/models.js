// desktop/Agent/pi-runtime/models.js
//
// Model + provider plumbing for the new pi-based KnowClaw runtime.
//
// Responsibilities:
//   1. Register the `ipm-openai` provider directly on a ModelRegistry
//      instance (containing the user-configured model and, when
//      different, the summary model).
//   2. Provide a no-disk-IO ModelRegistry.
//   3. Expose helpers to query the registry without leaking the 40+
//      built-in pi models (which appear "available" merely because the
//      IPM OPENAI_API_KEY happens to be in process.env).
//
// Design note: Earlier revisions used extensionFactories +
// DefaultResourceLoader, but provider registrations made that way are
// only flushed when ExtensionRunner.bindCore() runs (inside
// AgentSession startup). That makes it impossible to verify the model
// list *before* creating the session. Calling
// `modelRegistry.registerProvider()` directly is the correct approach
// for programmatic (non-extension) integrations.

import { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { IPM_PROVIDER_ID } from './auth.js';

const DEFAULT_MODEL_SHAPE = {
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

/**
 * Register the `ipm-openai` provider directly on the given
 * ModelRegistry. If `ipmConfig` is null, this is a no-op and no
 * provider/models are added.
 *
 * @param {*} modelRegistry
 * @param {import('./ipmConfig.js').IpmLlmConfig | null} ipmConfig
 */
export function registerIpmProvider(modelRegistry, ipmConfig) {
  if (!modelRegistry || !ipmConfig) return;

  const models = [
    {
      id: ipmConfig.model,
      name: ipmConfig.model,
      ...DEFAULT_MODEL_SHAPE,
    },
  ];

  if (ipmConfig.summaryModel && ipmConfig.summaryModel !== ipmConfig.model) {
    models.push({
      id: ipmConfig.summaryModel,
      name: ipmConfig.summaryModel,
      ...DEFAULT_MODEL_SHAPE,
      maxTokens: 4096,
    });
  }

  modelRegistry.registerProvider(IPM_PROVIDER_ID, {
    name: 'IPM (OpenAI-compatible)',
    baseUrl: ipmConfig.baseURL,
    apiKey: 'IPM_OPENAI_API_KEY',
    api: 'openai-completions',
    models,
  });
}

/**
 * Build an in-memory ModelRegistry — never reads/writes
 * `~/.pi/agent/models.json`.
 * @param {*} authStorage
 */
export function buildModelRegistry(authStorage) {
  return ModelRegistry.inMemory(authStorage);
}

function modelShape(m) {
  if (!m) return null;
  return {
    provider: m.provider,
    id: m.id,
    name: m.name || m.id,
  };
}

/**
 * Get all models registered under the `ipm-openai` provider.
 * @param {*} modelRegistry
 */
export function listIpmModels(modelRegistry) {
  if (!modelRegistry) return [];
  const candidates = ['list', 'all', 'getAll', 'getAvailable'];
  for (const fnName of candidates) {
    const fn = modelRegistry[fnName];
    if (typeof fn !== 'function') continue;
    try {
      const result = fn.call(modelRegistry);
      const resolve = (value) => {
        const arr = Array.isArray(value) ? value : [];
        return arr
          .filter((m) => m && m.provider === IPM_PROVIDER_ID)
          .map(modelShape)
          .filter(Boolean);
      };
      if (result && typeof result.then === 'function') continue;
      const arr = resolve(result);
      if (arr.length) return arr;
    } catch {
      // try next candidate
    }
  }
  return [];
}

/**
 * Async variant — uses `getAvailable()` which is the most reliable.
 * @param {*} modelRegistry
 */
export async function listIpmModelsAsync(modelRegistry) {
  if (!modelRegistry || typeof modelRegistry.getAvailable !== 'function') {
    return listIpmModels(modelRegistry);
  }
  try {
    const all = await modelRegistry.getAvailable();
    return (Array.isArray(all) ? all : [])
      .filter((m) => m && m.provider === IPM_PROVIDER_ID)
      .map(modelShape)
      .filter(Boolean);
  } catch {
    return listIpmModels(modelRegistry);
  }
}

/**
 * Locate the Model object for a given id under `ipm-openai`.
 * @param {*} modelRegistry
 * @param {string} modelId
 */
export function findIpmModel(modelRegistry, modelId) {
  if (!modelRegistry || !modelId) return null;
  if (typeof modelRegistry.find === 'function') {
    try {
      const m = modelRegistry.find(IPM_PROVIDER_ID, modelId);
      if (m) return m;
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * Get the default model — preferred by `ipmConfig.model`.
 * @param {*} modelRegistry
 * @param {import('./ipmConfig.js').IpmLlmConfig | null} ipmConfig
 */
export function getDefaultIpmModel(modelRegistry, ipmConfig) {
  if (!ipmConfig) return null;
  return findIpmModel(modelRegistry, ipmConfig.model);
}
