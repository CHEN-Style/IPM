// desktop/Agent/services/modelProviders.js
//
// Provider 适配器层：在统一接口下封装不同厂商的能力差异。
//
// 第一版支持的 provider 类型：
//   - openai-compatible  任意 OpenAI 兼容 API（中转站、自建 vLLM、Ollama …）
//   - openai             OpenAI 官方
//   - anthropic          Claude 官方
//   - gemini             Google Gemini 官方
//
// 对外暴露三类能力：
//   - listProviderModels(provider): 拉取该 provider 真实可用的模型列表
//   - testProviderConnection(provider, modelId): 用很小的请求验证连通性
//   - createChatModelForProvider(provider, modelId): 构造 LangChain 兼容
//     的 ChatModel 实例，供 services/llm.js 这条遗留路径（分类 / 偏好解
//     析 / 摘要）使用。
//
// 设计取舍：
//   - 模型发现 / 测试统一用 fetch + 厂商原生 REST API，零依赖，错误更易
//     读。
//   - LangChain 模型构建则按 provider 类型动态 import 对应包：
//       openai / openai-compatible → @langchain/openai（已安装）
//       anthropic                  → @langchain/anthropic（按需安装）
//       gemini                     → @langchain/google-genai（按需安装）
//     未安装时给出明确错误，提示用户运行 npm install。

import { defaultBaseUrlFor, normalizeApiMode } from './aiConfig.js';

const DEFAULT_TIMEOUT_MS = 15_000;

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function resolveBaseURL(provider) {
  return trim(provider?.baseURL) || defaultBaseUrlFor(provider?.type || 'openai-compatible');
}

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 模型发现 ----------

/**
 * 拉取 OpenAI / OpenAI 兼容 API 的模型清单。
 * 端点：GET {baseURL}/models
 */
async function listOpenAIModels(provider) {
  const baseURL = resolveBaseURL(provider);
  if (!baseURL) throw new Error('请填写 API Base URL');
  const apiKey = trim(provider.apiKey);
  if (!apiKey) throw new Error('请填写 API Key');

  const url = baseURL.replace(/\/$/, '') + '/models';
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return data
    .map((m) => {
      if (!m) return null;
      const id = trim(m.id || m.model || m.name);
      if (!id) return null;
      return { id, name: trim(m.name) || id };
    })
    .filter(Boolean);
}

/**
 * 拉取 Anthropic 官方模型清单。
 * 端点：GET {baseURL}/v1/models（默认 baseURL 已含域名）
 */
async function listAnthropicModels(provider) {
  const baseURL = resolveBaseURL(provider).replace(/\/$/, '');
  const apiKey = trim(provider.apiKey);
  if (!apiKey) throw new Error('请填写 API Key');

  const url = `${baseURL}/v1/models`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((m) => {
      const id = trim(m?.id);
      if (!id) return null;
      return { id, name: trim(m?.display_name) || id };
    })
    .filter(Boolean);
}

/**
 * 拉取 Google Gemini 官方模型清单。
 * 端点：GET {baseURL}/models?key=...
 */
async function listGeminiModels(provider) {
  const baseURL = resolveBaseURL(provider).replace(/\/$/, '');
  const apiKey = trim(provider.apiKey);
  if (!apiKey) throw new Error('请填写 API Key');

  const url = `${baseURL}/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const json = await res.json();
  const data = Array.isArray(json?.models) ? json.models : [];
  return data
    .filter((m) => {
      // 只保留支持 generateContent 的模型，避免 embedding-only 出现在下拉里
      const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      return methods.length === 0 || methods.includes('generateContent');
    })
    .map((m) => {
      const raw = trim(m?.name);
      if (!raw) return null;
      // Gemini 返回的 name 是 "models/gemini-1.5-pro"，去掉前缀更友好
      const id = raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
      return { id, name: trim(m?.displayName) || id };
    })
    .filter(Boolean);
}

/**
 * 统一的模型发现入口。
 * @param {object} provider 规范化后的 provider（来自 aiConfig.sanitizeProvider）
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listProviderModels(provider) {
  if (!provider) throw new Error('provider is required');
  const type = trim(provider.type) || 'openai-compatible';
  switch (type) {
    case 'openai':
    case 'openai-compatible':
      return listOpenAIModels(provider);
    case 'anthropic':
      return listAnthropicModels(provider);
    case 'gemini':
      return listGeminiModels(provider);
    default:
      throw new Error(`unsupported provider type: ${type}`);
  }
}

// ---------- 连接测试 ----------

/**
 * 尝试用一条最小化请求验证 provider + model 的可用性。
 * 不同 provider 走最便宜的接口；任意非 2xx 视为失败。
 *
 * @param {object} provider
 * @param {string} modelId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function testProviderConnection(provider, modelId) {
  if (!provider) return { ok: false, error: 'provider is required' };
  const model = trim(modelId);
  if (!model) return { ok: false, error: '请先选择或输入要测试的模型 ID' };
  const apiKey = trim(provider.apiKey);
  if (!apiKey) return { ok: false, error: '请填写 API Key' };

  const type = trim(provider.type) || 'openai-compatible';
  try {
    if (type === 'openai' || type === 'openai-compatible') {
      // 使用 chat/completions 而不是 responses，几乎所有兼容网关都实现。
      const baseURL = resolveBaseURL(provider).replace(/\/$/, '');
      const url = `${baseURL}/chat/completions`;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 4,
          temperature: 0,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}` };
      }
      return { ok: true };
    }
    if (type === 'anthropic') {
      const baseURL = resolveBaseURL(provider).replace(/\/$/, '');
      const url = `${baseURL}/v1/messages`;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}` };
      }
      return { ok: true };
    }
    if (type === 'gemini') {
      const baseURL = resolveBaseURL(provider).replace(/\/$/, '');
      const url = `${baseURL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 4, temperature: 0 },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}` };
      }
      return { ok: true };
    }
    return { ok: false, error: `unsupported provider type: ${type}` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ---------- LangChain ChatModel 构建 ----------

/**
 * 把 provider + model 构造成一个 LangChain BaseChatModel，供分类 Agent /
 * 偏好解析 / 摘要服务使用。
 *
 * - OpenAI / OpenAI 兼容：使用 @langchain/openai 的 ChatOpenAI。
 * - Anthropic / Gemini：动态 import 对应包，未安装时抛出可读错误。
 *
 * @param {object} provider 规范化后的 provider
 * @param {string} modelId
 * @param {object} [opts]   传给具体模型构造函数的扩展参数（如 temperature）
 * @returns {Promise<any>}
 */
export async function createChatModelForProvider(provider, modelId, opts = {}) {
  if (!provider) throw new Error('provider is required');
  const model = trim(modelId);
  if (!model) throw new Error('model id is required');
  const apiKey = trim(provider.apiKey);
  if (!apiKey) throw new Error('该 Provider 缺少 API Key');

  const type = trim(provider.type) || 'openai-compatible';
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0;

  if (type === 'openai' || type === 'openai-compatible') {
    const baseURL = resolveBaseURL(provider);
    const { ChatOpenAI } = await import('@langchain/openai');
    return new ChatOpenAI({
      apiKey,
      model,
      temperature,
      configuration: { baseURL },
    });
  }
  if (type === 'anthropic') {
    let mod;
    try {
      mod = await import('@langchain/anthropic');
    } catch (err) {
      throw new Error('未安装 @langchain/anthropic 依赖，无法在分类/摘要等功能中使用 Claude 官方 API。请先在 desktop 目录下运行 npm install @langchain/anthropic');
    }
    const baseURL = resolveBaseURL(provider);
    const ChatAnthropic = mod.ChatAnthropic || mod.default?.ChatAnthropic;
    if (!ChatAnthropic) throw new Error('@langchain/anthropic 未导出 ChatAnthropic');
    return new ChatAnthropic({
      apiKey,
      model,
      temperature,
      anthropicApiUrl: baseURL || undefined,
    });
  }
  if (type === 'gemini') {
    let mod;
    try {
      mod = await import('@langchain/google-genai');
    } catch (err) {
      throw new Error('未安装 @langchain/google-genai 依赖，无法在分类/摘要等功能中使用 Gemini 官方 API。请先在 desktop 目录下运行 npm install @langchain/google-genai');
    }
    const ChatGoogleGenerativeAI = mod.ChatGoogleGenerativeAI || mod.default?.ChatGoogleGenerativeAI;
    if (!ChatGoogleGenerativeAI) throw new Error('@langchain/google-genai 未导出 ChatGoogleGenerativeAI');
    return new ChatGoogleGenerativeAI({
      apiKey,
      model,
      temperature,
    });
  }
  throw new Error(`unsupported provider type: ${type}`);
}

// ---------- KnowClaw / pi-runtime 兼容 ----------

/**
 * 把 provider 类型映射成 pi-coding-agent 的 provider API 字段。
 * pi SDK 第一版只原生支持 openai-completions / openai-responses；其它厂
 * 商可以通过 OpenAI 兼容网关（如 OpenRouter、CloseAI 等）接入。
 *
 * 当 provider 类型是 anthropic / gemini 时返回 null —— 调用方应据此把
 * 该 provider 标记为"无法直接给 KnowClaw 使用"。
 *
 * @param {object} provider
 * @returns {string | null}
 */
export function piApiFamilyFor(provider) {
  if (!provider) return null;
  const type = trim(provider.type) || 'openai-compatible';
  if (type === 'openai' || type === 'openai-compatible') {
    return normalizeApiMode(provider.apiMode, 'responses') === 'chat'
      ? 'openai-completions'
      : 'openai-responses';
  }
  return null;
}
