// desktop/Agent/pi-runtime/ipmConfig.js
//
// IPM LLM configuration reader for the new pi-based runtime.
//
// 升级后行为：
//   - 不再读取扁平的 `state.prefs.llm`，而是通过 services/aiConfig 拿到
//     `state.prefs.ai`（也兼容旧 prefs.llm 自动迁移）。
//   - KnowClaw 角色可被分配多个模型；本模块把它们规范化为 IpmLlmConfig
//     数组，每个元素自带 piProviderId（送给 pi SDK 的 provider 名）。
//   - 环境变量 OPENAI_API_KEY/BASE_URL/MODEL 仍可作为兜底，便于开发与
//     测试。

import fs from 'node:fs';
import {
  getAiSettings,
  getKnowClawModelConfigs,
  normalizeApiMode,
  describeProvider,
} from '../services/aiConfig.js';
import { piApiFamilyFor } from '../services/modelProviders.js';

/**
 * @typedef {'chat' | 'responses'} IpmApiMode
 *
 * Which OpenAI-compatible endpoint pi-ai should target.
 */

/**
 * @typedef {object} IpmLlmConfig
 * @property {string} apiKey
 * @property {string} baseURL
 * @property {string} model           主模型 id
 * @property {string} summaryModel    summary 角色对应模型；若未额外配置则等于 model
 * @property {IpmApiMode} apiMode
 * @property {boolean | undefined} supportsImages 手动覆盖图片输入能力；未设置则按模型名推断
 * @property {string} piProviderId    送给 pi SDK 的 provider id（例如 ipm-openai-xxx）
 * @property {string} providerId      对应 state.prefs.ai.providers[].id
 * @property {string} providerName    Provider 显示名
 * @property {string} providerType    openai / openai-compatible / anthropic / gemini
 * @property {'state' | 'env'} source
 */

/**
 * 把单个 (provider, model) 对规范化为 IpmLlmConfig。
 * 当 provider 的类型不被 pi-runtime 支持（例如 Anthropic / Gemini 官方）
 * 时返回 null —— 上层据此把它从 KnowClaw 模型清单中剔除。
 *
 * @param {object} provider 来自 aiConfig.sanitizeProvider 的 provider
 * @param {string} model
 * @param {string} [summaryModel]  仅当从 prefs.ai 的 summary 角色合成时传入
 * @returns {IpmLlmConfig | null}
 */
function isOpenAIResponsesModel(model) {
  const id = String(model || '').toLowerCase();
  if (!id) return false;
  if (id.startsWith('gpt-')) return true;
  if (id === 'o1' || id === 'o3' || id === 'o4') return true;
  if (/^o[134]-/.test(id)) return true;
  return false;
}

function inferKnowClawApiMode(provider, model, override) {
  if (override) return normalizeApiMode(override, 'responses');
  const providerMode = normalizeApiMode(provider?.apiMode, 'responses');
  const type = String(provider?.type || '').trim().toLowerCase();
  if (providerMode === 'chat') return 'chat';
  if (type === 'openai') return providerMode;
  if (type === 'openai-compatible') {
    // 很多中转站会同时列出 OpenAI 与非 OpenAI 模型，但非 OpenAI 模型
    // 往往只实现 /chat/completions，直接走 /responses 会出现“会话秒断”。
    // 因此 OpenAI 兼容 Provider 下，只有明确的 OpenAI reasoning/chat
    // 家族继续用 responses，其它模型默认走 chat。
    return isOpenAIResponsesModel(model) ? providerMode : 'chat';
  }
  return providerMode;
}

function buildIpmConfig(provider, model, summaryModel, apiModeOverride, supportsImagesOverride) {
  if (!provider || !model) return null;
  const apiFamily = piApiFamilyFor(provider);
  if (!apiFamily) {
    // pi-coding-agent 第一版只直连 openai-* 协议；其它 provider 通过
    // OpenAI 兼容中转。
    return null;
  }
  const apiMode = inferKnowClawApiMode(provider, model, apiModeOverride);
  return {
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    model,
    summaryModel: summaryModel || model,
    apiMode,
    supportsImages: typeof supportsImagesOverride === 'boolean' ? supportsImagesOverride : undefined,
    piProviderId: piProviderIdFor(provider, apiMode),
    providerId: provider.id,
    providerName: provider.name || provider.id,
    providerType: provider.type,
    source: 'state',
  };
}

/**
 * 给定 aiConfig provider，返回它在 pi 端使用的 provider id。
 * 每个 provider 用独立的 id，避免多 Provider 注册时互相覆盖。
 *
 * @param {object} provider
 * @returns {string}
 */
export function piProviderIdFor(provider, apiMode) {
  if (!provider) return 'ipm-openai';
  const raw = String(provider.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const mode = normalizeApiMode(apiMode || provider.apiMode, 'responses');
  return raw ? `ipm-openai-${raw}-${mode}` : `ipm-openai-${mode}`;
}

/**
 * 从环境变量构造一个兜底配置。仅当 state.prefs.ai 为空时启用。
 * @returns {IpmLlmConfig | null}
 */
function buildFromEnv() {
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
    piProviderId: 'ipm-openai-env',
    providerId: 'env-openai',
    providerName: 'env OPENAI_*',
    providerType: 'openai-compatible',
    source: 'env',
  };
}

/**
 * 读出 KnowClaw 角色下所有有效的模型配置列表。
 * 列表第一个元素被视为默认选择。
 *
 * @returns {IpmLlmConfig[]}
 */
export function getIpmLlmConfigs() {
  const settings = getAiSettings();
  const summaryAssignment = settings?.roleAssignments?.summary || null;
  const out = [];
  for (const item of getKnowClawModelConfigs(settings)) {
    // 当该 provider 同时承担 summary 角色时，把 summaryModel 写进 config，
    // 这样 models.js 注册时能给 summary 角色独立暴露一个模型。
    const summaryModel =
      summaryAssignment && summaryAssignment.providerId === item.provider.id
        ? summaryAssignment.model
        : '';
    const cfg = buildIpmConfig(item.provider, item.model, summaryModel, item.apiMode, item.supportsImages);
    if (cfg) out.push(cfg);
  }
  if (out.length > 0) return out;

  const envCfg = buildFromEnv();
  return envCfg ? [envCfg] : [];
}

/**
 * 返回 KnowClaw 的默认配置：列表第一个，或 null。
 * 旧代码（包括外部诊断 IPC）仍可调用，行为等价于"主模型"。
 * @returns {IpmLlmConfig | null}
 */
export function getIpmLlmConfig() {
  const list = getIpmLlmConfigs();
  return list.length > 0 ? list[0] : null;
}

/**
 * Redact sensitive fields for logging.
 * @param {IpmLlmConfig | null} cfg
 */
export function describeIpmConfig(cfg) {
  if (!cfg) return null;
  return {
    source: cfg.source,
    providerId: cfg.providerId,
    providerName: cfg.providerName,
    providerType: cfg.providerType,
    piProviderId: cfg.piProviderId,
    baseURL: cfg.baseURL,
    model: cfg.model,
    summaryModel: cfg.summaryModel,
    apiMode: cfg.apiMode,
    supportsImages: cfg.supportsImages,
    apiKeyPreview: cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}…${cfg.apiKey.slice(-4)}` : '',
  };
}

// ---------------- Search API（沿用旧实现） ----------------

/**
 * @typedef {object} IpmSearchApiConfig
 * @property {'bocha'} provider
 * @property {string} apiKey
 * @property {'state'} source
 */

/**
 * K1 — Read the active web-search API configuration.
 *
 * @returns {IpmSearchApiConfig | null}
 */
export function getSearchApiConfig() {
  const statePath = process.env.IPM_STATE_PATH || '';
  if (!statePath) return null;
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    const cfg = state?.prefs?.searchApi;
    if (!cfg || typeof cfg !== 'object') return null;
    const apiKey = String(cfg.apiKey || '').trim();
    if (!apiKey) return null;
    const provider = cfg.provider === 'bocha' ? 'bocha' : 'bocha';
    return { provider, apiKey, source: 'state' };
  } catch {
    return null;
  }
}

/**
 * Redact sensitive fields for logging.
 * @param {IpmSearchApiConfig | null} cfg
 */
export function describeSearchApiConfig(cfg) {
  if (!cfg) return null;
  return {
    provider: cfg.provider,
    source: cfg.source,
    apiKeyPreview: cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}…${cfg.apiKey.slice(-4)}` : '',
  };
}

/**
 * 调试用：返回给前端的 provider 列表（脱敏）。
 */
export function describeAllProviders() {
  const settings = getAiSettings();
  return settings.providers.map((p) => describeProvider(p));
}
