// G1.2b 切换淡入淡出工具函数。
// - 16ms 一帧线性插值，默认 120ms 共约 8 帧，肉眼丝滑且不会拖慢交互。
// - skipFade=true 时单步设置，用于 macOS 透明窗（setOpacity 在 mac 透明窗上行为不一致，
//   计划要求自动降级）或者过渡被强制跳过的场景。
const fadeWindow = (win, toOpacity, durationMs = 120, opts = {}) => {
  if (!win || win.isDestroyed()) return Promise.resolve();
  if (opts.skipFade) {
    try { win.setOpacity(toOpacity); } catch { /* ignore */ }
    return Promise.resolve();
  }
  let from;
  try { from = win.getOpacity(); } catch { from = toOpacity; }
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (!win || win.isDestroyed()) { resolve(); return; }
      const t = Math.min(1, (Date.now() - start) / durationMs);
      try { win.setOpacity(from + (toOpacity - from) * t); } catch { /* ignore */ }
      if (t < 1) setTimeout(tick, 16);
      else resolve();
    };
    tick();
  });
};

export function registerUiIpc({ ipcMain, createMainWindow, createFloatingWindow, mainWindowRef, floatingWindowRef }) {
  if (!ipcMain) throw new Error('registerUiIpc: ipcMain is required');

  // 悬浮窗是 transparent: true，macOS 透明窗 setOpacity 行为不一致，统一降级。
  const fwSkip = process.platform === 'darwin';

  // ===== UI Window Switching (only window management; no business integration) =====
  ipcMain.handle('ui/openFloating', async () => {
    if (!mainWindowRef.current) createMainWindow();
    const fw = createFloatingWindow();
    const mw = mainWindowRef.current;
    if (fw && !fw.isDestroyed()) {
      // 先把目标降为 0，再 show，避免「全亮闪现一帧」
      try { fw.setOpacity(0); } catch { /* ignore */ }
      if (!fw.isVisible()) fw.show();
      fw.focus();
    }
    await Promise.all([
      fadeWindow(fw, 1, 120, { skipFade: fwSkip }),
      mw && !mw.isDestroyed() ? fadeWindow(mw, 0, 120) : Promise.resolve(),
    ]);
    if (mw && !mw.isDestroyed()) {
      mw.hide();
      // 还原 opacity，下次 show 时不需要再修一遍。
      try { mw.setOpacity(1); } catch { /* ignore */ }
    }
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
    const fw = floatingWindowRef.current;
    if (!mainWindowRef.current) createMainWindow();
    const mw = mainWindowRef.current;
    if (mw && !mw.isDestroyed()) {
      try { mw.setOpacity(0); } catch { /* ignore */ }
      mw.show();
      mw.focus();
    }
    await Promise.all([
      mw && !mw.isDestroyed() ? fadeWindow(mw, 1, 120) : Promise.resolve(),
      fw && !fw.isDestroyed() ? fadeWindow(fw, 0, 120, { skipFade: fwSkip }) : Promise.resolve(),
    ]);
    // G1.1a: 隐藏而非销毁悬浮窗，保留所有内部状态（活跃 domain、子面板等），
    // 第二次起所有切换都是瞬时。watcher 由 floatingWindow.on('hide') 自动停。
    if (fw && !fw.isDestroyed()) {
      fw.hide();
      try { fw.setOpacity(1); } catch { /* ignore */ }
    }
    return { ok: true };
  });
}


