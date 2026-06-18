import fs from 'node:fs';
import path from 'node:path';

export function registerFloatingIpc({
  ipcMain,
  readState,
  normalizeProjectStatus,
  getWorkspaceDirOrThrow,
  sanitizeFileName,
  ensureTempDir,
  getProjectStructurePath,
  syncStructureJson,
  ensureUniqueDestPath,
  upsertTempSourceRecord,
  triggerAutoClassifyToAiStorage,
  agentLog,
  resolveInside,
  safeRmSync,
  deleteTempSourceRecordByRelPath,
}) {
  if (!ipcMain) throw new Error('registerFloatingIpc: ipcMain is required');

  const getTargetStatus = (name, domain) => {
    if (domain === 'study') return 'active';
    const state = typeof readState === 'function' ? readState() : {};
    const mapKey = domain === 'cases' ? 'caseStatuses' : 'projectStatuses';
    const statusMap = state?.[mapKey] && typeof state[mapKey] === 'object' ? state[mapKey] : {};
    const normalize = typeof normalizeProjectStatus === 'function' ? normalizeProjectStatus : (v) => String(v || 'active').toLowerCase();
    return normalize(statusMap[name] || 'active');
  };

  // ===== Floating: file copy to temp (no business indexing yet) =====
  ipcMain.handle('floating/copyToTemp', async (_evt, payload) => {
    const { name: projectName, projectDir, domain } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const targetStatus = getTargetStatus(projectName, domain);
    if (targetStatus !== 'active') {
      const label = domain === 'cases' ? '案件' : '项目';
      throw new Error(`${label}「${projectName}」当前状态为 ${targetStatus}，悬浮窗只允许向 ACTIVE 状态写入文件。`);
    }
    const srcPath = String(payload?.srcPath ?? '');
    if (!srcPath) throw new Error('源文件路径不能为空');
    if (!fs.existsSync(srcPath)) throw new Error('源文件不存在');
    const st = fs.statSync(srcPath);
    if (!st.isFile()) throw new Error('源路径不是文件');

    const rawName = payload?.fileName ? String(payload.fileName) : path.basename(srcPath);
    const safeName = sanitizeFileName(rawName) || 'file';

    const tempDir = ensureTempDir(projectDir);
    // temp/ might be created lazily; keep structure.json in sync (best-effort)
    if (!fs.existsSync(getProjectStructurePath(projectDir))) {
      try {
        syncStructureJson(projectDir, projectName);
      } catch {
        // ignore
      }
    }
    const destPath = ensureUniqueDestPath(tempDir, safeName);
    fs.copyFileSync(srcPath, destPath);

    // Record source info immediately (independent of AI success/failure)
    const sourceRelPath = path.relative(projectDir, destPath).split(path.sep).join('/');
    try {
      upsertTempSourceRecord(projectDir, projectName, {
        sourceRelPath,
        sourcePath: srcPath,
        sourceDir: path.dirname(srcPath),
        fileName: safeName,
        sourceSizeBytes: st.size,
        capturedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }

    // Trigger AI classification (non-blocking): ONLY uses fileName/ext + structure.json
    try {
      agentLog('INFO', 'floating upload saved to temp', { projectName, sourceRelPath });
      void triggerAutoClassifyToAiStorage({ domain, projectName, projectDir, sourceRelPath });
    } catch {
      // ignore
    }

    return {
      ok: true,
      projectName,
      domain,
      savedRelPath: path.relative(projectDir, destPath).split(path.sep).join('/'),
    };
  });

  ipcMain.handle('floating/deleteRelPath', async (_evt, payload) => {
    const { name: projectName, projectDir, domain } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');
    // floating/deleteRelPath 只允许删 temp/ 下的文件，temp/ 始终在壳内 → resolveInside 即可。
    const target = resolveInside(projectDir, relPath);
    if (!fs.existsSync(target)) return { ok: true, projectName, deleted: false };
    // Only allow undo deletion inside temp/
    const tempDir = ensureTempDir(projectDir);
    const tempAbs = path.resolve(tempDir);
    const targetAbs = path.resolve(target);
    if (!(targetAbs === tempAbs || targetAbs.startsWith(tempAbs + path.sep))) {
      throw new Error('仅允许删除 temp 目录下的文件');
    }
    safeRmSync(targetAbs);
    try {
      deleteTempSourceRecordByRelPath(projectDir, relPath);
    } catch {
      // ignore
    }
    return { ok: true, projectName, domain, deleted: true };
  });
}


