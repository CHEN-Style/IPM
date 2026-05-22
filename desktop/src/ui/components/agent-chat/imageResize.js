// desktop/src/ui/components/agent-chat/imageResize.js
//
// U8b-6: client-side image resize / re-encode helper for KnowClaw's
// attachment input.
//
// Why this lives in the renderer (not main):
//   - The decode step uses `createImageBitmap` / HTMLImageElement and
//     the encode step uses HTMLCanvasElement#toBlob — both browser-only
//     APIs. Doing it in main would force us to ship a heavy native
//     dependency (sharp / jimp) and burn IPC roundtrips per image.
//   - Resizing before IPC means the base64 payload stays small enough
//     (typically <1 MB for a 2048-px JPEG), which keeps the structured-
//     clone copy that Electron does on `ipcRenderer.invoke()` cheap.
//
// Pipeline:
//
//     File / Blob
//         │  (1) decodeBitmap()
//         ▼
//     ImageBitmap (or fallback <img>)
//         │  (2) drawToCanvas(maxEdge)
//         ▼
//     HTMLCanvasElement
//         │  (3) canvas.toBlob('image/jpeg', q)
//         ▼
//     Blob (JPEG)
//         │  (4) blobToBase64()
//         ▼
//     { mimeType: 'image/jpeg', data: '<base64>' }
//
// Output `data` is the bare base64 string WITHOUT the `data:image/...;
// base64,` prefix — that's the shape pi's `prompt(text, { images })`
// expects, and also what `knowclaw.js#sanitizeImagesPayload` validates
// against.
//
// GIF caveat: drawing an animated GIF to canvas only captures the
// first frame, so the re-encoded output is a still JPEG. We accept
// this trade-off (animation isn't useful for vision models anyway)
// and surface it as a soft note in the README rather than failing
// the upload.

const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_JPEG_QUALITY = 0.85;

/**
 * Decode a File / Blob into an `ImageBitmap`-like drawable.
 *
 * Prefers `createImageBitmap()` (zero-copy, off-thread) and falls back
 * to an `<img>` element + `onload` for browsers that don't support it
 * (older Chromium variants in Electron, very large GIFs that
 * createImageBitmap refuses).
 *
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap | HTMLImageElement>}
 */
async function decodeBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to <img> fallback.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // `decode()` waits for raster data to be ready; resolves the
      // race between onload-firing and the image actually being
      // drawable. Not all browsers expose it; treat as optional.
      const finish = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      if (typeof img.decode === 'function') {
        img.decode().then(finish, finish);
      } else {
        finish();
      }
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err instanceof Error ? err : new Error('image decode failed'));
    };
    img.src = url;
  });
}

/**
 * Compute the scaled (w, h) so the longest edge equals `maxEdge`.
 * Returns the original size when already within bounds — saves an
 * unnecessary re-encode pass for small images.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} maxEdge
 */
function fitWithin(w, h, maxEdge) {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const ratio = w >= h ? maxEdge / w : maxEdge / h;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  };
}

/**
 * Render the decoded bitmap onto a canvas at the target size.
 *
 * @param {ImageBitmap | HTMLImageElement} bitmap
 * @param {number} maxEdge
 */
function drawToCanvas(bitmap, maxEdge) {
  const srcW = bitmap.width || bitmap.naturalWidth || 0;
  const srcH = bitmap.height || bitmap.naturalHeight || 0;
  if (srcW <= 0 || srcH <= 0) {
    throw new Error('image has zero dimensions');
  }
  const { width, height } = fitWithin(srcW, srcH, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  // White background — JPEG has no alpha channel, transparent PNGs
  // would otherwise composite over black which surprises users.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  // Release the ImageBitmap GPU resource ASAP. HTMLImageElement
  // doesn't have close().
  if (typeof bitmap.close === 'function') {
    try { bitmap.close(); } catch { /* ignore */ }
  }
  return canvas;
}

/**
 * Promisified canvas.toBlob.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Read a Blob into a base64 string (no `data:...;base64,` prefix).
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Resize an image File / Blob to JPEG of bounded edge length and
 * return the bare base64 payload pi expects.
 *
 * @param {File | Blob} file
 * @param {object} [opts]
 * @param {number} [opts.maxEdge=2048]    Longest edge in CSS pixels.
 * @param {number} [opts.jpegQuality=0.85] Range [0, 1].
 * @returns {Promise<{ mimeType: 'image/jpeg', data: string, width: number, height: number, sizeBytes: number }>}
 */
export async function resizeImageToBase64(file, opts = {}) {
  if (!file || typeof file !== 'object') {
    throw new Error('resizeImageToBase64: file argument required');
  }
  const maxEdge = Number.isFinite(opts.maxEdge) ? Math.max(64, Math.floor(opts.maxEdge)) : DEFAULT_MAX_EDGE;
  const jpegQuality = Number.isFinite(opts.jpegQuality)
    ? Math.min(1, Math.max(0.1, opts.jpegQuality))
    : DEFAULT_JPEG_QUALITY;

  const bitmap = await decodeBitmap(file);
  const canvas = drawToCanvas(bitmap, maxEdge);
  const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
  const base64 = await blobToBase64(jpegBlob);
  return {
    mimeType: 'image/jpeg',
    data: base64,
    width: canvas.width,
    height: canvas.height,
    sizeBytes: base64.length, // base64 length ≈ raw bytes * 4/3
  };
}

/**
 * Generate a transient blob: URL for a File / Blob, suitable for
 * `<img src>` previews. Caller is responsible for revoking via
 * `URL.revokeObjectURL` when the thumbnail unmounts.
 *
 * @param {File | Blob} file
 */
export function makePreviewUrl(file) {
  return URL.createObjectURL(file);
}

/**
 * Best-effort MIME-type whitelist match — paired with `accept` in the
 * file input but useful for paste/drag where the browser may report
 * an empty / weird MIME.
 */
export const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function isSupportedImageFile(file) {
  if (!file || typeof file !== 'object') return false;
  const t = String(file.type || '').toLowerCase();
  if (!t.startsWith('image/')) return false;
  return SUPPORTED_IMAGE_MIMES.has(t) || t === 'image/jpeg' || t === 'image/png';
}
