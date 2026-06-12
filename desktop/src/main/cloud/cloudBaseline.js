// C5: Local baseline cache for sync diffing.
//
// `meta/cloud-baseline.json` records the manifest as it stood at the last
// successful sync (publish, pull, push, or pull-update). It is the "base" leg
// of the three-way diff in syncEngine.js:
//
//   base (this file)  vs  local (fresh scan)   -> what *I* changed
//   base (this file)  vs  cloud (latest ver)   -> what *others* changed
//
// Keeping the baseline locally avoids re-fetching historical versions from the
// server on every diff. Each entry stores enough to detect change cheaply
// (sha256 for content identity, mtimeMs for a fast pre-hash short-circuit).

import fs from 'node:fs';
import path from 'node:path';

export const CLOUD_BASELINE_FILENAME = 'cloud-baseline.json';
export const CLOUD_BASELINE_SCHEMA_VERSION = 1;

function getBaselinePath(projectRootPath) {
  return path.join(projectRootPath, 'meta', CLOUD_BASELINE_FILENAME);
}

/**
 * Normalize a manifest entry (from a scan or a cloud manifest) into the compact
 * baseline shape. Folders carry no hash/size.
 */
function toBaselineEntry(entry) {
  if (entry.entryType === 'folder') {
    return { path: entry.path, name: entry.name, entryType: 'folder' };
  }
  return {
    path: entry.path,
    name: entry.name,
    entryType: 'file',
    sha256: entry.sha256 || null,
    sizeBytes: entry.sizeBytes ?? null,
    mimeType: entry.mimeType ?? null,
    // Scan results carry mtimeMs; cloud manifests carry an ISO mtime string.
    mtimeMs:
      typeof entry.mtimeMs === 'number'
        ? entry.mtimeMs
        : entry.mtime
          ? Date.parse(entry.mtime) || null
          : null,
    status: entry.status || 'active',
  };
}

/**
 * Read the baseline manifest. Returns `null` when absent or unparseable.
 */
export function readBaseline(projectRootPath) {
  const filePath = getBaselinePath(projectRootPath);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the baseline manifest atomically.
 *
 * @param {string} projectRootPath
 * @param {object} opts
 * @param {string|null} opts.versionId
 * @param {number|null} opts.versionNumber
 * @param {Array} opts.entries manifest entries (scan or cloud shape)
 */
export function writeBaseline(projectRootPath, { versionId = null, versionNumber = null, entries = [] }) {
  const filePath = getBaselinePath(projectRootPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const payload = {
    schemaVersion: CLOUD_BASELINE_SCHEMA_VERSION,
    versionId,
    versionNumber,
    syncedAt: new Date().toISOString(),
    entries: entries.map(toBaselineEntry),
  };

  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
  return payload;
}

/**
 * Build a `path -> entry` map for the baseline's file entries (folders omitted).
 */
export function baselineFileMap(baseline) {
  const map = new Map();
  if (!baseline || !Array.isArray(baseline.entries)) return map;
  for (const e of baseline.entries) {
    if (e.entryType === 'file') map.set(e.path, e);
  }
  return map;
}
