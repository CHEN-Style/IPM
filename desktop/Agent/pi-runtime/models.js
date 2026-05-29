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

// U0 (revised): we mark every IPM-registered model as `reasoning: true`
// by default. This is the "permissive" stance — we trust user intent
// instead of guessing model capability from a name string.
//
// Why this is safe:
//   - pi-ai's openai-completions provider only injects the
//     `reasoning_effort` request parameter when the *clamped*
//     thinking level !== 'off' (see openai-completions.js around
//     `clampThinkingLevel(...)`). When the user keeps thinking at
//     'off' (the historical IPM behaviour) nothing changes on the wire.
//   - Receiving thinking is independent of this flag: the provider
//     always parses `reasoning_content` / `reasoning` / `reasoning_text`
//     from the SSE stream when present.
//
// Trade-off: if the user picks a non-'off' thinking level and the
// upstream model doesn't accept `reasoning_effort`, the gateway may
// 4xx. We surface that via a soft UI hint when a non-'off' turn
// finishes without emitting any `thinking_delta` (or via the standard
// error path). Letting the real API be the source of truth is the
// honest default.
const DEFAULT_MODEL_SHAPE = {
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

// U8b-1: heuristic vision-capability inference.
//
// pi-ai's openai-responses provider only sends `input_image` content
// blocks when the registered model declares `input: [..., 'image']`.
// IPM hits an OpenAI-compatible gateway (`ipm-openai`) whose actual
// available-model list is opaque — we just have whatever model id
// string the user picked. Asking the gateway "do you support vision?"
// is non-standardised, so we infer from the model id itself.
//
// The list below covers the families that are vision-capable as of
// 2026-Q2 (OpenAI: gpt-4o / gpt-4.1 / gpt-5 / o1-vision / o3-vision;
// Anthropic: claude-3.x sonnet/opus/haiku; Google: gemini-1.5/2.x).
// We err on the side of "enable when uncertain" — if the gateway
// route actually doesn't support images, the upstream returns a
// structured error which surfaces as a toast in the UI.
//
// `o1-mini` and `o3-mini` are intentionally NOT in the hint list:
// they're text-only reasoning models. The `vision` substring lets
// gateways tag custom routes explicitly (e.g. `myorg/gpt-4o-vision`).
const VISION_MODEL_HINTS = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'claude-3',
  'gemini-1.5',
  'gemini-2',
  'vision',
  'vl',
  'glm-4v',
  'qwen-vl',
  'qwen2.5-vl',
  'doubao-vision',
];

// Reasoning-model ids that explicitly DO support image input.
// Kept separate because the generic 'o1' / 'o3' substrings would
// otherwise catch `o1-mini` / `o3-mini` (which are text-only).
const VISION_REASONING_EXACT = [
  'o1', // bare `o1` is the vision-capable flagship
  'o3', // bare `o3` is the vision-capable flagship
];

function inferReasoningCapability(modelId, apiMode) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  if (apiMode === 'responses') {
    return id.startsWith('gpt-5') || id === 'o1' || id === 'o3' || id === 'o4' || /^o[134]-/.test(id);
  }
  // Chat Completions 兼容模型默认不声明 reasoning，避免 pi provider 注入
  // reasoning_effort 后被非 OpenAI 网关拒绝。后续如需支持 DeepSeek-R1 /
  // Qwen thinking，可在这里按模型名白名单打开。
  return false;
}

function resolveModelInputs(modelId, supportsImages) {
  if (typeof supportsImages === 'boolean') {
    return supportsImages ? ['text', 'image'] : ['text'];
  }
  return inferModelInputs(modelId);
}

function buildModelShape(modelId, apiMode, overrides = {}) {
  const { supportsImages, ...shapeOverrides } = overrides;
  return {
    id: modelId,
    name: modelId,
    apiMode,
    ...DEFAULT_MODEL_SHAPE,
    reasoning: inferReasoningCapability(modelId, apiMode),
    input: resolveModelInputs(modelId, supportsImages),
    ...shapeOverrides,
  };
}

export function inferModelInputs(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return ['text'];
  if (VISION_MODEL_HINTS.some((h) => id.includes(h))) return ['text', 'image'];
  if (VISION_REASONING_EXACT.some((h) => id === h || id.endsWith(`/${h}`))) {
    return ['text', 'image'];
  }
  return ['text'];
}

/**
 * 把单个 IPM provider 配置注册到 ModelRegistry 上。
 *
 * 多 Provider 升级后，每个 KnowClaw 模型分配都来自一个 provider，多个
 * 分配可能引用相同的 provider。我们按 `piProviderId` 去重，对同一 pi
 * provider 只注册一次，但模型列表合并所有分配。
 *
 * 当 `ipmConfig` 为 null 或缺少 piProviderId 时本函数为 no-op。
 *
 * @param {*} modelRegistry
 * @param {import('./ipmConfig.js').IpmLlmConfig | null} ipmConfig
 */
export function registerIpmProvider(modelRegistry, ipmConfig) {
  if (!modelRegistry || !ipmConfig) return;
  return registerIpmProviders(modelRegistry, [ipmConfig]);
}

/**
 * 批量注册多个 KnowClaw provider 配置。
 *
 * @param {*} modelRegistry
 * @param {Array<import('./ipmConfig.js').IpmLlmConfig>} configs
 */
export function registerIpmProviders(modelRegistry, configs) {
  if (!modelRegistry || !Array.isArray(configs) || configs.length === 0) return;

  // 按 piProviderId 分组，把同一 provider 下被分配的所有模型合并。
  const grouped = new Map();
  for (const cfg of configs) {
    if (!cfg || !cfg.piProviderId) continue;
    if (!grouped.has(cfg.piProviderId)) {
      grouped.set(cfg.piProviderId, { base: cfg, models: new Map() });
    }
    const bucket = grouped.get(cfg.piProviderId);
    bucket.models.set(cfg.model, buildModelShape(cfg.model, cfg.apiMode, { supportsImages: cfg.supportsImages }));
    if (cfg.summaryModel && cfg.summaryModel !== cfg.model) {
      // summary 角色用同一个 provider 时也把它注册进来，方便 UI 一并显示。
      if (!bucket.models.has(cfg.summaryModel)) {
        bucket.models.set(cfg.summaryModel, buildModelShape(cfg.summaryModel, cfg.apiMode, { maxTokens: 4096 }));
      }
    }
  }

  for (const [piProviderId, { base, models }] of grouped) {
    // U0.5: pick the OpenAI-compatible endpoint family based on the
    // user's `apiMode` preference. See historical notes in git for why
    // this matters for reasoning models / thinking streams.
    const api = base.apiMode === 'chat' ? 'openai-completions' : 'openai-responses';
    modelRegistry.registerProvider(piProviderId, {
      name: base.providerName
        ? `${base.providerName} (${api === 'openai-completions' ? 'Chat' : 'Responses'})`
        : (api === 'openai-completions' ? 'IPM (OpenAI Chat Completions)' : 'IPM (OpenAI Responses)'),
      baseUrl: base.baseURL,
      apiKey: `IPM_OPENAI_API_KEY__${piProviderId}`,
      api,
      models: Array.from(models.values()),
    });
  }
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
    apiMode: m.apiMode || null,
    // U8b-1: surface the declared input modalities so the renderer
    // can decide whether to expose image-attachment UI for the
    // currently selected model. Falls back to `['text']` if the
    // upstream Model object didn't carry the field.
    input: Array.isArray(m.input) && m.input.length ? [...m.input] : ['text'],
  };
}

// 判断一个 model 的 provider id 是否属于"IPM 自己注册的"那批。
// 旧版只检查等于 `ipm-openai`；新版用 `ipm-openai-*` 前缀。
function isIpmProviderId(providerId) {
  if (!providerId) return false;
  if (providerId === IPM_PROVIDER_ID) return true;
  return String(providerId).startsWith(`${IPM_PROVIDER_ID}-`);
}

/**
 * 列出所有由 IPM 注册的 provider 下的模型（同步版，尽力而为）。
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
      if (result && typeof result.then === 'function') continue;
      const arr = (Array.isArray(result) ? result : [])
        .filter((m) => m && isIpmProviderId(m.provider))
        .map(modelShape)
        .filter(Boolean);
      if (arr.length) return arr;
    } catch {
      // try next candidate
    }
  }
  return [];
}

/**
 * 异步版：列出所有 IPM 注册的模型。
 * @param {*} modelRegistry
 */
export async function listIpmModelsAsync(modelRegistry) {
  if (!modelRegistry || typeof modelRegistry.getAvailable !== 'function') {
    return listIpmModels(modelRegistry);
  }
  try {
    const all = await modelRegistry.getAvailable();
    return (Array.isArray(all) ? all : [])
      .filter((m) => m && isIpmProviderId(m.provider))
      .map(modelShape)
      .filter(Boolean);
  } catch {
    return listIpmModels(modelRegistry);
  }
}

/**
 * 在指定 provider id 下查找特定模型。
 *   - 当 providerId 未传或为传统的 `ipm-openai` 时，回退到模型清单里
 *     第一个 id 匹配的实例（保留旧调用方式）。
 *   - 否则严格按 provider/id 双键匹配，避免不同 provider 同名模型冲突。
 *
 * @param {*} modelRegistry
 * @param {string} modelId
 * @param {string} [providerId]
 */
export function findIpmModel(modelRegistry, modelId, providerId) {
  if (!modelRegistry || !modelId) return null;
  const pid = providerId || IPM_PROVIDER_ID;
  if (typeof modelRegistry.find === 'function') {
    try {
      const m = modelRegistry.find(pid, modelId);
      if (m) return m;
    } catch {
      // fall through
    }
  }
  // Fallback：扫描所有 IPM provider 找第一个 id 匹配的。
  const all = listIpmModels(modelRegistry);
  if (providerId) {
    return all.find((m) => m.provider === providerId && m.id === modelId) || null;
  }
  return all.find((m) => m.id === modelId) || null;
}

/**
 * 默认模型：用 ipmConfig 指明的 piProviderId + model。
 * @param {*} modelRegistry
 * @param {import('./ipmConfig.js').IpmLlmConfig | null} ipmConfig
 */
export function getDefaultIpmModel(modelRegistry, ipmConfig) {
  if (!ipmConfig) return null;
  return findIpmModel(modelRegistry, ipmConfig.model, ipmConfig.piProviderId);
}
