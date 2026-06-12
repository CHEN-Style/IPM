// C4: On-demand download of a placeholdered large file.
//
// During pull, files over the size threshold are written as `<name>.ipmcloud`
// JSON placeholders instead of downloading their (potentially huge) contents.
// This module resolves such a placeholder: it reads the recorded sha256, asks
// the cloud for a signed GET URL, streams the blob to the real path, then
// removes the placeholder.

import fs from 'node:fs';
import path from 'node:path';
import { PLACEHOLDER_SUFFIX } from './pullWorkspace.js';

export function isPlaceholderPath(p) {
  return typeof p === 'string' && p.endsWith(PLACEHOLDER_SUFFIX);
}

export function readPlaceholder(placeholderPath) {
  try {
    const raw = fs.readFileSync(placeholderPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.kind === 'ipm-cloud-placeholder' && parsed.sha256) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

async function downloadToFile(url, destPath, onProgress) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`下载失败 (${res.status})${text ? `: ${text}` : ''}`);
    err.status = res.status;
    throw err;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.part`;

  // Stream to disk with progress when the body is a web stream.
  const total = Number(res.headers.get('content-length') || 0);
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const out = fs.createWriteStream(tmp);
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(Buffer.from(value));
        received += value.length;
        if (typeof onProgress === 'function') onProgress({ received, total });
      }
    } finally {
      out.end();
    }
    await new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
    });
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmp, buf);
  }
  fs.renameSync(tmp, destPath);
}

/**
 * Resolve a placeholder into its real file.
 *
 * @param {object} opts
 * @param {string} opts.placeholderPath absolute path to the `*.ipmcloud` file
 * @param {object} opts.cloudClient authenticated CloudClient
 * @param {(p:{received:number,total:number})=>void} [opts.onProgress]
 */
export async function downloadPlaceholder(opts) {
  const { placeholderPath, cloudClient, onProgress } = opts;
  if (!cloudClient) throw new Error('downloadPlaceholder: cloudClient is required');
  if (!isPlaceholderPath(placeholderPath)) {
    throw new Error('不是有效的占位文件');
  }
  const info = readPlaceholder(placeholderPath);
  if (!info) throw new Error('占位文件已损坏或缺少元数据');

  const urlRes = await cloudClient.post('/api/objects/download-urls', { hashes: [info.sha256] });
  const urlInfo = (urlRes.urls || [])[0];
  if (!urlInfo) {
    const err = new Error('云端缺少该文件的数据');
    err.code = 'MISSING_BLOB';
    throw err;
  }

  // Real file path = placeholder path minus the suffix.
  const realPath = placeholderPath.slice(0, -PLACEHOLDER_SUFFIX.length);
  await downloadToFile(urlInfo.downloadUrl, realPath, onProgress);

  // Drop the placeholder once the real file is in place.
  try {
    fs.rmSync(placeholderPath, { force: true });
  } catch {
    /* ignore */
  }

  return { ok: true, path: realPath, sizeBytes: info.sizeBytes };
}
