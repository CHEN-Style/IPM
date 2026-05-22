#!/usr/bin/env node
/**
 * setup-ocr-models.mjs
 *
 * Downloads PP-OCRv5 mobile models (detection + Chinese-multi recognition
 * + English-optimized recognition + dictionaries) from
 * https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models and places
 * them under `desktop/models/ocr/`. The Forge `packageAfterCopy` hook then
 * copies that directory into `<resources>/models/ocr/` of the packaged app,
 * so the OCR service can load models fully offline.
 *
 * Behaviours:
 *   * Idempotent: each file is skipped when already present. Pass `--force`
 *     to re-download.
 *   * Streams via `https.get` with redirect support (LFS endpoints use
 *     302 redirects to AWS S3).
 *   * Verifies the download is at least 100 KB before committing to disk —
 *     this catches Git LFS-pointer "tombstones" or HTML error pages.
 *
 * Bundled file layout (under `desktop/models/ocr/`):
 *
 *   detection/PP-OCRv5_mobile_det_infer.ort      — universal detection (~5MB)
 *   recognition/ch/PP-OCRv5_mobile_rec_infer.onnx — multilingual recognition
 *                                                   (incl. Chinese) (~17MB)
 *   recognition/ch/ppocrv5_dict.txt              — multilingual dictionary
 *   recognition/en/en_PP-OCRv5_mobile_rec_infer.ort — English-optimized (~9MB)
 *   recognition/en/ppocrv5_en_dict.txt           — English-only dictionary
 *
 * Usage:
 *   node scripts/setup-ocr-models.mjs            # download missing files
 *   node scripts/setup-ocr-models.mjs --force    # re-download everything
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(DESKTOP_DIR, 'models', 'ocr');

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');

const LFS_BASE = 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';
const RAW_BASE = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';

const FILES = [
  {
    url: `${LFS_BASE}/detection/PP-OCRv5_mobile_det_infer.ort`,
    dest: 'detection/PP-OCRv5_mobile_det_infer.ort',
    minBytes: 100 * 1024,
    isLfs: true,
  },
  {
    url: `${LFS_BASE}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
    dest: 'recognition/ch/PP-OCRv5_mobile_rec_infer.onnx',
    minBytes: 100 * 1024,
    isLfs: true,
  },
  {
    url: `${RAW_BASE}/recognition/ppocrv5_dict.txt`,
    dest: 'recognition/ch/ppocrv5_dict.txt',
    minBytes: 10 * 1024,
    isLfs: false,
  },
  {
    url: `${LFS_BASE}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort`,
    dest: 'recognition/en/en_PP-OCRv5_mobile_rec_infer.ort',
    minBytes: 100 * 1024,
    isLfs: true,
  },
  {
    url: `${RAW_BASE}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
    dest: 'recognition/en/ppocrv5_en_dict.txt',
    minBytes: 100,
    isLfs: false,
  },
];

function log(msg) {
  console.log(`[setup-ocr-models] ${msg}`);
}

function fatal(msg, err) {
  console.error(`[setup-ocr-models] ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function httpsDownload(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) {
      reject(new Error(`Too many redirects fetching ${url}`));
      return;
    }
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'IPM-setup-ocr-models-script' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(httpsDownload(res.headers.location, destPath, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        let lastLogged = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0 && received - lastLogged > 2 * 1024 * 1024) {
            const pct = ((received / total) * 100).toFixed(1);
            log(
              `  downloaded ${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`,
            );
            lastLogged = received;
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

async function downloadOne(file) {
  const destPath = path.join(MODELS_DIR, file.dest);
  if (!FORCE && fs.existsSync(destPath)) {
    const size = fs.statSync(destPath).size;
    if (size >= file.minBytes) {
      log(`Skipping ${file.dest} (already present, ${(size / 1024).toFixed(1)} KB)`);
      return;
    }
    log(`Existing ${file.dest} too small (${size} B), re-downloading`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.tmp-${process.pid}`;
  log(`Downloading ${file.url}`);
  await httpsDownload(file.url, tmp);
  const stat = fs.statSync(tmp);
  if (stat.size < file.minBytes) {
    fs.unlinkSync(tmp);
    if (file.isLfs) {
      fatal(
        `Downloaded file is only ${stat.size} bytes — looks like a Git LFS pointer ` +
          `slipped through. Try \`--force\` or check network access to media.githubusercontent.com.`,
      );
    } else {
      fatal(`Downloaded file is only ${stat.size} bytes — looks truncated.`);
    }
  }
  fs.renameSync(tmp, destPath);
  log(`  -> saved ${file.dest} (${(stat.size / 1024).toFixed(1)} KB)`);
}

(async () => {
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    log(`Target: ${MODELS_DIR}`);
    for (const file of FILES) {
      await downloadOne(file);
    }
    log('All OCR model files are ready.');
  } catch (err) {
    fatal('Setup failed:', err);
  }
})();
