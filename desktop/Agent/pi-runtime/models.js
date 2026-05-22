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
];

// Reasoning-model ids that explicitly DO support image input.
// Kept separate because the generic 'o1' / 'o3' substrings would
// otherwise catch `o1-mini` / `o3-mini` (which are text-only).
const VISION_REASONING_EXACT = [
  'o1', // bare `o1` is the vision-capable flagship
  'o3', // bare `o3` is the vision-capable flagship
];

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
      input: inferModelInputs(ipmConfig.model),
    },
  ];

  if (ipmConfig.summaryModel && ipmConfig.summaryModel !== ipmConfig.model) {
    models.push({
      id: ipmConfig.summaryModel,
      name: ipmConfig.summaryModel,
      ...DEFAULT_MODEL_SHAPE,
      input: inferModelInputs(ipmConfig.summaryModel),
      maxTokens: 4096,
    });
  }

  // U0.5: pick the OpenAI-compatible endpoint family based on the
  // user's `apiMode` preference.
  //
  // Why this matters:
  //   - OpenAI's Chat Completions protocol *never* returns the raw
  //     thinking text from reasoning models. The official docs even
  //     state that scraping reasoning by other means may violate the
  //     AUP. Chat models like GPT-4o have no reasoning capability at
  //     all. → Picking 'chat' means the user almost certainly won't
  //     see a thinking stream unless their gateway non-standardly
  //     injects `reasoning_content` deltas (DeepSeek-R1, Qwen3-Thinking,
  //     self-hosted vLLM, …).
  //   - The Responses API (`/responses`) emits
  //     `response.reasoning_summary_text.delta`, which pi-ai already
  //     translates into our `thinking_delta` stream. Major
  //     OpenAI-compatible gateways (e.g. CloseAI) advertise full
  //     Responses support and prefer it for reasoning workloads
  //     (~20-minute request budget vs. ~5 minutes on Chat).
  //
  // We let `apiMode` choose; default is set in ipmConfig.js.
  const api = ipmConfig.apiMode === 'chat' ? 'openai-completions' : 'openai-responses';

  modelRegistry.registerProvider(IPM_PROVIDER_ID, {
    name: ipmConfig.apiMode === 'chat'
      ? 'IPM (OpenAI Chat Completions)'
      : 'IPM (OpenAI Responses)',
    baseUrl: ipmConfig.baseURL,
    apiKey: 'IPM_OPENAI_API_KEY',
    api,
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
    // U8b-1: surface the declared input modalities so the renderer
    // can decide whether to expose image-attachment UI for the
    // currently selected model. Falls back to `['text']` if the
    // upstream Model object didn't carry the field.
    input: Array.isArray(m.input) && m.input.length ? [...m.input] : ['text'],
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
