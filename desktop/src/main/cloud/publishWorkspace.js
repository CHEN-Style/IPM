// C3: Publish orchestrator.
//
// Runs the full "publish a local workspace to the cloud" pipeline:
//   scan -> createWorkspace -> check -> upload -> confirm -> commitVersion
// then writes meta/cloud.json. Each step reports progress via `onProgress`.
// The workspace is locked for the whole duration and unlocked in `finally`.

import fs from 'node:fs';
import path from 'node:path';
import { scanWorkspace } from './workspaceScanner.js';
import { writeCloudBinding } from './cloudBinding.js';
import { writeBaseline } from './cloudBaseline.js';
import { lockWorkspace, unlockWorkspace } from './publishLock.js';


const STEPS = ['scanning', 'creating', 'checking', 'uploading', 'committing', 'done'];

function emit(onProgress, payload) {
  if (typeof onProgress === 'function') {
    try {
      onProgress(payload);
    } catch {
      // a faulty progress listener must not abort the publish
    }
  }
}

/**
 * Upload a single local file to a signed OSS PUT URL using a streamed body.
 */
async function uploadFileToOss(filePath, uploadUrl, sizeBytes) {
  const stream = fs.createReadStream(filePath);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizeBytes),
    },
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
 * @param {object} opts
 * @param {string} opts.projectDir absolute path
 * @param {string} opts.projectName
 * @param {string} opts.domain 'projects' | 'cases' | 'study'
 * @param {string} opts.cloudName cloud workspace name (user-editable)
 * @param {string} [opts.description]
 * @param {string} [opts.message] initial commit message
 * @param {string} [opts.orgId] defaults to dev org
 * @param {object} opts.cloudClient CloudClient instance
 * @param {() => boolean} [opts.shouldCancel] polled before each upload
 * @param {(p: object) => void} [opts.onProgress]
 */
export async function publishWorkspace(opts) {
  const {
    projectDir,
    projectName,
    domain,
    cloudName,
    description,
    message,
    orgId,
    userId,
    userDisplayName,
    cloudClient,
    shouldCancel,
    onProgress,
  } = opts;

  if (!cloudClient) throw new Error('publishWorkspace: cloudClient is required');
  if (!projectDir) throw new Error('publishWorkspace: projectDir is required');

  const checkCancel = () => {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('发布已取消');
      err.code = 'PUBLISH_CANCELLED';
      throw err;
    }
  };

  lockWorkspace(projectDir, { domain, projectName });

  try {
    // ── Step 1: scan ──────────────────────────────────────────────
    emit(onProgress, { step: 'scanning', status: 'running' });
    const scan = await scanWorkspace(projectDir, {
      domain,
      projectName,
      onProgress: (p) => emit(onProgress, { step: 'scanning', status: 'running', ...p }),
    });
    checkCancel();

    const fileEntries = scan.entries.filter((e) => e.entryType === 'file' && e.sha256);
    const unreadable = scan.entries.filter((e) => e.entryType === 'file' && !e.sha256);
    if (unreadable.length > 0) {
      const err = new Error(`有 ${unreadable.length} 个文件无法读取，无法发布`);
      err.code = 'UNREADABLE_FILES';
      err.details = unreadable.map((e) => e.path);
      throw err;
    }
    emit(onProgress, {
      step: 'scanning',
      status: 'done',
      totalFiles: scan.stats.totalFiles,
      totalFolders: scan.stats.totalFolders,
      totalSizeBytes: scan.stats.totalSizeBytes,
    });

    // ── Step 2: create workspace ──────────────────────────────────
    emit(onProgress, { step: 'creating', status: 'running' });
    const createBody = {
      name: cloudName || projectName,
      domain,
      description: description || undefined,
    };
    if (orgId) createBody.orgId = orgId;
    const createRes = await cloudClient.post('/api/workspaces', createBody);
    const workspace = createRes.workspace;
    emit(onProgress, { step: 'creating', status: 'done', workspaceId: workspace.id });
    checkCancel();

    // ── Step 3: check which hashes already exist ──────────────────
    emit(onProgress, { step: 'checking', status: 'running' });
    const allHashes = [...new Set(fileEntries.map((e) => e.sha256))];
    let existing = [];
    if (allHashes.length > 0) {
      const checkRes = await cloudClient.post('/api/objects/check', { hashes: allHashes });
      existing = checkRes.existing || [];
    }
    const existingSet = new Set(existing);
    // Deduplicate by sha256: only upload one file per unique hash.
    const toUploadMap = new Map();
    for (const entry of fileEntries) {
      if (!existingSet.has(entry.sha256) && !toUploadMap.has(entry.sha256)) {
        toUploadMap.set(entry.sha256, entry);
      }
    }
    const toUpload = [...toUploadMap.values()];
    emit(onProgress, {
      step: 'checking',
      status: 'done',
      totalUnique: allHashes.length,
      alreadyExists: existing.length,
      needUpload: toUpload.length,
    });
    checkCancel();

    // ── Step 4: get signed URLs + upload ──────────────────────────
    emit(onProgress, { step: 'uploading', status: 'running', current: 0, total: toUpload.length });
    if (toUpload.length > 0) {
      const urlRes = await cloudClient.post('/api/objects/upload-urls', {
        files: toUpload.map((e) => ({
          sha256: e.sha256,
          sizeBytes: e.sizeBytes,
          mimeType: e.mimeType || undefined,
        })),
      });
      const urlBySha = new Map((urlRes.urls || []).map((u) => [u.sha256, u]));

      let uploaded = 0;
      for (const entry of toUpload) {
        checkCancel();
        const urlInfo = urlBySha.get(entry.sha256);
        if (!urlInfo) throw new Error(`缺少上传 URL: ${entry.path}`);
        const absPath = joinProjectPath(projectDir, entry.path);
        emit(onProgress, {
          step: 'uploading',
          status: 'running',
          current: uploaded,
          total: toUpload.length,
          currentFile: entry.path,
        });
        await uploadFileToOss(absPath, urlInfo.uploadUrl, entry.sizeBytes);
        uploaded += 1;
        emit(onProgress, {
          step: 'uploading',
          status: 'running',
          current: uploaded,
          total: toUpload.length,
          currentFile: entry.path,
        });
      }

      // Confirm uploads.
      await cloudClient.post('/api/objects/confirm', {
        hashes: toUpload.map((e) => e.sha256),
      });
    }
    emit(onProgress, { step: 'uploading', status: 'done', uploaded: toUpload.length });
    checkCancel();

    // ── Step 5: commit manifest ───────────────────────────────────
    emit(onProgress, { step: 'committing', status: 'running' });
    const manifestEntries = scan.entries.map((e) => {
      if (e.entryType === 'folder') {
        return { entryType: 'folder', path: e.path, name: e.name };
      }
      return {
        entryType: 'file',
        path: e.path,
        name: e.name,
        sha256: e.sha256,
        sizeBytes: e.sizeBytes ?? undefined,
        mimeType: e.mimeType ?? undefined,
        mtime: e.mtimeMs ? new Date(e.mtimeMs).toISOString() : undefined,
      };
    });
    const commitRes = await cloudClient.post(`/api/workspaces/${workspace.id}/versions`, {
      message: message || '初始发布',
      entries: manifestEntries,
    });
    emit(onProgress, {
      step: 'committing',
      status: 'done',
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
    });

    // ── Step 6: write local binding + baseline ────────────────────
    const binding = writeCloudBinding(projectDir, {
      cloudWorkspaceId: workspace.id,
      orgId: orgId || undefined,
      domain,
      lastSyncedVersionId: commitRes.versionId,
      lastSyncedVersionNumber: commitRes.versionNumber,
      lastSyncedAt: new Date().toISOString(),
      syncMode: 'manual',
      sourceType: 'standard',
      role: 'owner',
      boundBy: {
        userId: userId || undefined,
        displayName: userDisplayName || undefined,
      },
    });

    // Baseline = the manifest we just committed (basis for the next diff).
    writeBaseline(projectDir, {
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
      entries: scan.entries,
    });

    // Initialize the canonical folder structure on the cloud (owner action).
    // Non-fatal: a failure here only means folder protection isn't seeded yet.
    try {
      const folderPaths = scan.entries.filter((e) => e.entryType === 'folder').map((e) => e.path);
      await cloudClient.post(`/api/workspaces/${workspace.id}/folders`, { folders: folderPaths });
    } catch {
      // ignore; folders can be re-synced later by the owner
    }

    emit(onProgress, {
      step: 'done',
      status: 'done',
      workspaceId: workspace.id,
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
    });

    return {
      ok: true,
      workspaceId: workspace.id,
      versionId: commitRes.versionId,
      versionNumber: commitRes.versionNumber,
      binding,
      stats: {
        totalFiles: scan.stats.totalFiles,
        totalFolders: scan.stats.totalFolders,
        uploaded: toUpload.length,
        reused: existing.length,
      },
    };
  } finally {
    unlockWorkspace(projectDir);
  }
}

// Manifest paths are POSIX-style ('/收到资料/合同.pdf'); join them onto the
// absolute project dir using the OS separator.
function joinProjectPath(projectDir, posixPath) {
  const rel = String(posixPath || '').replace(/^\/+/, '');
  const segments = rel.split('/').filter(Boolean);
  return path.join(projectDir, ...segments);
}

export { STEPS as PUBLISH_STEPS };
