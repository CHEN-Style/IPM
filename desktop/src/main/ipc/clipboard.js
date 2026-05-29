// desktop/src/main/ipc/clipboard.js
//
// FK5-1: a dedicated `clipboard/getLatestImage` IPC channel that lets
// the floating-window renderer pull the most recent PNG buffer from
// the main-process clipboard cache without going through a
// data: URL → fetch → Buffer round-trip.
//
// The cache itself is populated by `startClipboardWatcher()` in
// `main.js` whenever it observes a new image on the OS clipboard
// (typically a Win+Shift+S screenshot). Each entry carries
// `{ png: Buffer, width, height, createdAt, hash }`.
//
// TTL: FK5 wants a 2-minute window. The watcher prunes entries older
// than 60s, so this IPC re-checks `createdAt` against the FK5 ceiling
// (120_000ms) and returns `{ ok:false, reason:'expired' }` past that.
// In practice the prune cap means most callers will already see
// `reason:'no_image'` before the 2-minute mark — that's fine; the
// renderer treats both as "fall back to fullScreen capture".

const FK5_IMAGE_TTL_MS = 120_000;

export function registerClipboardIpc({ ipcMain, clipboardImageCache }) {
  if (!ipcMain) throw new Error('registerClipboardIpc: ipcMain is required');
  if (!clipboardImageCache || typeof clipboardImageCache.entries !== 'function') {
    throw new Error('registerClipboardIpc: clipboardImageCache (Map) is required');
  }

  ipcMain.handle('clipboard/getLatestImage', async () => {
    try {
      let latest = null;
      let latestToken = '';
      for (const [token, value] of clipboardImageCache.entries()) {
        if (!value || !value.png) continue;
        if (!latest || (value.createdAt || 0) > (latest.createdAt || 0)) {
          latest = value;
          latestToken = token;
        }
      }
      if (!latest) {
        return { ok: false, reason: 'no_image' };
      }

      const ageMs = Date.now() - (latest.createdAt || 0);
      if (ageMs > FK5_IMAGE_TTL_MS) {
        return { ok: false, reason: 'expired', ageMs };
      }

      // Return the raw PNG buffer; structured-clone moves Buffer
      // efficiently across the IPC boundary in Electron (renderer
      // receives a Uint8Array-backed view).
      return {
        ok: true,
        token: latestToken,
        pngBuffer: latest.png,
        width: latest.width || 0,
        height: latest.height || 0,
        ageMs,
      };
    } catch (err) {
      return { ok: false, reason: 'error', error: String(err?.message || err) };
    }
  });
}
