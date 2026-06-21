// desktop/src/main/ipc/bubble.js
//
// FK2-3: IPC handlers for the assistant bubble window.
// The bubble is a separate frameless transparent BrowserWindow that
// displays AI replies as a large speech bubble next to the floating
// window. Content is pushed from the floating window's renderer via
// these IPC channels.

export function registerBubbleIpc({
  ipcMain,
  floatingWindowRef,
  bubbleWindowRef,
  createBubbleWindow,
  repositionBubble,
}) {
  const waitForBubbleRenderer = (bw) => new Promise((resolve) => {
    if (!bw || bw.isDestroyed()) {
      resolve();
      return;
    }
    if (!bw.webContents.isLoading()) {
      // Give React one macrotask to mount BubbleView and register its
      // `bubble:content` listener before the first payload is sent.
      setTimeout(resolve, 0);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      bw.webContents.removeListener('did-fail-load', finish);
      bw.webContents.removeListener('did-finish-load', finish);
      setTimeout(resolve, 0);
    };
    const timer = setTimeout(finish, 1200);
    bw.webContents.once('did-finish-load', finish);
    bw.webContents.once('did-fail-load', finish);
  });

  // Show the bubble (lazily creating the window if needed), push
  // content, position it next to the floating window, and make it
  // visible.
  //
  // FK4-6: optional `ocrText` payload — when present, the bubble
  // renderer surfaces a small "复制 OCR 原文" button so the user can
  // copy the OCR-extracted text without scrolling through a fold or
  // opening the captures/ folder. We deliberately do NOT render the
  // OCR text itself in the bubble (user decision recorded in the
  // FK4/FK5 plan); the full text is persisted to disk and copied
  // on demand via `navigator.clipboard.writeText`.
  ipcMain.handle('bubble/show', async (_e, payload) => {
    const { html, thinking, ocrText } = payload || {};
    const bw = createBubbleWindow();
    if (bw.isDestroyed()) return { ok: false, reason: 'destroyed' };
    await waitForBubbleRenderer(bw);
    if (bw.isDestroyed()) return { ok: false, reason: 'destroyed' };
    bw.webContents.send('bubble:content', {
      html: html || '',
      thinking: !!thinking,
      ocrText: typeof ocrText === 'string' ? ocrText : '',
    });
    repositionBubble();
    if (process.platform === 'darwin') {
      try {
        bw.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      } catch {
        // Best effort: the bubble can still show on the current Space.
      }
    }
    if (!bw.isVisible()) bw.show();
    return { ok: true };
  });

  // Hide the bubble without destroying it (preserves renderer state
  // for fast re-show).
  ipcMain.handle('bubble/hide', async () => {
    const bw = bubbleWindowRef.current;
    if (bw && !bw.isDestroyed() && bw.isVisible()) {
      bw.hide();
    }
    return { ok: true };
  });

  // Update content in an already-visible bubble. If the bubble is
  // hidden this is a no-op (the content will be pushed again on the
  // next `bubble/show`). FK4-6: forwards optional `ocrText` (see
  // `bubble/show` for rationale).
  ipcMain.handle('bubble/setContent', async (_e, payload) => {
    const { html, thinking, ocrText } = payload || {};
    const bw = bubbleWindowRef.current;
    if (bw && !bw.isDestroyed()) {
      bw.webContents.send('bubble:content', {
        html: html || '',
        thinking: !!thinking,
        ocrText: typeof ocrText === 'string' ? ocrText : '',
      });
    }
    return { ok: true };
  });

  // FK2-6: the bubble's "展开到悬浮窗内" button sends this IPC.
  // We hide the bubble and forward an expand request to the floating
  // window so it can toggle into expanded mode.
  ipcMain.handle('bubble/expandRequest', async () => {
    const bw = bubbleWindowRef.current;
    if (bw && !bw.isDestroyed() && bw.isVisible()) {
      bw.hide();
    }
    const fw = floatingWindowRef.current;
    if (fw && !fw.isDestroyed()) {
      fw.webContents.send('bubble:expandRequest');
    }
    return { ok: true };
  });
}
