import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LARGE_FILE_THRESHOLD, PLACEHOLDER_SUFFIX } from './cloudConstants.js';
import { downloadToFile, writePlaceholder } from './pullWorkspace.js';

function joinProjectPath(projectDir, posixPath) {
  const rel = String(posixPath || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  return path.join(projectDir, ...segments);
}

function normalizeManifestPath(input) {
  const trimmed = String(input || '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  return `/${trimmed.replace(/^\/+/, '')}`;
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

function backupPathFor(destPath) {
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = ext ? path.basename(destPath, ext) : path.basename(destPath);
  const stamp = timestampForName();
  let candidate = path.join(dir, `${base}（恢复前备份-${stamp}）${ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}（恢复前备份-${stamp}）(${index})${ext}`);
    index += 1;
  }
  return candidate;
}

export async function restoreFileFromVersion({
  projectDir,
  workspaceId,
  versionId,
  relPath,
  cloudClient,
  largeFileThresholdBytes = DEFAULT_LARGE_FILE_THRESHOLD,
}) {
  if (!projectDir) throw new Error('restoreFileFromVersion: projectDir is required');
  if (!workspaceId) throw new Error('restoreFileFromVersion: workspaceId is required');
  if (!versionId) throw new Error('restoreFileFromVersion: versionId is required');
  if (!cloudClient) throw new Error('restoreFileFromVersion: cloudClient is required');

  const manifestPath = normalizeManifestPath(relPath);
  if (!manifestPath) throw new Error('缺少要恢复的文件路径');

  const fileInfo = await cloudClient.post(`/api/workspaces/${workspaceId}/versions/${versionId}/file-download`, {
    path: manifestPath,
  });
  if (!fileInfo?.ok) throw new Error(fileInfo?.error || '获取历史文件失败');

  const destPath = joinProjectPath(projectDir, manifestPath);
  const placeholderPath = `${destPath}${PLACEHOLDER_SUFFIX}`;
  let backupPath = null;
  let backupPlaceholderPath = null;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (fs.existsSync(destPath)) {
    backupPath = backupPathFor(destPath);
    fs.copyFileSync(destPath, backupPath);
  }
  if (fs.existsSync(placeholderPath)) {
    backupPlaceholderPath = backupPathFor(placeholderPath);
    fs.copyFileSync(placeholderPath, backupPlaceholderPath);
  }

  if ((fileInfo.sizeBytes ?? 0) > largeFileThresholdBytes) {
    if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true });
    writePlaceholder(destPath, {
      ...fileInfo,
      originalName: fileInfo.name,
      path: manifestPath,
    });
    return {
      ok: true,
      path: manifestPath,
      restoredAsPlaceholder: true,
      backupPath,
      backupPlaceholderPath,
      sizeBytes: fileInfo.sizeBytes ?? null,
      sha256: fileInfo.sha256,
    };
  }

  if (fs.existsSync(placeholderPath)) fs.rmSync(placeholderPath, { force: true });
  await downloadToFile(fileInfo.downloadUrl, destPath);

  return {
    ok: true,
    path: manifestPath,
    restoredAsPlaceholder: false,
    backupPath,
    backupPlaceholderPath,
    sizeBytes: fileInfo.sizeBytes ?? null,
    sha256: fileInfo.sha256,
  };
}
