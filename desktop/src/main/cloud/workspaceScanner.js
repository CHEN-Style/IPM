// C2: Local workspace scanner.
//
// Walks a project/case directory and produces a manifest of all *business*
// files with their SHA-256 hashes. This manifest is what C3 will diff against
// the cloud to decide which blobs need uploading.
//
// Design notes:
// - Hashing is streamed (crypto.createHash + fs.createReadStream) so a 4 GB
//   evidence video never lands fully in memory.
// - System directories (meta/temp/snippets) and OS junk files are skipped.
// - C2 always does a *full* scan. Incremental (mtime-based) optimization is
//   deferred to C5; the ScanEntry already carries `mtimeMs` so the cache can
//   be added later without changing the shape.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Top-level system directories that never sync to the cloud.
export const SCAN_EXCLUDED_DIRS = new Set(['meta', 'temp', 'snippets']);

// OS-generated junk files excluded at every level.
export const SCAN_EXCLUDED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.rtf': 'application/rtf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
};

/**
 * Infer a MIME type from a file name's extension. Returns null when unknown.
 */
export function inferMimeType(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return MIME_BY_EXT[ext] || null;
}

/**
 * Stream a file through SHA-256 and resolve to the lowercase hex digest.
 */
export function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function toPosixRel(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Recursively collect file entries (without hashes yet) under `dir`.
 * `relBase` is the POSIX-style path of `dir` relative to the project root,
 * e.g. '' for the root, '/收到资料' for a sub-folder.
 */
async function collectEntries(dir, relBase, isTopLevel, acc) {
  let dirents;
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of dirents) {
    const name = dirent.name;
    if (SCAN_EXCLUDED_NAMES.has(name)) continue;
    if (isTopLevel && dirent.isDirectory() && SCAN_EXCLUDED_DIRS.has(name)) continue;

    const childRel = `${relBase}/${name}`;
    const childAbs = path.join(dir, name);

    if (dirent.isDirectory()) {
      acc.folders.push({ rel: childRel, name, abs: childAbs });
      await collectEntries(childAbs, childRel, false, acc);
    } else if (dirent.isFile()) {
      acc.files.push({ rel: childRel, name, abs: childAbs });
    }
    // Symlinks and other special entries are ignored in C2.
  }
}

/**
 * Scan a workspace directory and produce a full manifest.
 *
 * @param {string} projectRootPath absolute path to the project/case dir
 * @param {object} opts
 * @param {string} [opts.domain] 'projects' | 'cases' | 'study'
 * @param {string} [opts.projectName]
 * @param {(progress: object) => void} [opts.onProgress] per-file progress hook
 * @returns {Promise<object>} ScanResult
 */
export async function scanWorkspace(projectRootPath, opts = {}) {
  const { domain = null, projectName = null, onProgress } = opts;
  const startedAt = Date.now();

  if (!fs.existsSync(projectRootPath)) {
    throw new Error(`工作区目录不存在：${projectRootPath}`);
  }

  const acc = { files: [], folders: [] };
  await collectEntries(projectRootPath, '', true, acc);

  const total = acc.files.length;
  const entries = [];
  let totalSizeBytes = 0;

  // Folder entries first (object-less manifest rows).
  for (const folder of acc.folders) {
    entries.push({
      path: toPosixRel(folder.rel),
      name: folder.name,
      entryType: 'folder',
      sha256: null,
      sizeBytes: null,
      mimeType: null,
      mtimeMs: null,
    });
  }

  let current = 0;
  for (const file of acc.files) {
    current += 1;
    let stat;
    try {
      stat = await fsp.stat(file.abs);
    } catch {
      // File vanished mid-scan; skip it.
      continue;
    }

    if (typeof onProgress === 'function') {
      try {
        onProgress({ phase: 'hashing', current, total, currentFile: toPosixRel(file.rel) });
      } catch {
        // a faulty progress listener must not abort the scan
      }
    }

    let sha256 = null;
    try {
      sha256 = await computeFileHash(file.abs);
    } catch {
      // Unreadable file (locked, permission). Record it without a hash so the
      // caller can surface it; C3 will refuse to upload entries without hash.
      sha256 = null;
    }

    const sizeBytes = Number(stat.size) || 0;
    totalSizeBytes += sizeBytes;

    entries.push({
      path: toPosixRel(file.rel),
      name: file.name,
      entryType: 'file',
      sha256,
      sizeBytes,
      mimeType: inferMimeType(file.name),
      mtimeMs: stat.mtimeMs,
    });
  }

  // Sort entries by path for stable, diff-friendly output.
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    projectName,
    projectRootPath,
    domain,
    scannedAt: new Date(startedAt).toISOString(),
    entries,
    stats: {
      totalFiles: acc.files.length,
      totalFolders: acc.folders.length,
      totalSizeBytes,
      scanDurationMs: Date.now() - startedAt,
      skippedDirs: [...SCAN_EXCLUDED_DIRS],
    },
  };
}
