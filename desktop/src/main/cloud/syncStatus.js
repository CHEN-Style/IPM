// C5: Lightweight sync-status detection.
//
// Two cheap checks used to drive the "you have N unsynced changes / the cloud
// has N updates" banner, without the cost of a full SHA-256 rescan:
//   * Local changes: a no-hash directory walk compared against the baseline's
//     mtime/size cache (a heuristic pre-filter; the real diff in syncEngine
//     still hashes before any commit).
//   * Remote changes: a single /sync-status call compared to the local
//     baseline version id.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SCAN_EXCLUDED_DIRS, SCAN_EXCLUDED_NAMES } from './workspaceScanner.js';
import { readBaseline, baselineFileMap } from './cloudBaseline.js';
import { readCloudBinding } from './cloudBinding.js';
import { PLACEHOLDER_SUFFIX } from './cloudConstants.js';

function toPosixRel(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Walk the workspace WITHOUT hashing. Returns a `realPath -> {mtimeMs, size,
 * isPlaceholder}` map. Placeholders are folded back onto the file they stand
 * in for and reported as present (un-materialized large files are unchanged).
 */
async function quickLocalScan(dir, relBase, isTopLevel, out) {
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
      await quickLocalScan(childAbs, childRel, false, out);
    } else if (dirent.isFile()) {
      let stat;
      try {
        stat = await fsp.stat(childAbs);
      } catch {
        continue;
      }
      let posix = toPosixRel(childRel);
      let isPlaceholder = false;
      if (posix.endsWith(PLACEHOLDER_SUFFIX)) {
        posix = posix.slice(0, -PLACEHOLDER_SUFFIX.length);
        isPlaceholder = true;
      }
      out.set(posix, { mtimeMs: stat.mtimeMs, size: Number(stat.size) || 0, isPlaceholder });
    }
  }
}

/**
 * Heuristically count local changes vs the baseline using mtime + size.
 * Returns `{ hasLocalChanges, localChangeCount }`. Placeholders count as
 * unchanged. When no baseline exists, reports no changes (caller decides).
 */
export async function checkLocalChanges(projectDir) {
  const baseline = readBaseline(projectDir);
  if (!baseline) return { hasLocalChanges: false, localChangeCount: 0 };

  const baseMap = baselineFileMap(baseline);
  const local = new Map();
  if (fs.existsSync(projectDir)) {
    await quickLocalScan(projectDir, '', true, local);
  }

  let changes = 0;

  // Added or modified.
  for (const [p, info] of local) {
    const base = baseMap.get(p);
    if (!base) {
      changes += 1; // new file
      continue;
    }
    if (info.isPlaceholder) continue; // un-materialized large file = unchanged
    // mtime/size heuristic: differ -> likely modified.
    const baseMtime = typeof base.mtimeMs === 'number' ? base.mtimeMs : null;
    const sizeDiff = typeof base.sizeBytes === 'number' ? base.sizeBytes !== info.size : false;
    const mtimeDiff = baseMtime !== null ? Math.abs(baseMtime - info.mtimeMs) > 1000 : false;
    if (sizeDiff || mtimeDiff) changes += 1;
  }

  // Deleted: active baseline files no longer present locally.
  for (const [p, base] of baseMap) {
    if ((base.status || 'active') === 'soft_deleted') continue;
    if (!local.has(p)) changes += 1;
  }

  return { hasLocalChanges: changes > 0, localChangeCount: changes };
}

/**
 * Compare the local baseline version against the cloud's current version.
 */
export async function checkRemoteChanges({ projectDir, cloudClient }) {
  const binding = readCloudBinding(projectDir);
  const baseline = readBaseline(projectDir);
  if (!binding || !binding.cloudWorkspaceId) {
    return { hasRemoteChanges: false, remoteVersionNumber: null };
  }
  const localVersionId = baseline?.versionId || binding.lastSyncedVersionId || null;

  const res = await cloudClient.get(`/api/workspaces/${binding.cloudWorkspaceId}/sync-status`);
  const remoteVersionId = res?.currentVersionId || null;
  return {
    hasRemoteChanges: Boolean(remoteVersionId) && remoteVersionId !== localVersionId,
    remoteVersionId,
    remoteVersionNumber: res?.currentVersionNumber ?? null,
    localVersionNumber: baseline?.versionNumber ?? binding.lastSyncedVersionNumber ?? null,
    myRole: res?.myRole || null,
    // H3: 'archived' drives the read-only banner in the sync UI.
    workspaceStatus: res?.workspaceStatus || null,
  };
}

/**
 * Combined summary used by the sync banner.
 */
export async function getSyncSummary({ projectDir, cloudClient }) {
  let remoteRes;
  let remoteError = null;
  try {
    [, remoteRes] = await Promise.all([
      null, // placeholder to keep destructuring consistent
      checkRemoteChanges({ projectDir, cloudClient }),
    ]);
  } catch (err) {
    remoteError = err instanceof Error ? err.message : String(err);
    remoteRes = { hasRemoteChanges: false };
    console.error('[syncStatus] checkRemoteChanges failed:', remoteError);
  }

  const localRes = await checkLocalChanges(projectDir);

  return {
    hasLocalChanges: localRes.hasLocalChanges,
    localChangeCount: localRes.localChangeCount,
    hasRemoteChanges: remoteRes.hasRemoteChanges,
    remoteVersionNumber: remoteRes.remoteVersionNumber ?? null,
    localVersionNumber: remoteRes.localVersionNumber ?? null,
    myRole: remoteRes.myRole ?? null,
    workspaceStatus: remoteRes.workspaceStatus ?? null,
    remoteError,
  };
}
