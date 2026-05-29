import { ChatOpenAI } from '@langchain/openai';
import { testBochaApiKey } from '../../../Agent/services/searchService.js';
import {
  PROVIDER_TYPES,
  ROLE_NAMES,
  sanitizeAiSettings,
  buildAiFromLegacyLlm,
  readAiSettingsFromState,
  defaultBaseUrlFor,
  normalizeApiMode,
  normalizeProviderType,
} from '../../../Agent/services/aiConfig.js';
import {
  listProviderModels,
  testProviderConnection,
} from '../../../Agent/services/modelProviders.js';

function sanitizeLlm(llm) {
  if (!llm || typeof llm !== 'object') return undefined;
  return {
    apiKey: typeof llm.apiKey === 'string' ? llm.apiKey.trim() : '',
    baseURL: typeof llm.baseURL === 'string' ? llm.baseURL.trim() : '',
    model: typeof llm.model === 'string' ? llm.model.trim() : '',
    summaryModel: typeof llm.summaryModel === 'string' ? llm.summaryModel.trim() : '',
  };
}

const DEFAULT_LLM = {
  apiKey: 'sk-Cx3Ls3gJLkqsrQLI2Fi1aUd3LlI06CEsBcNG1IgpEDH3jd7P',
  baseURL: 'https://api.openai-proxy.org/v1',
  model: 'gpt-5.1',
  summaryModel: 'gpt-5.4-nano',
};

// K1 — Search API persisted config. Currently we only support 博查 (Bocha);
// `provider` is reserved for future expansion (Tavily / Brave / SearXNG / ...).
const DEFAULT_SEARCH_API = {
  provider: 'bocha',
  apiKey: '',
};

function sanitizeSearchApi(cfg) {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const provider = cfg.provider === 'bocha' ? 'bocha' : 'bocha';
  const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '';
  return { provider, apiKey };
}

/**
 * 构造 settings page 与其它代码层都能消费的 prefs 响应。
 *   - 旧 `llm` 字段保留为"分类角色当前生效配置"的快照，方便兼容；
 *   - 新 `ai` 字段是规范化后的多 Provider / 角色分配结构。
 */
function buildPrefsResponse(prefs, normalizeFloatingUploadMode) {
  const llm = sanitizeLlm(prefs.llm);
  const hasLlm = llm && (llm.apiKey || llm.baseURL || llm.model);
  const searchApi = sanitizeSearchApi(prefs.searchApi) || { ...DEFAULT_SEARCH_API };
  // 直接复用 readAiSettingsFromState 的逻辑，保证「prefs.ai 缺失时回退
  // 到 prefs.llm」的迁移行为对 UI 完全透明。
  const ai = readAiSettingsFromState({ prefs });
  return {
    floatingUploadMode: normalizeFloatingUploadMode(prefs.floatingUploadMode || 'auto'),
    llm: hasLlm ? llm : { ...DEFAULT_LLM },
    ai,
    searchApi,
    onboardingDone: Boolean(prefs.onboardingDone),
    userName: typeof prefs.userName === 'string' ? prefs.userName : '',
  };
}

/**
 * 用户从设置页发来的 ai 配置补丁通常已经是合法形态，但为了防止 IPC 层
 * 被任意字段污染 state.json，这里再做一遍规范化。
 */
function sanitizeAiPatch(raw) {
  return sanitizeAiSettings(raw || null);
}

export function registerPrefsIpc({ ipcMain, readState, writeState, normalizeFloatingUploadMode }) {
  if (!ipcMain) throw new Error('registerPrefsIpc: ipcMain is required');

  ipcMain.handle('prefs/get', async () => {
    const state = readState();
    const prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : {};
    return { ok: true, prefs: buildPrefsResponse(prefs, normalizeFloatingUploadMode) };
  });

  ipcMain.handle('prefs/set', async (_evt, payload) => {
    const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
    const state = readState();
    state.prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : {};
    const changedKeys = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'floatingUploadMode')) {
      state.prefs.floatingUploadMode = normalizeFloatingUploadMode(patch.floatingUploadMode);
      changedKeys.push('floatingUploadMode');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'llm')) {
      state.prefs.llm = sanitizeLlm(patch.llm);
      changedKeys.push('llm');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'ai')) {
      state.prefs.ai = sanitizeAiPatch(patch.ai);
      changedKeys.push('ai');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'searchApi')) {
      state.prefs.searchApi = sanitizeSearchApi(patch.searchApi);
      changedKeys.push('searchApi');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'onboardingDone')) {
      state.prefs.onboardingDone = Boolean(patch.onboardingDone);
      changedKeys.push('onboardingDone');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'userName')) {
      state.prefs.userName = String(patch.userName || '').slice(0, 20);
      changedKeys.push('userName');
    }
    writeState(state);
    const prefsResponse = buildPrefsResponse(state.prefs, normalizeFloatingUploadMode);
    try {
      _evt.sender.send('prefs:updated', { changedKeys, prefs: prefsResponse });
    } catch {
      // Renderer notification is best-effort; the write already succeeded.
    }
    return { ok: true, prefs: prefsResponse };
  });

  // 旧接口：用 state 中的 prefs.llm 字段做最小连通性测试，保留以兼容仍
  // 在使用旧版设置 UI 的代码路径（例如某些自动化测试）。
  ipcMain.handle('prefs/testLlm', async (_evt, config) => {
    const llm = sanitizeLlm(config);
    if (!llm?.apiKey || !llm?.baseURL || !llm?.model) {
      return { ok: false, error: '请填写完整的 API Key、Base URL 和模型名称' };
    }
    try {
      const chat = new ChatOpenAI({
        apiKey: llm.apiKey,
        model: llm.model,
        temperature: 0,
        maxTokens: 10,
        timeout: 15000,
        configuration: { baseURL: llm.baseURL },
      });
      await chat.invoke('Hi');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /**
   * 新接口：测试任意 provider 类型 + 指定模型的可连通性。
   * payload: { provider, modelId }
   */
  ipcMain.handle('prefs/testAiProvider', async (_evt, payload) => {
    const provider = payload?.provider;
    const modelId = String(payload?.modelId || '').trim();
    if (!provider || typeof provider !== 'object') {
      return { ok: false, error: '缺少 provider 参数' };
    }
    if (!modelId) {
      return { ok: false, error: '请先指定要测试的模型 ID' };
    }
    try {
      return await testProviderConnection(provider, modelId);
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  /**
   * 新接口：拉取某个 provider 当前可用的模型列表。
   * payload: { provider }
   * 返回：{ ok, models, error? }
   */
  ipcMain.handle('prefs/listAiModels', async (_evt, payload) => {
    const provider = payload?.provider;
    if (!provider || typeof provider !== 'object') {
      return { ok: false, error: '缺少 provider 参数', models: [] };
    }
    try {
      const models = await listProviderModels(provider);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), models: [] };
    }
  });

  /**
   * 元数据接口：告诉前端目前支持哪些 provider 类型 / 角色名，方便前端
   * 不重复硬编码。可在 Tooltip / 下拉中使用。
   */
  ipcMain.handle('prefs/getAiMeta', async () => {
    return {
      ok: true,
      meta: {
        providerTypes: PROVIDER_TYPES.map((type) => ({
          type,
          defaultBaseURL: defaultBaseUrlFor(type),
        })),
        roles: ROLE_NAMES,
        apiModes: ['responses', 'chat'],
      },
    };
  });

  // K1 — Search API connectivity test. Currently dispatches to Bocha;
  // future providers can branch on `config.provider`.
  ipcMain.handle('prefs/testSearchApi', async (_evt, config) => {
    const cfg = sanitizeSearchApi(config);
    if (!cfg?.apiKey) {
      return { ok: false, error: '请先填写搜索 API Key' };
    }
    try {
      const res = await testBochaApiKey(cfg.apiKey);
      return res;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

