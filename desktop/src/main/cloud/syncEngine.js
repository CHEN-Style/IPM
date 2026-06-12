// C5: Sync diff engine (pure, no I/O).
//
// Produces a SyncPlan by three-way diffing:
//   base   = meta/cloud-baseline.json  (state at last sync)
//   local  = fresh workspace scan       (what I have now)
//   cloud  = latest version manifest    (what the team has now)
//
// IPM's collaboration model is NOT git:
//   * The unit of conflict is a same-path file changed on BOTH sides.
//   * Adding/removing files under an existing folder is never a conflict.
//   * Deletion is a soft mark, never a destructive merge.
//   * Folder structure is owner-protected: a non-owner cannot create new
//     cloud folders, so files landing in a not-yet-sanctioned folder are
//     reported as "ignored" rather than pushed.
//
// The engine is deliberately pure so it can be unit-tested without Electron.

import { PLACEHOLDER_SUFFIX } from './cloudConstants.js';

/**
 * Parent folder path of a POSIX manifest path. Root-level files return '/'.
 *   '/收到资料/合同.pdf' -> '/收到资料'
 *   '/合同.pdf'          -> '/'
 */
function parentFolder(filePath) {
  const idx = filePath.lastIndexOf('/');
  if (idx <= 0) return '/';
  return filePath.slice(0, idx);
}

/**
 * Collapse a raw scan into a `realPath -> {sha256, sizeBytes, mtimeMs,
 * isPlaceholder}` map. A `*.ipmcloud` placeholder is folded back onto the file
 * it represents and treated as identical to the baseline (an un-materialized
 * large file is, by definition, unmodified locally).
 */
function buildLocalFileMap(localEntries, baseFileMap) {
  const map = new Map();
  for (const e of localEntries) {
    if (e.entryType !== 'file') continue;
    if (typeof e.path === 'string' && e.path.endsWith(PLACEHOLDER_SUFFIX)) {
      const realPath = e.path.slice(0, -PLACEHOLDER_SUFFIX.length);
      const base = baseFileMap.get(realPath);
      map.set(realPath, {
        sha256: base ? base.sha256 : null,
        sizeBytes: base ? base.sizeBytes : null,
        mtimeMs: null,
        isPlaceholder: true,
        name: base ? base.name : realPath.split('/').pop(),
      });
    } else {
      map.set(e.path, {
        sha256: e.sha256 || null,
        sizeBytes: e.sizeBytes ?? null,
        mtimeMs: e.mtimeMs ?? null,
        isPlaceholder: false,
        name: e.name,
        mimeType: e.mimeType ?? null,
      });
    }
  }
  return map;
}

function buildCloudFileMap(cloudEntries) {
  const map = new Map();
  for (const e of cloudEntries) {
    if (e.entryType === 'file') map.set(e.path, e);
  }
  return map;
}

function buildBaseFileMap(baseline) {
  const map = new Map();
  if (baseline && Array.isArray(baseline.entries)) {
    for (const e of baseline.entries) {
      if (e.entryType === 'file') map.set(e.path, e);
    }
  }
  return map;
}

/**
 * @param {object} opts
 * @param {Array}  opts.localEntries  scan entries (workspaceScanner shape)
 * @param {Array}  opts.cloudEntries  /versions/latest entries (with status)
 * @param {object|null} opts.baseline parsed cloud-baseline.json
 * @param {string[]} [opts.cloudFolders] canonical folder paths (owner-owned)
 * @param {string} [opts.userRole] 'owner' | 'editor' | 'viewer'
 * @returns {object} SyncPlan
 */
export function computeSyncPlan(opts) {
  const {
    localEntries = [],
    cloudEntries = [],
    baseline = null,
    cloudFolders = [],
    userRole = 'editor',
  } = opts;

  const baseFileMap = buildBaseFileMap(baseline);
  const localMap = buildLocalFileMap(localEntries, baseFileMap);
  const cloudMap = buildCloudFileMap(cloudEntries);

  const isOwner = userRole === 'owner';
  const canonicalFolders = new Set(cloudFolders);
  canonicalFolders.add('/');
  // When the canonical folder set is empty (only '/'), the workspace pre-dates
  // C5 or the owner hasn't initialized folder protection yet. In that case we
  // skip folder validation entirely — all folders are considered valid.
  const skipFolderProtection = cloudFolders.length === 0;

  const toPush = { newFiles: [], updatedFiles: [], softDeleted: [] };
  const toPull = { newFiles: [], updatedFiles: [], remoteDeleted: [], newFolders: [] };
  const conflicts = [];
  const ignored = { folderChanges: [], newFolderFiles: [] };

  // Classify every file path seen across the three sides.
  const allPaths = new Set([...baseFileMap.keys(), ...localMap.keys(), ...cloudMap.keys()]);

  for (const filePath of allPaths) {
    const base = baseFileMap.get(filePath) || null;
    const local = localMap.get(filePath) || null;
    const cloud = cloudMap.get(filePath) || null;

    const baseSha = base ? base.sha256 : null;
    const baseActive = base ? base.status !== 'soft_deleted' : false;
    const localSha = local ? local.sha256 : null;
    const cloudSha = cloud ? cloud.sha256 : null;
    const cloudActive = cloud ? cloud.status !== 'soft_deleted' : false;

    // ── Local change vs base ──────────────────────────────────────
    let localChange = 'none';
    if (!base || !baseActive) {
      // No active baseline for this path.
      if (local) localChange = 'added';
      else localChange = 'none';
    } else {
      // Active baseline existed.
      if (!local) localChange = 'deleted';
      else if (localSha && localSha !== baseSha) localChange = 'modified';
      else localChange = 'none';
    }

    // ── Cloud change vs base ──────────────────────────────────────
    let cloudChange = 'none';
    if (!base || !baseActive) {
      if (cloud && cloudActive) cloudChange = 'added';
      else cloudChange = 'none';
    } else {
      if (!cloud || !cloudActive) cloudChange = 'deleted';
      else if (cloudSha && cloudSha !== baseSha) cloudChange = 'modified';
      else cloudChange = 'none';
    }

    const localTouched = localChange === 'added' || localChange === 'modified';
    const cloudTouched = cloudChange === 'added' || cloudChange === 'modified';

    // ── Conflicts: both sides touched the same path divergently ───
    if (localTouched && cloudTouched) {
      // Same resulting content = no real conflict (coincidental identical edit).
      if (localSha && cloudSha && localSha === cloudSha) {
        // Already converged; nothing to do.
        continue;
      }
      conflicts.push({
        path: filePath,
        name: (local && local.name) || (cloud && cloud.name) || filePath.split('/').pop(),
        kind: 'both_modified',
        localSha,
        cloudSha,
        cloudBy: cloud ? cloud.deletedByName || null : null,
      });
      continue;
    }
    if (localChange === 'modified' && cloudChange === 'deleted') {
      conflicts.push({ path: filePath, name: local.name, kind: 'local_edit_remote_delete', localSha });
      continue;
    }
    if (localChange === 'deleted' && cloudChange === 'modified') {
      conflicts.push({ path: filePath, name: cloud.name, kind: 'local_delete_remote_edit', cloudSha });
      continue;
    }

    // ── Pure push (cloud unchanged) ───────────────────────────────
    if (cloudChange === 'none') {
      if (localChange === 'added') {
        const parent = parentFolder(filePath);
        const folderOk = skipFolderProtection || isOwner || canonicalFolders.has(parent);
        const target = folderOk ? toPush.newFiles : ignored.newFolderFiles;
        target.push({
          path: filePath,
          name: local.name,
          sha256: localSha,
          sizeBytes: local.sizeBytes,
          mimeType: local.mimeType ?? null,
          mtimeMs: local.mtimeMs ?? null,
          parentFolder: parent,
        });
      } else if (localChange === 'modified') {
        toPush.updatedFiles.push({
          path: filePath,
          name: local.name,
          sha256: localSha,
          sizeBytes: local.sizeBytes,
          mimeType: local.mimeType ?? null,
          mtimeMs: local.mtimeMs ?? null,
          previousSha: baseSha,
        });
      } else if (localChange === 'deleted') {
        toPush.softDeleted.push({
          path: filePath,
          name: base.name,
          sha256: baseSha,
          sizeBytes: base.sizeBytes ?? null,
        });
      }
      continue;
    }

    // ── Pure pull (local unchanged) ───────────────────────────────
    if (localChange === 'none') {
      if (cloudChange === 'added') {
        toPull.newFiles.push({
          path: filePath,
          name: cloud.name,
          sha256: cloudSha,
          sizeBytes: cloud.sizeBytes ?? null,
          mimeType: cloud.mimeType ?? null,
        });
      } else if (cloudChange === 'modified') {
        toPull.updatedFiles.push({
          path: filePath,
          name: cloud.name,
          sha256: cloudSha,
          sizeBytes: cloud.sizeBytes ?? null,
          mimeType: cloud.mimeType ?? null,
          previousSha: baseSha,
        });
      } else if (cloudChange === 'deleted') {
        toPull.remoteDeleted.push({
          path: filePath,
          name: (cloud && cloud.name) || (base && base.name) || filePath.split('/').pop(),
          deletedBy: cloud ? cloud.deletedByName || cloud.deletedBy || null : null,
          deletedAt: cloud ? cloud.deletedAt || null : null,
        });
      }
    }
  }

  // ── Folder diff (structure) ───────────────────────────────────────
  const localFolderSet = new Set(
    localEntries.filter((e) => e.entryType === 'folder').map((e) => e.path),
  );
  const cloudFolderSet = new Set(cloudFolders);

  // New cloud folders that the local copy is missing -> create on pull.
  for (const folderPath of cloudFolderSet) {
    if (!localFolderSet.has(folderPath)) {
      toPull.newFolders.push({ path: folderPath });
    }
  }

  // Local folders that don't exist on the cloud (only relevant when folder
  // protection is active).
  if (!skipFolderProtection) {
    for (const folderPath of localFolderSet) {
      if (!cloudFolderSet.has(folderPath)) {
        if (!isOwner) {
          ignored.folderChanges.push({ path: folderPath, kind: 'local_added_folder' });
        }
      }
    }
  }

  const summary = {
    pushCount: toPush.newFiles.length + toPush.updatedFiles.length + toPush.softDeleted.length,
    pullCount:
      toPull.newFiles.length +
      toPull.updatedFiles.length +
      toPull.remoteDeleted.length +
      toPull.newFolders.length,
    conflictCount: conflicts.length,
    ignoredCount: ignored.folderChanges.length + ignored.newFolderFiles.length,
  };

  return { toPush, toPull, conflicts, ignored, summary, isOwner };
}
