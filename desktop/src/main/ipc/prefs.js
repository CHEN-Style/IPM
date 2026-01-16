export function registerPrefsIpc({ ipcMain, readState, writeState, normalizeFloatingUploadMode }) {
  if (!ipcMain) throw new Error('registerPrefsIpc: ipcMain is required');

  // ===== Preferences (persisted in userfile/_app/state.json) =====
  ipcMain.handle('prefs/get', async () => {
    const state = readState();
    const prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : {};
    return {
      ok: true,
      prefs: {
        floatingUploadMode: normalizeFloatingUploadMode(prefs.floatingUploadMode || 'confirm'),
      },
    };
  });

  ipcMain.handle('prefs/set', async (_evt, payload) => {
    const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
    const state = readState();
    state.prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : {};
    if (Object.prototype.hasOwnProperty.call(patch, 'floatingUploadMode')) {
      state.prefs.floatingUploadMode = normalizeFloatingUploadMode(patch.floatingUploadMode);
    }
    writeState(state);
    return {
      ok: true,
      prefs: {
        floatingUploadMode: normalizeFloatingUploadMode(state.prefs.floatingUploadMode || 'confirm'),
      },
    };
  });
}


