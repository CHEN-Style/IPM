// desktop/src/main/ipc/capture.js
//
// FK4 + FK5: full-screen capture, captured-artifact persistence, and
// freeform note persistence for the floating-window KnowClaw mode.
//
// Three IPC channels are registered:
//
//   capture/fullScreen     {}
//     → { ok, pngBuffer, width, height } | { ok:false, error }
//     Hides floating + bubble windows briefly, grabs the primary
//     display via Electron's `desktopCapturer`, returns the raw PNG
//     buffer so the renderer can decode a thumbnail and (optionally)
//     run it through OCR / send it to a vision model.
//
//   capture/saveArtifacts  { pngBuffer, ocrText?, ts? }
//     → { ok, pngPath, ocrPath?, relPngPath, relOcrPath? }
//     Writes the PNG + (optional) OCR text into
//     `userfile/workspaces/_floating/captures/`. Filenames follow the
//     `YYYYMMDD-HHmmss` stamp; `<ts>.png` + `<ts>.ocr.txt`.
//
//   capture/saveNote       { content, ts? }
//     → { ok, path, relPath }
//     FK5: writes an OCR-derived markdown note into
//     `userfile/workspaces/_floating/notes/<ts>.md`.

import fs from 'node:fs';
import path from 'node:path';
import { desktopCapturer, screen } from 'electron';

function pad2(n) { return String(n).padStart(2, '0'); }
function formatStamp(d = new Date()) {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
    + `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBuffer(maybeBuffer) {
  if (!maybeBuffer) return null;
  if (Buffer.isBuffer(maybeBuffer)) return maybeBuffer;
  try { return Buffer.from(maybeBuffer); } catch { return null; }
}

export function registerCaptureIpc({
  ipcMain,
  floatingWindowRef,
  bubbleWindowRef,
  getFloatingWorkspacePath,
}) {
  if (!ipcMain) throw new Error('registerCaptureIpc: ipcMain is required');
  if (typeof getFloatingWorkspacePath !== 'function') {
    throw new Error('registerCaptureIpc: getFloatingWorkspacePath() is required');
  }

  // Track an in-flight capture so two rapid 📷 clicks don't double-hide
  // the floating window or race on the show() restore.
  let captureInFlight = false;

  ipcMain.handle('capture/fullScreen', async () => {
    if (captureInFlight) {
      return { ok: false, error: 'capture_busy' };
    }
    captureInFlight = true;

    const fw = floatingWindowRef?.current;
    const bw = bubbleWindowRef?.current;
    const fwWasVisible = !!(fw && !fw.isDestroyed() && fw.isVisible());
    const bwWasVisible = !!(bw && !bw.isDestroyed() && bw.isVisible());

    const restoreWindows = () => {
      try {
        if (fwWasVisible && fw && !fw.isDestroyed() && !fw.isVisible()) {
          fw.show();
        }
      } catch { /* ignore */ }
      try {
        if (bwWasVisible && bw && !bw.isDestroyed() && !bw.isVisible()) {
          bw.show();
        }
      } catch { /* ignore */ }
    };

    try {
      // Hide the floating + bubble so they don't appear in the screenshot.
      try { if (fwWasVisible) fw.hide(); } catch { /* ignore */ }
      try { if (bwWasVisible) bw.hide(); } catch { /* ignore */ }

      // Give the compositor a tick to actually unmap the windows before
      // we ask Chromium to capture. 120ms is empirically enough on Win10/11.
      await sleep(120);

      const display = screen.getPrimaryDisplay();
      const sf = Number(display.scaleFactor || 1);
      const targetW = Math.max(1, Math.round((display.size?.width || 1920) * sf));
      const targetH = Math.max(1, Math.round((display.size?.height || 1080) * sf));

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: targetW, height: targetH },
      });
      if (!sources || sources.length === 0) {
        restoreWindows();
        return { ok: false, error: 'capture_failed' };
      }

      // Primary display source: prefer display_id match when available,
      // fall back to sources[0]. On Windows desktopCapturer typically
      // lists the primary display first.
      const primaryId = String(display.id || '');
      let source = sources.find((s) => String(s.display_id || '') === primaryId);
      if (!source) source = sources[0];

      const thumb = source.thumbnail;
      if (!thumb || thumb.isEmpty?.()) {
        restoreWindows();
        return { ok: false, error: 'capture_failed' };
      }

      const pngBuffer = thumb.toPNG();
      const size = thumb.getSize?.() || { width: targetW, height: targetH };

      restoreWindows();
      return {
        ok: true,
        pngBuffer,
        width: size.width || targetW,
        height: size.height || targetH,
      };
    } catch (err) {
      // macOS without Screen Recording permission throws here. Surface a
      // dedicated error code so the renderer can render a meaningful
      // error chip / direct the user to System Settings (FK7).
      const msg = String(err?.message || err);
      restoreWindows();
      const permissionDenied = /permission|denied|not\s+authorized/i.test(msg);
      return {
        ok: false,
        error: permissionDenied ? 'screen_permission_denied' : 'capture_failed',
        detail: msg,
      };
    } finally {
      captureInFlight = false;
    }
  });

  ipcMain.handle('capture/saveArtifacts', async (_evt, payload) => {
    try {
      const pngBuffer = toBuffer(payload?.pngBuffer);
      if (!pngBuffer || pngBuffer.length === 0) {
        return { ok: false, error: 'empty_png_buffer' };
      }
      const ts = String(payload?.ts || formatStamp()).replace(/[^0-9A-Za-z_-]/g, '');
      const ocrText = typeof payload?.ocrText === 'string' ? payload.ocrText : '';

      const root = getFloatingWorkspacePath();
      const dir = path.join(root, 'captures');
      fs.mkdirSync(dir, { recursive: true });

      const pngPath = path.join(dir, `${ts}.png`);
      fs.writeFileSync(pngPath, pngBuffer);

      let ocrPath = null;
      if (ocrText) {
        ocrPath = path.join(dir, `${ts}.ocr.txt`);
        fs.writeFileSync(ocrPath, ocrText, 'utf-8');
      }

      const relRoot = (abs) => {
        const rel = path.relative(root, abs);
        return rel.split(path.sep).join('/');
      };

      return {
        ok: true,
        pngPath,
        ocrPath,
        relPngPath: relRoot(pngPath),
        relOcrPath: ocrPath ? relRoot(ocrPath) : null,
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('capture/saveNote', async (_evt, payload) => {
    try {
      const content = typeof payload?.content === 'string' ? payload.content : '';
      if (!content.trim()) {
        return { ok: false, error: 'empty_note' };
      }
      const ts = String(payload?.ts || formatStamp()).replace(/[^0-9A-Za-z_-]/g, '');

      const root = getFloatingWorkspacePath();
      const dir = path.join(root, 'notes');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${ts}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');

      const rel = path.relative(root, filePath).split(path.sep).join('/');
      return { ok: true, path: filePath, relPath: rel };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}
