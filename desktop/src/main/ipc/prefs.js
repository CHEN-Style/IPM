import { ChatOpenAI } from '@langchain/openai';

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

function buildPrefsResponse(prefs, normalizeFloatingUploadMode) {
  const llm = sanitizeLlm(prefs.llm);
  const hasLlm = llm && (llm.apiKey || llm.baseURL || llm.model);
  return {
    floatingUploadMode: normalizeFloatingUploadMode(prefs.floatingUploadMode || 'auto'),
    llm: hasLlm ? llm : { ...DEFAULT_LLM },
    onboardingDone: Boolean(prefs.onboardingDone),
    userName: typeof prefs.userName === 'string' ? prefs.userName : '',
  };
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
    if (Object.prototype.hasOwnProperty.call(patch, 'floatingUploadMode')) {
      state.prefs.floatingUploadMode = normalizeFloatingUploadMode(patch.floatingUploadMode);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'llm')) {
      state.prefs.llm = sanitizeLlm(patch.llm);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'onboardingDone')) {
      state.prefs.onboardingDone = Boolean(patch.onboardingDone);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'userName')) {
      state.prefs.userName = String(patch.userName || '').slice(0, 20);
    }
    writeState(state);
    return { ok: true, prefs: buildPrefsResponse(state.prefs, normalizeFloatingUploadMode) };
  });

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
}


