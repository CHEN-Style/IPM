// desktop/Agent/pi-runtime/ipmConfig.js
//
// IPM LLM configuration reader for the new pi-based runtime.
// Mirrors the resolution order used by the legacy `desktop/Agent/services/llm.js`
// but is intentionally decoupled from `@langchain/openai` so pi-runtime can
// be free of LangChain dependencies.
//
// Resolution order (matches IPM's existing behavior):
//   1. `state.json prefs.llm` pointed to by `process.env.IPM_STATE_PATH`
//      (this is what the IPM settings UI writes through prefs/* IPC).
//   2. `process.env.OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL /
//      OPENAI_SUMMARY_MODEL` (loaded by `desktop/Agent/services/llm.js`
//      at module-load time via dotenv).
//   3. Any one of api key / baseURL / model missing → returns null.
//      Bootstrap will then run in "verification A" mode (no session created).
//
// `summaryModel` falls back to `model` when missing.
//
// NOTE: This file deliberately duplicates a small piece of llm.js. The
// duplication is short-lived: once Phase 12 retires the legacy supervisor,
// llm.js will be deleted and this becomes the single source of truth.

import fs from 'node:fs';

/**
 * @typedef {'chat' | 'responses'} IpmApiMode
 *
 * Which OpenAI-compatible endpoint pi-ai should target:
 *   - 'chat'      → POST {baseURL}/chat/completions
 *                   Use this for legacy gateways, plain GPT-4o style
 *                   chat models, or self-hosted vLLM that already
 *                   emits `reasoning_content` in SSE deltas.
 *   - 'responses' → POST {baseURL}/responses
 *                   REQUIRED to receive thinking summaries from
 *                   OpenAI reasoning models (gpt-5.x, o1, o3, o4, …)
 *                   because Chat Completions never returns raw
 *                   reasoning text. Also gives the gateway up to
 *                   ~20 min per request (vs. ~5 min on Chat) which
 *                   matters for KnowClaw's long-running tasks.
 *
 * Default: 'responses'. CloseAI-style proxies advertise full Responses
 * support and recommend it for reasoning workloads. If a user's
 * gateway truly only speaks Chat Completions, they can fall back via
 * env OPENAI_API_MODE=chat or `prefs.llm.apiMode = 'chat'`.
 */

/**
 * @typedef {object} IpmLlmConfig
 * @property {string} apiKey
 * @property {string} baseURL
 * @property {string} model
 * @property {string} summaryModel
 * @property {IpmApiMode} apiMode
 * @property {'state' | 'env'} source
 */

const VALID_API_MODES = new Set(['chat', 'responses']);

function normalizeApiMode(raw, fallback = 'responses') {
  const v = String(raw || '').trim().toLowerCase();
  return VALID_API_MODES.has(v) ? /** @type {IpmApiMode} */ (v) : fallback;
}

function tryReadStateConfig() {
  const statePath = process.env.IPM_STATE_PATH || '';
  if (!statePath) return null;
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    const llm = state?.prefs?.llm;
    if (!llm || typeof llm !== 'object') return null;
    const apiKey = String(llm.apiKey || '').trim();
    const baseURL = String(llm.baseURL || '').trim();
    const model = String(llm.model || '').trim();
    const summaryModel = String(llm.summaryModel || '').trim();
    // env override beats state.json so power users can flip a single
    // process without having to edit JSON.
    const apiMode = normalizeApiMode(
      process.env.OPENAI_API_MODE || llm.apiMode,
      'responses',
    );
    if (!apiKey || !baseURL || !model) return null;
    return {
      apiKey,
      baseURL,
      model,
      summaryModel: summaryModel || model,
      apiMode,
      source: 'state',
    };
  } catch {
    return null;
  }
}

function tryReadEnvConfig() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const baseURL = String(process.env.OPENAI_BASE_URL || '').trim();
  const model = String(process.env.OPENAI_MODEL || '').trim();
  const summaryModel = String(process.env.OPENAI_SUMMARY_MODEL || '').trim();
  const apiMode = normalizeApiMode(process.env.OPENAI_API_MODE, 'responses');
  if (!apiKey || !baseURL || !model) return null;
  return {
    apiKey,
    baseURL,
    model,
    summaryModel: summaryModel || model,
    apiMode,
    source: 'env',
  };
}

/**
 * Read the active IPM LLM configuration.
 * Returns null if no complete config is available. Callers should treat
 * null as "verification A only — do not create a real session".
 *
 * @returns {IpmLlmConfig | null}
 */
export function getIpmLlmConfig() {
  return tryReadStateConfig() || tryReadEnvConfig();
}

/**
 * Redact sensitive fields for logging.
 * @param {IpmLlmConfig | null} cfg
 */
export function describeIpmConfig(cfg) {
  if (!cfg) return null;
  return {
    source: cfg.source,
    baseURL: cfg.baseURL,
    model: cfg.model,
    summaryModel: cfg.summaryModel,
    apiMode: cfg.apiMode,
    apiKeyPreview: cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}…${cfg.apiKey.slice(-4)}` : '',
  };
}
