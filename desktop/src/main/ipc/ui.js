export function registerUiIpc({ ipcMain, createMainWindow, createFloatingWindow, mainWindowRef, floatingWindowRef }) {
  if (!ipcMain) throw new Error('registerUiIpc: ipcMain is required');

  // ===== UI Window Switching (only window management; no business integration) =====
  ipcMain.handle('ui/openFloating', async () => {
    if (!mainWindowRef.current) createMainWindow();
    const fw = createFloatingWindow();
    fw.show();
    fw.focus();
    // 进入悬浮窗时隐藏中台主窗
    if (mainWindowRef.current) mainWindowRef.current.hide();
    return { ok: true };
  });

  ipcMain.handle('ui/resizeFloating', async (_evt, payload) => {
    const floatingWindow = floatingWindowRef.current;
    if (!floatingWindow || floatingWindow.isDestroyed()) return { ok: false, reason: 'no_floating_window' };
    const w = Math.max(200, Math.min(900, Number(payload?.width) || 0));
    const h = Math.max(180, Math.min(900, Number(payload?.height) || 0));
    if (!w || !h) return { ok: false, reason: 'invalid_size' };
    // Resize content area so there is no extra transparent region that blocks clicks
    floatingWindow.setContentSize(Math.round(w), Math.round(h));
    return { ok: true, width: Math.round(w), height: Math.round(h) };
  });

  ipcMain.handle('ui/backToMain', async () => {
    if (mainWindowRef.current) {
      mainWindowRef.current.show();
      mainWindowRef.current.focus();
    } else {
      createMainWindow();
    }
    if (floatingWindowRef.current) {
      floatingWindowRef.current.close();
      floatingWindowRef.current = null;
    }
    return { ok: true };
  });
}


