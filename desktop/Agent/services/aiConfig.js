// desktop/Agent/services/aiConfig.js
//
// 统一的 AI 配置读取/规范化层。
//
// 历史：早期 IPM 仅支持单一 OpenAI 兼容配置（state.prefs.llm），并由两条
// 并行路径消费——LangChain 工厂（services/llm.js）与 pi-runtime
// （pi-runtime/ipmConfig.js）。本模块把所有读取逻辑合并到一个地方，并
// 引入多 Provider、多 API 配置、按功能角色分配模型的新结构。
//
// 数据结构（state.prefs.ai）：
//   {
//     providers: [
//       {
//         id: string,                 唯一 ID
//         name: string,               显示名，例如 "OpenAI 官方"
//         type: 'openai-compatible' | 'openai' | 'anthropic' | 'gemini',
//         baseURL: string,            可空，按 type 提供默认
//         apiKey: string,
//         apiMode: 'responses' | 'chat',  仅对 OpenAI 类生效
//         modelsCache: {
//           fetchedAt: ISOString,
//           models: Array<{ id: string, name?: string }>
//         }
//       }
//     ],
//     roleAssignments: {
//       knowclaw:          Array<{ providerId, model, apiMode?, supportsImages? }>, // KnowClaw 可多个
//       classification:    { providerId, model } | null,
//       summary:           { providerId, model } | null,
//       preferenceParsing: { providerId, model } | null
//     }
//   }
//
// 旧 prefs.llm 兼容：当 state.prefs.ai 不存在或为空时，会基于 prefs.llm
// 合成一个虚拟 provider 与默认 roleAssignments，保证旧用户配置无需迁移
// 即可继续工作。

import fs from 'node:fs';

export const PROVIDER_TYPES = Object.freeze([
  'openai-compatible',
  'openai',
  'anthropic',
  'gemini',
]);

export const ROLE_NAMES = Object.freeze([
  'knowclaw',
  'classification',
  'summary',
  'preferenceParsing',
]);

// 旧 prefs.llm 迁移到 prefs.ai 时使用的固定 provider ID，前缀让它在 UI
// 上能被识别为"自动迁移而来"，便于用户日后整理。
export const LEGACY_PROVIDER_ID = 'legacy-openai';

const VALID_API_MODES = new Set(['chat', 'responses']);

/**
 * 把任意值规范为 apiMode。
 * @param {unknown} raw
 * @param {'chat' | 'responses'} fallback
 * @returns {'chat' | 'responses'}
 */
export function normalizeApiMode(raw, fallback = 'responses') {
  const v = String(raw || '').trim().toLowerCase();
  return VALID_API_MODES.has(v) ? v : fallback;
}

/**
 * 把任意值规范为 provider 类型；非法值统一退化为 openai-compatible，
 * 因为这是项目最早支持的形态，也是中转站最普遍的协议。
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeProviderType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return PROVIDER_TYPES.includes(v) ? v : 'openai-compatible';
}

/**
 * 给 provider 类型推断默认 baseURL。openai-compatible 必须由用户填写，
 * 其它类型在 UI 留空时使用官方端点。
 * @param {string} type
 * @returns {string}
 */
export function defaultBaseUrlFor(type) {
  switch (type) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'openai-compatible':
    default:
      return '';
  }
}

function trimString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function sanitizeModelEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const id = raw.trim();
    if (!id) return null;
    return { id, name: id };
  }
  if (typeof raw === 'object') {
    const id = trimString(raw.id);
    if (!id) return null;
    return {
      id,
      name: trimString(raw.name) || id,
    };
  }
  return null;
}

function sanitizeModelsCache(raw) {
  if (!raw || typeof raw !== 'object') return { fetchedAt: '', models: [] };
  const models = Array.isArray(raw.models)
    ? raw.models.map(sanitizeModelEntry).filter(Boolean)
    : [];
  const fetchedAt = trimString(raw.fetchedAt);
  return { fetchedAt, models };
}

/**
 * 规范化单个 provider 配置。
 * @param {unknown} raw
 * @returns {object | null}
 */
export function sanitizeProvider(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = trimString(raw.id);
  if (!id) return null;
  const type = normalizeProviderType(raw.type);
  const baseURL = trimString(raw.baseURL) || defaultBaseUrlFor(type);
  return {
    id,
    name: trimString(raw.name) || id,
    type,
    baseURL,
    apiKey: trimString(raw.apiKey),
    apiMode: normalizeApiMode(raw.apiMode, 'responses'),
    modelsCache: sanitizeModelsCache(raw.modelsCache),
  };
}

function sanitizeAssignment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const providerId = trimString(raw.providerId);
  const model = trimString(raw.model);
  if (!providerId || !model) return null;
  const out = { providerId, model };
  if (raw.apiMode) out.apiMode = normalizeApiMode(raw.apiMode, 'responses');
  if (typeof raw.supportsImages === 'boolean') out.supportsImages = raw.supportsImages;
  return out;
}

function sanitizeAssignmentList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const a = sanitizeAssignment(item);
    if (!a) continue;
    const key = `${a.providerId}::${a.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * 规范化整个 prefs.ai 配置。
 * @param {unknown} raw
 * @returns {{
 *   providers: ReturnType<typeof sanitizeProvider>[],
 *   roleAssignments: {
 *     knowclaw: ReturnType<typeof sanitizeAssignment>[],
 *     classification: ReturnType<typeof sanitizeAssignment> | null,
 *     summary: ReturnType<typeof sanitizeAssignment> | null,
 *     preferenceParsing: ReturnType<typeof sanitizeAssignment> | null,
 *   }
 * }}
 */
export function sanitizeAiSettings(raw) {
  const providers = Array.isArray(raw?.providers)
    ? raw.providers.map(sanitizeProvider).filter(Boolean)
    : [];
  const validProviderIds = new Set(providers.map((p) => p.id));
  const filterByProvider = (a) => (a && validProviderIds.has(a.providerId) ? a : null);

  const ra = raw?.roleAssignments || {};
  return {
    providers,
    roleAssignments: {
      knowclaw: sanitizeAssignmentList(ra.knowclaw).filter((a) => validProviderIds.has(a.providerId)),
      classification: filterByProvider(sanitizeAssignment(ra.classification)),
      summary: filterByProvider(sanitizeAssignment(ra.summary)),
      preferenceParsing: filterByProvider(sanitizeAssignment(ra.preferenceParsing)),
    },
  };
}

/**
 * 把旧的 prefs.llm 映射成新的 prefs.ai 形态，保证 legacy 配置能直接驱动
 * 新的角色解析层。仅当 legacy 至少有 apiKey + baseURL + model 时返回有效
 * 结构；否则返回空配置（providers: []）。
 *
 * @param {unknown} legacyLlm  state.prefs.llm
 * @returns {ReturnType<typeof sanitizeAiSettings>}
 */
export function buildAiFromLegacyLlm(legacyLlm) {
  if (!legacyLlm || typeof legacyLlm !== 'object') {
    return sanitizeAiSettings(null);
  }
  const apiKey = trimString(legacyLlm.apiKey);
  const baseURL = trimString(legacyLlm.baseURL);
  const model = trimString(legacyLlm.model);
  const summaryModel = trimString(legacyLlm.summaryModel);
  if (!apiKey || !baseURL || !model) {
    return sanitizeAiSettings(null);
  }
  const apiMode = normalizeApiMode(legacyLlm.apiMode, 'responses');
  const cachedModels = [{ id: model, name: model }];
  if (summaryModel && summaryModel !== model) {
    cachedModels.push({ id: summaryModel, name: summaryModel });
  }
  const provider = {
    id: LEGACY_PROVIDER_ID,
    name: '旧版 OpenAI 兼容配置',
    type: 'openai-compatible',
    baseURL,
    apiKey,
    apiMode,
    modelsCache: { fetchedAt: '', models: cachedModels },
  };
  return {
    providers: [provider],
    roleAssignments: {
      knowclaw: [{ providerId: LEGACY_PROVIDER_ID, model, apiMode }],
      classification: { providerId: LEGACY_PROVIDER_ID, model },
      summary: { providerId: LEGACY_PROVIDER_ID, model: summaryModel || model },
      preferenceParsing: { providerId: LEGACY_PROVIDER_ID, model },
    },
  };
}

/**
 * 直接从 state 对象解析 AI 配置：优先 prefs.ai，否则迁移自 prefs.llm。
 * 不读文件，便于上层（如 IPC handler）复用已有 state 对象。
 * @param {object | null | undefined} state
 * @returns {ReturnType<typeof sanitizeAiSettings>}
 */
export function readAiSettingsFromState(state) {
  const ai = state?.prefs?.ai;
  if (ai && typeof ai === 'object' && Array.isArray(ai.providers) && ai.providers.length > 0) {
    return sanitizeAiSettings(ai);
  }
  // 没有 prefs.ai 时，回退迁移自 prefs.llm。
  return buildAiFromLegacyLlm(state?.prefs?.llm);
}

/**
 * 从 IPM_STATE_PATH 读取并解析 AI 配置。失败时返回空配置而不是抛异常，
 * 让调用方（KnowClaw / 分类 Agent / 摘要）能更优雅地降级处理。
 * @returns {ReturnType<typeof sanitizeAiSettings>}
 */
export function getAiSettings() {
  const statePath = process.env.IPM_STATE_PATH || '';
  if (!statePath) {
    return readAiSettingsFromState(null);
  }
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    return readAiSettingsFromState(state);
  } catch {
    return readAiSettingsFromState(null);
  }
}

/**
 * 在 settings 中按 id 查找 provider。
 * @param {ReturnType<typeof sanitizeAiSettings>} settings
 * @param {string} providerId
 */
export function findProvider(settings, providerId) {
  if (!settings || !providerId) return null;
  return settings.providers.find((p) => p.id === providerId) || null;
}

/**
 * 解析某个角色的有效模型配置。
 *   - knowclaw 角色返回完整列表，每个元素带 provider + model 元数据。
 *   - 其余角色返回单个配置或 null。
 *
 * 当某个 assignment 引用了不存在的 providerId 时，会被自动剔除（已经在
 * sanitizeAiSettings 阶段处理）。当某个角色没有有效分配时：
 *   - classification / preferenceParsing：回退到 knowclaw 列表的第一个；
 *   - summary：先回退到 classification，再回退到 knowclaw 列表第一个。
 * 这样能避免用户只配了 KnowClaw 模型却让其它功能直接报错。
 *
 * @param {ReturnType<typeof sanitizeAiSettings>} settings
 * @param {string} role
 * @returns {Array<{provider: object, model: string, apiMode?: 'chat' | 'responses', supportsImages?: boolean}>}
 */
export function resolveRole(settings, role) {
  if (!settings) return [];
  const list = (a) => {
    if (!a) return [];
    const provider = findProvider(settings, a.providerId);
    if (!provider) return [];
    return [{ provider, model: a.model, apiMode: a.apiMode, supportsImages: a.supportsImages }];
  };

  const knowclawResolved = (settings.roleAssignments.knowclaw || [])
    .map((a) => {
      const provider = findProvider(settings, a.providerId);
      if (!provider) return null;
      return { provider, model: a.model, apiMode: a.apiMode, supportsImages: a.supportsImages };
    })
    .filter(Boolean);

  switch (role) {
    case 'knowclaw':
      return knowclawResolved;
    case 'classification': {
      const direct = list(settings.roleAssignments.classification);
      if (direct.length) return direct;
      return knowclawResolved.slice(0, 1);
    }
    case 'preferenceParsing': {
      const direct = list(settings.roleAssignments.preferenceParsing);
      if (direct.length) return direct;
      const cls = list(settings.roleAssignments.classification);
      if (cls.length) return cls;
      return knowclawResolved.slice(0, 1);
    }
    case 'summary': {
      const direct = list(settings.roleAssignments.summary);
      if (direct.length) return direct;
      const cls = list(settings.roleAssignments.classification);
      if (cls.length) return cls;
      return knowclawResolved.slice(0, 1);
    }
    default:
      return [];
  }
}

/**
 * 取某个角色的"主"配置（第一条），不存在时返回 null。
 * @param {ReturnType<typeof sanitizeAiSettings>} settings
 * @param {string} role
 * @returns {{provider: object, model: string} | null}
 */
export function getRoleConfig(settings, role) {
  const list = resolveRole(settings, role);
  return list.length > 0 ? list[0] : null;
}

/**
 * 给定 settings，返回 KnowClaw 所有可用模型配置（带 provider 信息）。
 * @param {ReturnType<typeof sanitizeAiSettings>} settings
 */
export function getKnowClawModelConfigs(settings) {
  return resolveRole(settings, 'knowclaw');
}

/**
 * 把 apiKey 等敏感字段做脱敏，方便日志输出。
 * @param {object | null} provider
 */
export function describeProvider(provider) {
  if (!provider) return null;
  const { apiKey, ...rest } = provider;
  return {
    ...rest,
    apiKeyPreview: apiKey ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}` : '',
  };
}
