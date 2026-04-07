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

function buildPrefsResponse(prefs, normalizeFloatingUploadMode) {
  return {
    floatingUploadMode: normalizeFloatingUploadMode(prefs.floatingUploadMode || 'confirm'),
    llm: sanitizeLlm(prefs.llm) || { apiKey: '', baseURL: '', model: '', summaryModel: '' },
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


