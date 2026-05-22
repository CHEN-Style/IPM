/**
 * ocrService.js — F3 内置 OCR 服务（PaddleOCR PP-OCRv5 mobile）
 *
 * 设计要点：
 *   1. 单例 PaddleOcrService 实例，懒加载（首次 recognize 才初始化）。
 *   2. 两套识别模型：
 *        - lang='ch' → PP-OCRv5_mobile_rec_infer.onnx + ppocrv5_dict.txt（多语言含中文）
 *        - lang='en' → en_PP-OCRv5_mobile_rec_infer.ort + ppocrv5_en_dict.txt（英文优化）
 *      检测模型 PP-OCRv5_mobile_det_infer.ort 中英共用。
 *      切换语言时通过 changeRecognitionModel + changeTextDictionary 复用 detection
 *      session，避免完全重新初始化。
 *   3. 模型路径解析：
 *        - 打包模式：<resources>/models/ocr/...（由 forge.config.js packageAfterCopy 复制）
 *        - 开发模式：desktop/models/ocr/...（由 `npm run setup:ocr` 下载）
 *        - 缺失时回退到 ppu-paddle-ocr 默认 URL（首次联网下载到 ~/.cache）
 *   4. 串行化：用 Promise 链确保同一时间只有一个 recognize/initialize/changeModel 在跑。
 *      避免 ppu-paddle-ocr 的 globalImageCache 与 session 复用产生竞争。
 *   5. 空闲超时：5 分钟无调用自动 destroy()，释放 200-400MB ONNX 内存。
 *   6. WASM 后端：onnxruntime-node 通过 scripts/patch-onnxruntime.mjs 被 shim
 *      为 onnxruntime-web（WASM），避免原生 .node DLL 在 Electron 中加载失败。
 *      执行提供程序设为 'wasm'。
 *   7. 错误隔离：ppu-paddle-ocr 是带 peer 依赖的模块，
 *      用 lazy dynamic import + try/catch 包裹，确保模块加载失败时不会拖垮主进程。
 */

import fs from 'node:fs';
import path from 'node:path';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const RECOGNIZE_TIMEOUT_MS = 60 * 1000;

const LANG_PROFILES = {
  ch: {
    rec: 'recognition/ch/PP-OCRv5_mobile_rec_infer.onnx',
    dict: 'recognition/ch/ppocrv5_dict.txt',
  },
  en: {
    rec: 'recognition/en/en_PP-OCRv5_mobile_rec_infer.ort',
    dict: 'recognition/en/ppocrv5_en_dict.txt',
  },
};

const DET_REL = 'detection/PP-OCRv5_mobile_det_infer.ort';

let _modelsDir = null;
let _service = null;
let _currentLang = null;
let _idleTimer = null;
let _opQueue = Promise.resolve();
let _initError = null;

function log(msg) {
  console.log(`[ocrService] ${msg}`);
}

function warn(msg, err) {
  console.warn(`[ocrService] ${msg}`, err || '');
}

/**
 * Resolve where the bundled OCR models live. We try (in order):
 *   1. process.resourcesPath/models/ocr  (packaged Electron app)
 *   2. desktop/models/ocr                (dev mode, populated by setup:ocr)
 *
 * If neither exists, returns null and the service will fall back to
 * ppu-paddle-ocr's default URLs (first-run network download).
 */
export function resolveModelsDir() {
  if (_modelsDir) return _modelsDir;

  const candidates = [];
  try {
    if (process?.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'models', 'ocr'));
    }
  } catch { /* ignore */ }

  try {
    // desktop/Agent/services/ocrService.js → desktop/models/ocr/
    const here = path.dirname(new URL(import.meta.url).pathname);
    // On Windows `pathname` starts with /D:/...; normalize.
    const normalized = process.platform === 'win32' && here.startsWith('/')
      ? here.slice(1)
      : here;
    candidates.push(path.resolve(normalized, '..', '..', 'models', 'ocr'));
  } catch { /* ignore */ }

  // Also try cwd-relative (defensive — handles npm run start from desktop/).
  candidates.push(path.resolve(process.cwd(), 'models', 'ocr'));
  candidates.push(path.resolve(process.cwd(), 'desktop', 'models', 'ocr'));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, DET_REL))) {
        _modelsDir = candidate;
        log(`Using bundled models at ${candidate}`);
        return _modelsDir;
      }
    } catch { /* ignore */ }
  }

  log('No bundled models found — will fall back to network download.');
  _modelsDir = null;
  return null;
}

function readArrayBuffer(absPath) {
  const buf = fs.readFileSync(absPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function configureWasmPaths() {
  try {
    const ort = await import('onnxruntime-web');
    const ortMod = ort.default || ort;
    if (ortMod?.env?.wasm) {
      // Point WASM paths to the onnxruntime-web dist folder so the runtime
      // can locate ort-wasm-*.wasm files at load time.
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const ortWebPkg = require.resolve('onnxruntime-web/package.json');
      const ortWebDist = path.join(path.dirname(ortWebPkg), 'dist') + path.sep;
      // onnxruntime-web expects wasmPaths to end with a separator
      const wasmPathUrl = 'file://' + ortWebDist.replace(/\\/g, '/');
      ortMod.env.wasm.wasmPaths = wasmPathUrl;
      // Single-threaded in main process to avoid worker complications
      ortMod.env.wasm.numThreads = 1;
      log(`WASM paths configured: ${wasmPathUrl}`);
    }
  } catch (err) {
    warn('Failed to configure WASM paths:', err?.message || err);
  }
}

async function loadOcrLib() {
  try {
    await configureWasmPaths();
    const mod = await import('ppu-paddle-ocr');
    return mod;
  } catch (err) {
    _initError = err;
    throw new Error(
      `Failed to load ppu-paddle-ocr: ${err?.message || err}. ` +
      `Check that onnxruntime-web is installed and patch-onnxruntime.mjs has run.`,
    );
  }
}

/**
 * Build model option payload. For each artefact we either pass a local
 * file path (preferred) or leave it undefined so ppu-paddle-ocr falls
 * back to its default URL.
 */
function buildModelOptions(lang, modelsDir) {
  const profile = LANG_PROFILES[lang] || LANG_PROFILES.ch;
  const model = {};

  if (modelsDir) {
    const det = path.join(modelsDir, DET_REL);
    const rec = path.join(modelsDir, profile.rec);
    const dict = path.join(modelsDir, profile.dict);
    if (fs.existsSync(det)) model.detection = det;
    if (fs.existsSync(rec)) model.recognition = rec;
    if (fs.existsSync(dict)) model.charactersDictionary = dict;
  }

  return model;
}

async function initService(lang) {
  if (_initError) throw _initError;

  const { PaddleOcrService } = await loadOcrLib();
  const modelsDir = resolveModelsDir();
  const model = buildModelOptions(lang, modelsDir);

  log(`Initializing PaddleOCR (lang=${lang})…`);
  const service = new PaddleOcrService({
    model,
    session: { executionProviders: ['wasm'] },
    recognition: { strategy: 'per-line' },
    debugging: { verbose: false },
  });
  await service.initialize();
  _service = service;
  _currentLang = lang;
  log(`PaddleOCR ready (lang=${lang}).`);
}

async function ensureReady(lang) {
  if (!_service) {
    await initService(lang);
    return;
  }
  if (_currentLang === lang) return;

  // Swap recognition model + dictionary in-place (faster than destroy+init).
  const modelsDir = resolveModelsDir();
  const profile = LANG_PROFILES[lang] || LANG_PROFILES.ch;
  const recPath = modelsDir ? path.join(modelsDir, profile.rec) : null;
  const dictPath = modelsDir ? path.join(modelsDir, profile.dict) : null;

  log(`Switching recognition model: ${_currentLang} → ${lang}`);
  try {
    if (recPath && fs.existsSync(recPath)) {
      await _service.changeRecognitionModel(recPath);
    }
    if (dictPath && fs.existsSync(dictPath)) {
      await _service.changeTextDictionary(dictPath);
    }
    _currentLang = lang;
  } catch (err) {
    warn('changeRecognitionModel failed, falling back to full re-init:', err?.message || err);
    try { await _service.destroy(); } catch { /* ignore */ }
    _service = null;
    _currentLang = null;
    await initService(lang);
  }
}

function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    if (!_service) return;
    log('Idle timeout — releasing ONNX sessions.');
    try {
      await _service.destroy();
    } catch (err) {
      warn('destroy() failed:', err?.message || err);
    }
    _service = null;
    _currentLang = null;
  }, IDLE_TIMEOUT_MS);
  // Unref so the timer doesn't keep the event loop alive past app quit.
  if (typeof _idleTimer.unref === 'function') _idleTimer.unref();
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    if (typeof t.unref === 'function') t.unref();
    promise.then(
      (value) => { clearTimeout(t); resolve(value); },
      (err) => { clearTimeout(t); reject(err); },
    );
  });
}

/**
 * Run OCR on a PNG/JPEG image.
 *
 * @param {Buffer|ArrayBuffer|string} input — Buffer, ArrayBuffer, or absolute file path
 * @param {object} options
 * @param {'ch'|'en'} [options.lang='ch']
 * @param {'per-line'|'per-box'|'cross-line'} [options.strategy='per-line']
 * @returns {Promise<{text: string, lines: Array, confidence: number, lang: string}>}
 */
export async function recognize(input, options = {}) {
  const lang = options.lang === 'en' ? 'en' : 'ch';
  const strategy = options.strategy || 'per-line';

  // Convert input to ArrayBuffer up front so we can release the file handle
  // before entering the serialized queue.
  let imageBuffer;
  if (typeof input === 'string') {
    imageBuffer = readArrayBuffer(input);
  } else if (Buffer.isBuffer(input)) {
    imageBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  } else if (input instanceof ArrayBuffer) {
    imageBuffer = input;
  } else if (input?.buffer instanceof ArrayBuffer) {
    imageBuffer = input.buffer;
  } else {
    throw new Error('OCR input must be a Buffer, ArrayBuffer, or absolute file path string');
  }

  // Serialize so we don't race the underlying ONNX sessions.
  const run = async () => {
    await ensureReady(lang);
    resetIdleTimer();
    const result = await withTimeout(
      _service.recognize(imageBuffer, { strategy }),
      RECOGNIZE_TIMEOUT_MS,
      'OCR recognition',
    );
    resetIdleTimer();
    const safeLines = Array.isArray(result?.lines)
      ? result.lines.map((line) => Array.isArray(line)
        ? line.map((r) => ({
          text: String(r?.text || ''),
          confidence: Number(r?.confidence) || 0,
          box: r?.box || null,
        }))
        : [])
      : [];
    return {
      text: String(result?.text || ''),
      lines: safeLines,
      confidence: Number(result?.confidence) || 0,
      lang,
    };
  };

  const job = _opQueue.then(run, run);
  _opQueue = job.catch(() => undefined);
  return job;
}

/**
 * Report service state for diagnostics / status UI.
 */
export async function getStatus() {
  return {
    loaded: !!_service,
    currentLang: _currentLang,
    modelsDir: resolveModelsDir(),
    initError: _initError ? String(_initError.message || _initError) : null,
  };
}

/**
 * Eagerly release the underlying ONNX sessions. Safe to call repeatedly.
 * Useful when the user disables OCR or on app shutdown.
 */
export async function shutdown() {
  if (_idleTimer) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }
  if (!_service) return;
  try {
    await _service.destroy();
  } catch (err) {
    warn('shutdown destroy() failed:', err?.message || err);
  }
  _service = null;
  _currentLang = null;
}
