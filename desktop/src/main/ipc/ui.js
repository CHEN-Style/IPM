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

  // ---- FK6-1: floating → main "回到空间" roundtrip state ----
  //
  // The renderer-side bridge (FloatingWorkspaceBridge in App.jsx)
  // owns the decision of whether the main-window KnowClaw can
  // safely switch workspaces — only it has access to the React
  // `streaming` flag. So this IPC handler doesn't fade or hide
  // anything until the renderer acks the request.
  //
  // Each pending request is keyed by a random UUID; the renderer
  // sends back `ui:openFloatingWorkspaceReply` with the result.
  // A 4s safety timeout resolves with `{ ok: false, reason: 'timeout' }`
  // so a missing / unmounted renderer never wedges the IPC handler.
  /** @type {Map<string, { resolve: (result: any) => void, timer: NodeJS.Timeout }>} */
  const pendingOpenFloatingWorkspace = new Map();

  ipcMain.handle('ui/replyOpenFloatingWorkspace', async (_evt, payload) => {
    const requestId = String(payload?.requestId || '');
    if (!requestId) return { ok: false };
    const entry = pendingOpenFloatingWorkspace.get(requestId);
    if (!entry) return { ok: false };
    pendingOpenFloatingWorkspace.delete(requestId);
    clearTimeout(entry.timer);
    const result = payload && typeof payload === 'object' ? payload.result : null;
    entry.resolve(result && typeof result === 'object' ? result : { ok: false });
    return { ok: true };
  });

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

  // FK6-1: switch from floating window → main window AND open the
  // KnowClaw page on the `_floating` workspace. The window-fade
  // half is identical to `ui/backToMain`; the workspace-bind half
  // is delegated to the renderer via a request/reply roundtrip
  // because only it knows whether a streaming turn is in flight.
  //
  // Returns one of:
  //   { ok: true }                      → main shown, workspace switched
  //   { ok: false, blocked: true,       → renderer refused (streaming)
  //       reason: 'main_knowclaw_streaming' }
  //   { ok: false, reason: '...' }       → other failure (timeout / no_main_window / ...)
  //
  // On block we DO NOT hide the floating window — the user stays
  // exactly where they were so they can stop the main-window turn
  // (or just wait) before retrying.
  ipcMain.handle('ui/backToFloatingWorkspace', async () => {
    if (!mainWindowRef.current) createMainWindow();
    const mw = mainWindowRef.current;
    if (!mw || mw.isDestroyed()) {
      return { ok: false, reason: 'no_main_window' };
    }

    const requestId = `fk6_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const renderer = mw.webContents;

    // 4s upper bound on the renderer's decision. The bridge is a
    // synchronous useEffect callback, so the realistic latency is
    // <50ms; the timeout is just defense against an unmounted /
    // crashed renderer.
    const replyPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingOpenFloatingWorkspace.delete(requestId);
        resolve({ ok: false, reason: 'timeout' });
      }, 4000);
      pendingOpenFloatingWorkspace.set(requestId, { resolve, timer });
    });

    try {
      renderer.send('ui:openFloatingWorkspaceRequest', { requestId });
    } catch (err) {
      pendingOpenFloatingWorkspace.delete(requestId);
      return { ok: false, reason: 'send_failed', error: String(err?.message || err) };
    }

    const reply = await replyPromise;
    if (!reply || reply.ok !== true) {
      return reply && typeof reply === 'object' ? reply : { ok: false, reason: 'unknown' };
    }

    // Renderer is committed → perform window crossfade (identical to ui/backToMain).
    const fw = floatingWindowRef.current;
    try { mw.setOpacity(0); } catch { /* ignore */ }
    mw.show();
    mw.focus();
    await Promise.all([
      fadeWindow(mw, 1, 120),
      fw && !fw.isDestroyed() ? fadeWindow(fw, 0, 120, { skipFade: fwSkip }) : Promise.resolve(),
    ]);
    if (fw && !fw.isDestroyed()) {
      fw.hide();
      try { fw.setOpacity(1); } catch { /* ignore */ }
    }
    return { ok: true };
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


