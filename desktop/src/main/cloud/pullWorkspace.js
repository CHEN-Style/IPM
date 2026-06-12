// C4: Pull orchestrator.
//
// Materializes a cloud workspace into an already-created local project dir:
//   getLatestManifest -> create folders -> download small files
//   -> placeholder large files -> write meta/cloud.json
//
// Files at or below `largeFileThresholdBytes` are downloaded immediately; the
// rest get a `<name>.ipmcloud` placeholder so the copy stays light. Placeholders
// are resolved on demand later (see downloadOnDemand.js). Progress is reported
// via `onProgress`, mirroring the publish pipeline.

import fs from 'node:fs';
import path from 'node:path';
import { readCloudBinding, writeCloudBinding } from './cloudBinding.js';
import { readBaseline, writeBaseline } from './cloudBaseline.js';
import { computeSyncPlan } from './syncEngine.js';
import { scanWorkspace } from './workspaceScanner.js';
import { PLACEHOLDER_SUFFIX, DEFAULT_LARGE_FILE_THRESHOLD } from './cloudConstants.js';
import { CLOUD_DEV_CONFIG } from './devConfig.js';

export const PULL_STEPS = ['fetching', 'preparing', 'downloading', 'finalizing', 'done'];

// Re-exported for backward compatibility (downloadOnDemand.js imports these
// from here). The source of truth is cloudConstants.js.
export { PLACEHOLDER_SUFFIX, DEFAULT_LARGE_FILE_THRESHOLD };

function emit(onProgress, payload) {
  if (typeof onProgress === 'function') {
    try {
      onProgress(payload);
    } catch {
      // a faulty listener must not abort the pull
    }
  }
}

// Manifest paths are POSIX ('/收到资料/合同.pdf'); join onto the local dir.
function joinProjectPath(projectDir, posixPath) {
  const rel = String(posixPath || '').replace(/^\/+/, '');
  const segments = rel.split('/').filter(Boolean);
  return path.join(projectDir, ...segments);
}

const OSS_ERROR_MAP = {
  AccessDenied: '访问被拒绝，请检查 OSS 权限配置',
  UserDisable: 'OSS 账户已被停用（可能欠费），请检查阿里云账户状态',
  RequestTimeTooSkewed: '本机时间与服务器偏差过大，请校准系统时间',
  InvalidAccessKeyId: 'OSS AccessKey 无效或已过期',
  SignatureDoesNotMatch: 'OSS 签名验证失败，请检查 AccessKey 配置',
  NoSuchBucket: 'OSS 存储桶不存在',
  NoSuchKey: '云端文件不存在（可能已被删除）',
  BucketNotBelongTo: 'OSS 存储桶归属错误',
};

function parseOssErrorMessage(xmlText, httpStatus) {
  if (!xmlText || typeof xmlText !== 'string') return `下载失败 (${httpStatus})`;
  const codeMatch = xmlText.match(/<Code>(.*?)<\/Code>/);
  const code = codeMatch?.[1] || '';
  const friendly = OSS_ERROR_MAP[code];
  if (friendly) return `文件下载失败：${friendly}`;
  if (code) return `文件下载失败：${code} (${httpStatus})`;
  return `文件下载失败 (${httpStatus})`;
}

export async function downloadToFile(url, destPath) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const message = parseOssErrorMessage(text, res.status);
    const err = new Error(message);
    err.status = res.status;
    err.code = 'OSS_DOWNLOAD_FAILED';
    throw err;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = `${destPath}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, destPath);
  return buf.length;
}

export function writePlaceholder(destPath, info) {
  const placeholderPath = `${destPath}${PLACEHOLDER_SUFFIX}`;
  fs.mkdirSync(path.dirname(placeholderPath), { recursive: true });
  fs.writeFileSync(
    placeholderPath,
    JSON.stringify(
      {
        kind: 'ipm-cloud-placeholder',
        schemaVersion: 1,
        sha256: info.sha256,
        sizeBytes: info.sizeBytes,
        mimeType: info.mimeType || null,
        originalName: info.name,
        path: info.path,
      },
      null,
      2,
    ),
    'utf-8',
  );
  return placeholderPath;
}

function timestampForName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function buildConflictCopyPath(originalPath, versionNumber) {
  const clean = String(originalPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = path.posix.dirname(clean);
  const fileName = path.posix.basename(clean);
  const ext = path.posix.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const suffix = `（云端冲突副本-v${versionNumber || 'latest'}-${timestampForName()}）`;
  const candidate = `${base}${suffix}${ext}`;
  return `/${dir && dir !== '.' ? `${dir}/` : ''}${candidate}`;
}

function ensureUniqueManifestPath(projectDir, manifestPath) {
  const clean = String(manifestPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const dir = path.posix.dirname(clean);
  const fileName = path.posix.basename(clean);
  const ext = path.posix.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  let current = `/${clean}`;
  let index = 1;
  while (
    fs.existsSync(joinProjectPath(projectDir, current)) ||
    fs.existsSync(`${joinProjectPath(projectDir, current)}${PLACEHOLDER_SUFFIX}`)
  ) {
    const nextName = `${base} (${index})${ext}`;
    current = `/${dir && dir !== '.' ? `${dir}/` : ''}${nextName}`;
    index += 1;
  }
  return current;
}

function fileMapByPath(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    if (entry.entryType === 'file') map.set(entry.path, entry);
  }
  return map;
}

/**
 * @param {object} opts
 * @param {string} opts.workspaceId cloud workspace id
 * @param {string} opts.projectDir absolute local project dir (must exist)
 * @param {string} opts.domain 'projects' | 'cases' | 'study'
 * @param {object} opts.cloudClient authenticated CloudClient
 * @param {number} [opts.largeFileThresholdBytes]
 * @param {object} [opts.userMeta] { userId, displayName, orgId }
 * @param {() => boolean} [opts.shouldCancel]
 * @param {(p: object) => void} [opts.onProgress]
 */
export async function pullWorkspace(opts) {
  const {
    workspaceId,
    projectDir,
    domain,
    cloudClient,
    prefetchedManifest,
    largeFileThresholdBytes = DEFAULT_LARGE_FILE_THRESHOLD,
    userMeta = {},
    shouldCancel,
    onProgress,
  } = opts;

  if (!cloudClient) throw new Error('pullWorkspace: cloudClient is required');
  if (!workspaceId) throw new Error('pullWorkspace: workspaceId is required');
  if (!projectDir) throw new Error('pullWorkspace: projectDir is required');

  const checkCancel = () => {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('拉取已取消');
      err.code = 'PULL_CANCELLED';
      throw err;
    }
  };

  // ── Step 1: fetch manifest (or reuse pre-fetched) ──────────────
  emit(onProgress, { step: 'fetching', status: 'running' });
  const manifest = prefetchedManifest || await cloudClient.get(`/api/workspaces/${workspaceId}/versions/latest`);
  if (!manifest?.ok) throw new Error(manifest?.error || '获取清单失败');
  const entries = manifest.entries || [];
  const version = manifest.version || null;
  emit(onProgress, { step: 'fetching', status: 'done', totalEntries: entries.length });
  checkCancel();

  // ── Step 2: prepare folder structure ────────────────────────────
  emit(onProgress, { step: 'preparing', status: 'running' });
  const folders = entries.filter((e) => e.entryType === 'folder');
  // Soft-deleted entries are recorded in the baseline but not materialized.
  const files = entries.filter(
    (e) => e.entryType === 'file' && e.sha256 && e.status !== 'soft_deleted',
  );
  for (const folder of folders) {
    fs.mkdirSync(joinProjectPath(projectDir, folder.path), { recursive: true });
  }
  // Partition by size threshold.
  const smallFiles = [];
  const largeFiles = [];
  for (const f of files) {
    if ((f.sizeBytes ?? 0) > largeFileThresholdBytes) largeFiles.push(f);
    else smallFiles.push(f);
  }
  emit(onProgress, {
    step: 'preparing',
    status: 'done',
    totalFolders: folders.length,
    totalFiles: files.length,
    smallFiles: smallFiles.length,
    largeFiles: largeFiles.length,
  });
  checkCancel();

  // ── Step 3: download small files + placeholder large files ──────
  emit(onProgress, { step: 'downloading', status: 'running', current: 0, total: smallFiles.length });

  // Large files become placeholders immediately (no network).
  for (const f of largeFiles) {
    writePlaceholder(joinProjectPath(projectDir, f.path), f);
  }

  let downloaded = 0;
  let downloadedBytes = 0;
  if (smallFiles.length > 0) {
    // Resolve signed GET URLs for the unique hashes.
    const uniqueHashes = [...new Set(smallFiles.map((f) => f.sha256))];
    const urlRes = await cloudClient.post('/api/objects/download-urls', { hashes: uniqueHashes });
    const urlBySha = new Map((urlRes.urls || []).map((u) => [u.sha256.toLowerCase(), u.downloadUrl]));
    if ((urlRes.missing || []).length > 0) {
      const err = new Error(`云端缺少 ${urlRes.missing.length} 个文件的数据`);
      err.code = 'MISSING_BLOBS';
      err.details = urlRes.missing;
      throw err;
    }

    for (const f of smallFiles) {
      checkCancel();
      const url = urlBySha.get(f.sha256.toLowerCase());
      if (!url) throw new Error(`缺少下载 URL: ${f.path}`);
      const dest = joinProjectPath(projectDir, f.path);
      emit(onProgress, {
        step: 'downloading',
        status: 'running',
        current: downloaded,
        total: smallFiles.length,
        currentFile: f.path,
      });
      downloadedBytes += await downloadToFile(url, dest);
      downloaded += 1;
      emit(onProgress, {
        step: 'downloading',
        status: 'running',
        current: downloaded,
        total: smallFiles.length,
        currentFile: f.path,
      });
    }
  }
  emit(onProgress, {
    step: 'downloading',
    status: 'done',
    downloaded,
    placeholders: largeFiles.length,
    downloadedBytes,
  });
  checkCancel();

  // ── Step 4: write local binding ─────────────────────────────────
  emit(onProgress, { step: 'finalizing', status: 'running' });
  const binding = writeCloudBinding(projectDir, {
    cloudWorkspaceId: workspaceId,
    orgId: userMeta.orgId || CLOUD_DEV_CONFIG.devOrgId,
    domain,
    role: 'editor',
    lastSyncedVersionId: version?.id || null,
    lastSyncedVersionNumber: version?.versionNumber ?? null,
    lastSyncedAt: new Date().toISOString(),
    syncMode: 'manual',
    sourceType: 'standard',
    pulledCopy: true,
    boundBy: {
      userId: userMeta.userId || null,
      displayName: userMeta.displayName || '',
    },
  });

  // Baseline must reflect the *actual* local file mtimes, not the cloud's
  // original mtimes. Otherwise syncStatus immediately flags every downloaded
  // file as "modified" because its on-disk mtime is the download instant.
  // Re-scan to get ground-truth mtimes, then merge in soft-deleted cloud
  // entries (which are NOT on disk but must be tracked for future diffs).
  const postScan = await scanWorkspace(projectDir, { domain, projectName: userMeta?.projectName });
  const softDeletedEntries = entries.filter((e) => e.status === 'soft_deleted');
  writeBaseline(projectDir, {
    versionId: version?.id || null,
    versionNumber: version?.versionNumber ?? null,
    entries: [...postScan.entries, ...softDeletedEntries],
  });
  emit(onProgress, { step: 'finalizing', status: 'done' });

  emit(onProgress, {
    step: 'done',
    status: 'done',
    workspaceId,
    versionNumber: version?.versionNumber ?? null,
  });

  return {
    ok: true,
    workspaceId,
    versionId: version?.id || null,
    versionNumber: version?.versionNumber ?? null,
    binding,
    stats: {
      totalFolders: folders.length,
      totalFiles: files.length,
      downloaded,
      placeholders: largeFiles.length,
      downloadedBytes,
    },
  };
}

// ── C5: incremental pull-update for an already-materialized copy ──────────
//
// Applies the cloud's changes since the local baseline onto an existing local
// project: download new/updated files (large files re-placeholdered), create
// new folders, and tag remotely soft-deleted files (local content is kept).
// Conflicting files (changed on both sides) are reported but NOT overwritten;
// resolving them is deferred to C6.

export async function pullUpdate(opts) {
  const {
    projectDir,
    domain,
    projectName,
    cloudClient,
    largeFileThresholdBytes = DEFAULT_LARGE_FILE_THRESHOLD,
    userMeta = {},
    shouldCancel,
    onProgress,
  } = opts;

  if (!cloudClient) throw new Error('pullUpdate: cloudClient is required');
  if (!projectDir) throw new Error('pullUpdate: projectDir is required');

  const binding = readCloudBinding(projectDir);
  if (!binding || !binding.cloudWorkspaceId) {
    const err = new Error('该项目未绑定云端');
    err.code = 'NOT_BOUND';
    throw err;
  }
  const workspaceId = binding.cloudWorkspaceId;

  const checkCancel = () => {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const err = new Error('拉取已取消');
      err.code = 'PULL_CANCELLED';
      throw err;
    }
  };

  // ── Step 1: fetch latest manifest + diff against baseline ─────────
  emit(onProgress, { step: 'fetching', status: 'running' });
  const manifest = await cloudClient.get(`/api/workspaces/${workspaceId}/versions/latest`);
  if (!manifest?.ok) throw new Error(manifest?.error || '获取清单失败');
  const cloudEntries = manifest.entries || [];
  const version = manifest.version || null;

  const baseline = readBaseline(projectDir);
  // We only scan to detect local modifications for conflict awareness; the
  // scan is full but cheap relative to network downloads.
  const scan = await scanWorkspace(projectDir, { domain, projectName });
  const cloudFolders = (await cloudClient
    .get(`/api/workspaces/${workspaceId}/folders`)
    .catch(() => ({ folders: [] }))).folders || [];

  const plan = computeSyncPlan({
    localEntries: scan.entries,
    cloudEntries,
    baseline,
    cloudFolders,
    userRole: binding.role || 'editor',
  });
  emit(onProgress, { step: 'fetching', status: 'done', summary: plan.summary });
  checkCancel();

  // Nothing to bring down.
  const pullFiles = [...plan.toPull.newFiles, ...plan.toPull.updatedFiles];
  const cloudFileMap = fileMapByPath(cloudEntries);
  const conflictCloudFiles = plan.conflicts
    .map((conflict) => {
      const cloud = cloudFileMap.get(conflict.path);
      if (!cloud || cloud.status === 'soft_deleted' || !cloud.sha256) return null;
      const conflictPath = ensureUniqueManifestPath(
        projectDir,
        buildConflictCopyPath(conflict.path, version?.versionNumber),
      );
      return { ...cloud, originalPath: conflict.path, conflictPath, conflictKind: conflict.kind, localSha: conflict.localSha || null };
    })
    .filter(Boolean);
  if (
    pullFiles.length === 0 &&
    plan.toPull.newFolders.length === 0 &&
    plan.toPull.remoteDeleted.length === 0 &&
    conflictCloudFiles.length === 0
  ) {
    emit(onProgress, { step: 'done', status: 'done', noChanges: true });
    // Still advance baseline so future diffs are accurate.
    writeBaseline(projectDir, {
      versionId: version?.id || null,
      versionNumber: version?.versionNumber ?? null,
      entries: cloudEntries,
    });
    writeCloudBinding(projectDir, {
      lastSyncedVersionId: version?.id || null,
      lastSyncedVersionNumber: version?.versionNumber ?? null,
      lastSyncedAt: new Date().toISOString(),
    });
    return { ok: true, noChanges: true, plan, conflicts: plan.conflicts, conflictCopies: [] };
  }

  // ── Step 2: create new folders ────────────────────────────────────
  emit(onProgress, { step: 'preparing', status: 'running' });
  for (const folder of plan.toPull.newFolders) {
    fs.mkdirSync(joinProjectPath(projectDir, folder.path), { recursive: true });
  }

  // Partition pull files by size threshold.
  const smallFiles = [];
  const largeFiles = [];
  for (const f of pullFiles) {
    if ((f.sizeBytes ?? 0) > largeFileThresholdBytes) largeFiles.push(f);
    else smallFiles.push(f);
  }
  for (const f of largeFiles) {
    writePlaceholder(joinProjectPath(projectDir, f.path), f);
  }
  const largeConflictFiles = [];
  const smallConflictFiles = [];
  for (const f of conflictCloudFiles) {
    if ((f.sizeBytes ?? 0) > largeFileThresholdBytes) largeConflictFiles.push(f);
    else smallConflictFiles.push(f);
  }
  const conflictCopies = [];
  for (const f of largeConflictFiles) {
    const placeholderPath = writePlaceholder(joinProjectPath(projectDir, f.conflictPath), {
      ...f,
      path: f.originalPath,
    });
    conflictCopies.push({
      path: f.originalPath,
      conflictPath: f.conflictPath,
      name: f.name,
      kind: f.conflictKind,
      cloudSha: f.sha256,
      localSha: f.localSha,
      versionNumber: version?.versionNumber ?? null,
      placeholder: true,
      localPath: placeholderPath,
    });
  }
  emit(onProgress, {
    step: 'preparing',
    status: 'done',
    smallFiles: smallFiles.length,
    largeFiles: largeFiles.length,
    conflictCopies: conflictCloudFiles.length,
  });
  checkCancel();

  // ── Step 3: download small files ──────────────────────────────────
  emit(onProgress, { step: 'downloading', status: 'running', current: 0, total: smallFiles.length });
  let downloaded = 0;
  let downloadedBytes = 0;
  if (smallFiles.length > 0) {
    const uniqueHashes = [...new Set(smallFiles.map((f) => f.sha256))];
    const urlRes = await cloudClient.post('/api/objects/download-urls', { hashes: uniqueHashes });
    const urlBySha = new Map((urlRes.urls || []).map((u) => [u.sha256.toLowerCase(), u.downloadUrl]));
    if ((urlRes.missing || []).length > 0) {
      const err = new Error(`云端缺少 ${urlRes.missing.length} 个文件的数据`);
      err.code = 'MISSING_BLOBS';
      err.details = urlRes.missing;
      throw err;
    }
    for (const f of smallFiles) {
      checkCancel();
      const url = urlBySha.get(f.sha256.toLowerCase());
      if (!url) throw new Error(`缺少下载 URL: ${f.path}`);
      downloadedBytes += await downloadToFile(url, joinProjectPath(projectDir, f.path));
      downloaded += 1;
      emit(onProgress, {
        step: 'downloading',
        status: 'running',
        current: downloaded,
        total: smallFiles.length,
        currentFile: f.path,
      });
    }
  }
  if (smallConflictFiles.length > 0) {
    const uniqueHashes = [...new Set(smallConflictFiles.map((f) => f.sha256))];
    const urlRes = await cloudClient.post('/api/objects/download-urls', { hashes: uniqueHashes });
    const urlBySha = new Map((urlRes.urls || []).map((u) => [u.sha256.toLowerCase(), u.downloadUrl]));
    if ((urlRes.missing || []).length > 0) {
      const err = new Error(`云端缺少 ${urlRes.missing.length} 个冲突文件的数据`);
      err.code = 'MISSING_BLOBS';
      err.details = urlRes.missing;
      throw err;
    }
    for (const f of smallConflictFiles) {
      checkCancel();
      const url = urlBySha.get(f.sha256.toLowerCase());
      if (!url) throw new Error(`缺少冲突文件下载 URL: ${f.path}`);
      const dest = joinProjectPath(projectDir, f.conflictPath);
      downloadedBytes += await downloadToFile(url, dest);
      downloaded += 1;
      conflictCopies.push({
        path: f.originalPath,
        conflictPath: f.conflictPath,
        name: f.name,
        kind: f.conflictKind,
        cloudSha: f.sha256,
        localSha: f.localSha,
        versionNumber: version?.versionNumber ?? null,
        placeholder: false,
        localPath: dest,
      });
      emit(onProgress, {
        step: 'downloading',
        status: 'running',
        current: downloaded,
        total: smallFiles.length + smallConflictFiles.length,
        currentFile: f.conflictPath,
      });
    }
  }
  emit(onProgress, { step: 'downloading', status: 'done', downloaded, placeholders: largeFiles.length });
  checkCancel();

  // ── Step 4: tag remote soft-deletes (keep local content) ──────────
  // Recorded in the binding's extra container so the UI can surface them; the
  // local files are intentionally left untouched.
  const remoteDeletedTags = plan.toPull.remoteDeleted.map((d) => ({
    path: d.path,
    name: d.name,
    deletedBy: d.deletedBy || null,
    deletedAt: d.deletedAt || null,
    taggedAt: new Date().toISOString(),
  }));

  // ── Step 5: advance baseline + binding ────────────────────────────
  emit(onProgress, { step: 'finalizing', status: 'running' });
  // Re-scan to capture actual local mtimes (downloaded files have "now" as
  // mtime, not the cloud's original timestamp). Merge soft-deleted cloud
  // entries which are not on disk.
  const postScan = await scanWorkspace(projectDir, { domain, projectName });
  const conflictOriginalPaths = new Set(plan.conflicts.map((c) => c.path));
  const conflictCopyPaths = new Set(conflictCopies.map((c) => c.conflictPath));
  const materializedBaselineEntries = postScan.entries.filter(
    (e) => !conflictOriginalPaths.has(e.path) && !conflictCopyPaths.has(e.path),
  );
  const cloudConflictEntries = cloudEntries.filter((e) => conflictOriginalPaths.has(e.path));
  const cloudSoftDeleted = cloudEntries.filter((e) => e.status === 'soft_deleted' && !conflictOriginalPaths.has(e.path));
  writeBaseline(projectDir, {
    versionId: version?.id || null,
    versionNumber: version?.versionNumber ?? null,
    entries: [...materializedBaselineEntries, ...cloudConflictEntries, ...cloudSoftDeleted],
  });
  writeCloudBinding(projectDir, {
    lastSyncedVersionId: version?.id || null,
    lastSyncedVersionNumber: version?.versionNumber ?? null,
    lastSyncedAt: new Date().toISOString(),
    extra: { remoteDeleted: remoteDeletedTags, conflictCopies },
  });
  if (conflictCopies.length > 0) {
    await cloudClient.post(`/api/workspaces/${workspaceId}/conflict-events`, {
      versionId: version?.id || null,
      versionNumber: version?.versionNumber ?? null,
      conflicts: conflictCopies.map((copy) => ({
        path: copy.path,
        conflictPath: copy.conflictPath,
        kind: copy.kind,
        localSha: copy.localSha || null,
        cloudSha: copy.cloudSha || null,
        resolution: 'kept_both',
      })),
    }).catch(() => undefined);
  }
  emit(onProgress, { step: 'finalizing', status: 'done' });

  emit(onProgress, { step: 'done', status: 'done', versionNumber: version?.versionNumber ?? null });

  return {
    ok: true,
    workspaceId,
    versionId: version?.id || null,
    versionNumber: version?.versionNumber ?? null,
    plan,
    conflicts: plan.conflicts,
    conflictCopies,
    stats: {
      downloaded,
      placeholders: largeFiles.length + largeConflictFiles.length,
      newFolders: plan.toPull.newFolders.length,
      remoteDeleted: remoteDeletedTags.length,
      conflictCopies: conflictCopies.length,
      downloadedBytes,
    },
  };
}
