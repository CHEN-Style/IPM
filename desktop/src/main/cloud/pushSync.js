// C5: Push (upload) orchestrator for an already-bound workspace.
//
// Unlike C3 publish (which always creates a brand-new cloud workspace from a
// full scan), pushSync diffs the local copy against its baseline and commits
// only the delta as a new 'sync' version:
//   scan -> read baseline -> sync-status guard -> folders -> diff
//        -> upload new/updated blobs -> commit merged manifest -> rewrite baseline
//
// Daily syncs are 'sync' versions (not user-facing milestones). Conflicts
// (same path changed on both sides) abort the push and are returned for the UI
// to surface; C5 does not auto-resolve them.

import fs from 'node:fs';
import path from 'node:path';
import { scanWorkspace } from './workspaceScanner.js';
import { readCloudBinding, writeCloudBinding } from './cloudBinding.js';
import { readBaseline, writeBaseline } from './cloudBaseline.js';
import { computeSyncPlan } from './syncEngine.js';
import { lockWorkspace, unlockWorkspace } from './publishLock.js';

export const PUSH_STEPS = ['scanning', 'diffing', 'uploading', 'committing', 'done'];

function emit(onProgress, payload) {
  if (typeof onProgress === 'function') {
    try {
      onProgress(payload);
    } catch {
      /* a faulty listener must not abort the push */
    }
  }
}

function joinProjectPath(projectDir, posixPath) {
  const rel = String(posixPath || '').replace(/^\/+/, '');
  return path.join(projectDir, ...rel.split('/').filter(Boolean));
}

async function uploadFileToOss(filePath, uploadUrl, sizeBytes) {
  const stream = fs.createReadStream(filePath);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(sizeBytes) },
    body: stream,
    duplex: 'half',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OSS 上传失败 (${res.status})${text ? `: ${text}` : ''}`);
    err.status = res.status;
    throw err;
  }
}

/**
 * Compute a SyncPlan for a bound workspace without performing any writes.
 * Used both by the preview IPC and internally by pushSync.
 *
 * @returns {Promise<{ plan: object, binding: object, baseline: object|null,
 *                      cloud: object, scan: object, remoteAhead: boolean }>}
 */
export async function computeWorkspaceSyncPlan({ projectDir, domain, projectName, cloudClient }) {
  const binding = readCloudBinding(projectDir);
  if (!binding || !binding.cloudWorkspaceId) {
    const err = new Error('该项目未绑定云端');
    err.code = 'NOT_BOUND';
    throw err;
  }
  const workspaceId = binding.cloudWorkspaceId;

  const scan = await scanWorkspace(projectDir, { domain, projectName });
  const baseline = readBaseline(projectDir);

  const [statusRes, foldersRes, latestRes] = await Promise.all([
    cloudClient.get(`/api/workspaces/${workspaceId}/sync-status`),
    cloudClient.get(`/api/workspaces/${workspaceId}/folders`).catch(() => ({ folders: [] })),
    cloudClient.get(`/api/workspaces/${workspaceId}/versions/latest`),
  ]);

  const cloudEntries = latestRes?.entries || [];
  const cloudFolders = foldersRes?.folders || [];
  // Prefer the server-authoritative role from sync-status (which queries
  // workspace_members). Local binding.role may be stale or absent on
  // workspaces published before C5.
  const userRole = statusRes?.myRole || binding.role || 'editor';

  const remoteAhead =
    Boolean(statusRes?.currentVersionId) &&
    Boolean(baseline?.versionId) &&
    statusRes.currentVersionId !== baseline.versionId;

  const plan = computeSyncPlan({
    localEntries: scan.entries,
    cloudEntries,
    baseline,
    cloudFolders,
    userRole,
  });

  return { plan, binding, baseline, cloud: latestRes, scan, remoteAhead, workspaceId, userRole };
}

/**
 * Build the merged manifest entries for the next version.
 *
 * Because pushSync refuses to run when the cloud is ahead of the baseline,
 * cloud == baseline at push time. We therefore seed from the baseline and
 * apply the local push delta on top.
 */
function buildNextManifest({ baseline, scan, plan, isOwner }) {
  const fileState = new Map(); // path -> entry (file)
  const now = new Date().toISOString();

  // Seed from baseline file entries (carries forward unchanged + already
  // soft-deleted files).
  if (baseline && Array.isArray(baseline.entries)) {
    for (const e of baseline.entries) {
      if (e.entryType !== 'file') continue;
      fileState.set(e.path, {
        entryType: 'file',
        path: e.path,
        name: e.name,
        sha256: e.sha256,
        sizeBytes: e.sizeBytes ?? undefined,
        mimeType: e.mimeType ?? undefined,
        status: e.status || 'active',
      });
    }
  }

  for (const f of plan.toPush.newFiles) {
    fileState.set(f.path, {
      entryType: 'file',
      path: f.path,
      name: f.name,
      sha256: f.sha256,
      sizeBytes: f.sizeBytes ?? undefined,
      mimeType: f.mimeType ?? undefined,
      mtime: f.mtimeMs ? new Date(f.mtimeMs).toISOString() : undefined,
      status: 'active',
    });
  }
  for (const f of plan.toPush.updatedFiles) {
    fileState.set(f.path, {
      entryType: 'file',
      path: f.path,
      name: f.name,
      sha256: f.sha256,
      sizeBytes: f.sizeBytes ?? undefined,
      mimeType: f.mimeType ?? undefined,
      mtime: f.mtimeMs ? new Date(f.mtimeMs).toISOString() : undefined,
      status: 'active',
    });
  }
  for (const f of plan.toPush.softDeleted) {
    const prev = fileState.get(f.path) || {};
    fileState.set(f.path, {
      ...prev,
      entryType: 'file',
      path: f.path,
      name: f.name,
      sha256: f.sha256,
      sizeBytes: f.sizeBytes ?? undefined,
      status: 'soft_deleted',
      deletedAt: now,
    });
  }

  // Folders: owners publish the local structure; non-owners keep the baseline
  // structure (they cannot mutate the canonical folder set).
  let folderPaths;
  if (isOwner) {
    folderPaths = scan.entries.filter((e) => e.entryType === 'folder').map((e) => e.path);
  } else {
    folderPaths = (baseline?.entries || [])
      .filter((e) => e.entryType === 'folder')
      .map((e) => e.path);
  }
  const folderEntries = folderPaths.map((p) => ({
    entryType: 'folder',
    path: p,
    name: p.split('/').filter(Boolean).pop() || p,
  }));

  return [...folderEntries, ...fileState.values()];
}

/**
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {string} opts.domain
 * @param {string} opts.projectName
 * @param {string} [opts.message] sync commit message
 * @param {object} opts.cloudClient authenticated CloudClient
 * @param {() => boolean} [opts.shouldCancel]
 * @param {(p:object)=>void} [opts.onProgress]
 */
export async function pushSync(opts) {
  const { projectDir, domain, projectName, message, cloudClient, shouldCancel, onProgress } = opts;
  if (!cloudClient) throw new Error('pushSync: cloudClient is required');
  if (!projectDir) throw new Error('pushSync: projectDir is required');

  const checkCancel = () => {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('同步已取消');
      err.code = 'SYNC_CANCELLED';
      throw err;
    }
  };

  lockWorkspace(projectDir, { domain, projectName });
  try {
    // ── Step 1: scan + diff ───────────────────────────────────────
    emit(onProgress, { step: 'scanning', status: 'running' });
    const ctx = await computeWorkspaceSyncPlan({ projectDir, domain, projectName, cloudClient });
    const { plan, baseline, workspaceId, userRole, remoteAhead } = ctx;
    emit(onProgress, { step: 'scanning', status: 'done' });
    checkCancel();

    emit(onProgress, { step: 'diffing', status: 'done', summary: plan.summary });

    // Guard: cloud moved ahead -> must pull first.
    if (remoteAhead) {
      const err = new Error('云端有新的更新，请先拉取再同步');
      err.code = 'REMOTE_AHEAD';
      err.plan = plan;
      throw err;
    }
    // Guard: conflicts -> surface, do not auto-resolve.
    if (plan.conflicts.length > 0) {
      const err = new Error(`存在 ${plan.conflicts.length} 个冲突文件，无法自动同步`);
      err.code = 'CONFLICTS';
      err.plan = plan;
      throw err;
    }
    // Nothing to push.
    if (plan.summary.pushCount === 0) {
      emit(onProgress, { step: 'done', status: 'done', noChanges: true });
      return { ok: true, noChanges: true, plan, versionId: baseline?.versionId || null };
    }

    // ── Step 2: upload new + updated blobs ────────────────────────
    const toUploadFiles = [...plan.toPush.newFiles, ...plan.toPush.updatedFiles];
    const uniqueByHash = new Map();
    for (const f of toUploadFiles) {
      if (f.sha256 && !uniqueByHash.has(f.sha256)) uniqueByHash.set(f.sha256, f);
    }
    const uniqueFiles = [...uniqueByHash.values()];

    let existing = [];
    if (uniqueFiles.length > 0) {
      const checkRes = await cloudClient.post('/api/objects/check', {
        hashes: uniqueFiles.map((f) => f.sha256),
      });
      existing = checkRes.existing || [];
    }
    const existingSet = new Set(existing);
    const needUpload = uniqueFiles.filter((f) => !existingSet.has(f.sha256));

    emit(onProgress, { step: 'uploading', status: 'running', current: 0, total: needUpload.length });
    if (needUpload.length > 0) {
      const urlRes = await cloudClient.post('/api/objects/upload-urls', {
        files: needUpload.map((f) => ({
          sha256: f.sha256,
          sizeBytes: f.sizeBytes ?? 0,
          mimeType: f.mimeType || undefined,
        })),
      });
      const urlBySha = new Map((urlRes.urls || []).map((u) => [u.sha256, u]));

      let uploaded = 0;
      for (const f of needUpload) {
        checkCancel();
        const urlInfo = urlBySha.get(f.sha256);
        if (!urlInfo) throw new Error(`缺少上传 URL: ${f.path}`);
        await uploadFileToOss(joinProjectPath(projectDir, f.path), urlInfo.uploadUrl, f.sizeBytes ?? 0);
        uploaded += 1;
        emit(onProgress, {
          step: 'uploading',
          status: 'running',
          current: uploaded,
          total: needUpload.length,
          currentFile: f.path,
        });
      }
      await cloudClient.post('/api/objects/confirm', { hashes: needUpload.map((f) => f.sha256) });
    }
    emit(onProgress, { step: 'uploading', status: 'done', uploaded: needUpload.length });
    checkCancel();

    // ── Step 3: commit merged manifest as a 'sync' version ────────
    emit(onProgress, { step: 'committing', status: 'running' });
    const manifestEntries = buildNextManifest({ baseline, scan: ctx.scan, plan, isOwner: userRole === 'owner' });
    const commitRes = await cloudClient.post(`/api/workspaces/${workspaceId}/versions`, {
      message: message || '同步更新',
      type: 'sync',
      baseVersionId: baseline?.versionId ?? null,
      entries: manifestEntries,
    });
    emit(onProgress, {
      step: 'committing',
      status: 'done',
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
    });

    // Owners also refresh the canonical folder set.
    if (userRole === 'owner') {
      try {
        const folderPaths = ctx.scan.entries
          .filter((e) => e.entryType === 'folder')
          .map((e) => e.path);
        await cloudClient.post(`/api/workspaces/${workspaceId}/folders`, { folders: folderPaths });
      } catch {
        /* non-fatal */
      }
    }

    // ── Step 4: rewrite binding + baseline ────────────────────────
    writeCloudBinding(projectDir, {
      lastSyncedVersionId: commitRes.versionId,
      lastSyncedVersionNumber: commitRes.versionNumber,
      lastSyncedAt: new Date().toISOString(),
    });
    writeBaseline(projectDir, {
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
      // The committed manifest is the new baseline. Map manifest -> baseline
      // shape (folders + files with status).
      entries: manifestEntries,
    });

    emit(onProgress, {
      step: 'done',
      status: 'done',
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
    });

    return {
      ok: true,
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
      plan,
      stats: {
        pushed: plan.summary.pushCount,
        uploaded: needUpload.length,
        reused: existing.length,
      },
    };
  } finally {
    unlockWorkspace(projectDir);
  }
}
