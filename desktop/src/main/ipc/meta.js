export function registerMetaIpc({
  ipcMain,
  getWorkspaceDirOrThrow,
  normalizeRelPathPosix,
  isProtectedRelPath,
  isSystemFolderRelPath,
  ensureProjectStructure,
  syncStructureJson,
  safeReadJson,
  getProjectStructurePath,
  atomicWriteFileSync,
  appendJsonl,
  getProjectLogPath,
}) {
  if (!ipcMain) throw new Error('registerMetaIpc: ipcMain is required');

  // ===== Meta: folder info (from meta/structure.json) =====
  ipcMain.handle('meta/getFolderInfo', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');

    // Ensure structure exists and is reasonably up to date (best-effort)
    try {
      ensureProjectStructure(projectName, payload?.domain);
      syncStructureJson(projectDir, projectName);
    } catch {
      // ignore
    }

    const doc = safeReadJson(getProjectStructurePath(projectDir), null);
    const folders = doc && typeof doc === 'object' && doc.folders && typeof doc.folders === 'object' ? doc.folders : {};
    const meta = folders[relPath] && typeof folders[relPath] === 'object' ? folders[relPath] : null;
    return {
      ok: true,
      projectName,
      relPath,
      folder: meta,
      structureUpdatedAt: doc?.updatedAt || null,
    };
  });

  ipcMain.handle('meta/setFolderDescription', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const description = String(payload?.description ?? '');

    if (isProtectedRelPath(relPath) || isSystemFolderRelPath(relPath)) {
      throw new Error('该目录为系统目录，禁止编辑简介');
    }

    // Ensure structure exists & contains folder entries
    ensureProjectStructure(projectName, payload?.domain);
    let doc = null;
    try {
      doc = syncStructureJson(projectDir, projectName);
    } catch {
      doc = safeReadJson(getProjectStructurePath(projectDir), null);
    }
    if (!doc || typeof doc !== 'object') throw new Error('structure.json 不可用');
    doc.folders = doc.folders && typeof doc.folders === 'object' ? doc.folders : {};
    if (!doc.folders[relPath]) {
      throw new Error('文件夹不存在或未被结构索引收录');
    }

    const now = new Date().toISOString();
    const folder = doc.folders[relPath] && typeof doc.folders[relPath] === 'object' ? doc.folders[relPath] : {};
    folder.description = description;
    folder.updatedAt = now;
    doc.folders[relPath] = folder;
    doc.updatedAt = now;

    atomicWriteFileSync(getProjectStructurePath(projectDir), JSON.stringify(doc, null, 2), 'utf-8');

    try {
      appendJsonl(getProjectLogPath(projectDir), {
        ts: now,
        event: 'folder.description.updated',
        projectName,
        relPath,
        size: description.length,
      });
    } catch {
      // ignore
    }

    return { ok: true, projectName, relPath, folder };
  });
}


