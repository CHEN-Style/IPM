import fs from 'node:fs';
import path from 'node:path';

export function registerExplorerIpc({
  ipcMain,
  dialog,
  shell,
  // workspace & path helpers
  sanitizeProjectName,
  normalizeRelPathPosix,
  normalizeWorkspaceDomain,
  getWorkspaceRoot,
  getStudyRoot,
  STUDY_WORKSPACE_NAME,
  getWorkspaceDirOrThrow,
  resolveInside,
  asPosixRel,
  // permissions / protection
  isProtectedRelPath,
  isProtectedFolderNameRelPath,
  // fs ops
  trashOrRm,
  waitUntilGoneSync,
  sanitizeFileName,
  ensureUniqueDestPath,
  ensureUniqueDirPath,
  confirmAutoSuffix,
  // structure / migrations
  ensureProjectStructure,
  syncStructureJson,
  safeReadJson,
  getProjectStructurePath,
  remapStructureDocRelPaths,
  // legacy migrations / records
  migrateLegacySnippetRecordFilesIfNeeded,
  migrateLegacyScreenshotFolderIfNeeded,
  migrateLegacyItemsJsonIfNeeded,
  removeRecordItemsByContentRelPath,
  getClipboardRecordPath,
  getScreenshotRecordPath,
  // ai storage sync (temp delete)
  listAiSuggestions,
  setAiSuggestionStatus,
}) {
  if (!ipcMain) throw new Error('registerExplorerIpc: ipcMain is required');

  ipcMain.handle('explorer/list', async (_evt, payload) => {
    const projectName = sanitizeProjectName(payload?.projectName);
    // Normalize relPath to a safe posix-style relative path.
    // This prevents subtle Windows path separator issues (e.g. "\"), extra slashes,
    // or leading/trailing whitespace from breaking directory expansion in Explorer View.
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const domain = normalizeWorkspaceDomain(payload?.domain);
    const isStudyRoot = domain === 'study' && !projectName;
    if (!projectName && !isStudyRoot) throw new Error('名称不能为空');

    const effectiveName = isStudyRoot ? STUDY_WORKSPACE_NAME : projectName;
    const projectDir = isStudyRoot ? getStudyRoot() : path.join(getWorkspaceRoot(domain), projectName);
    if (!fs.existsSync(projectDir)) throw new Error(`目录不存在：${effectiveName}`);

    // Lazy init for legacy projects: ensure new meta layout exists, and migrate old meta/items.json once.
    try {
      ensureProjectStructure(isStudyRoot ? '' : effectiveName, domain);
      if (domain !== 'study') {
        migrateLegacySnippetRecordFilesIfNeeded(projectDir, effectiveName);
        migrateLegacyScreenshotFolderIfNeeded(projectDir);
        migrateLegacyItemsJsonIfNeeded(projectDir, effectiveName);
      }
    } catch {
      // ignore
    }

    const dir = resolveInside(projectDir, relPath);
    if (!fs.existsSync(dir)) throw new Error('目录不存在');

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const mapped = entries.map((e) => {
      const fullPath = path.join(dir, e.name);
      const st = fs.statSync(fullPath);
      const kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other';
      return {
        name: e.name,
        kind,
        relPath: path.relative(projectDir, fullPath).split(path.sep).join('/'),
        sizeBytes: kind === 'file' ? st.size : 0,
        mtimeMs: st.mtimeMs,
      };
    });

    const dirRank = (entry) => {
      if (entry.kind !== 'dir') return 1000;
      const rp = normalizeRelPathPosix(entry.relPath);
      // Keep system folders always at the bottom of the folder list.
      if (rp === 'temp') return 900;
      if (rp === 'snippets') return 910;
      if (rp === 'meta') return 920;
      return 0;
    };
    mapped.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      const ra = dirRank(a);
      const rb = dirRank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    return {
      projectName: effectiveName,
      relPath,
      entries: mapped,
    };
  });

  // ===== Explorer: read text file (limited, for snippet cards) =====
  ipcMain.handle('explorer/readText', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');

    // Security/constraint (Step 2 MVP): only allow reading snippet clipboard txt files
    if (!(relPath === 'snippets/clipboard' || relPath.startsWith('snippets/clipboard/'))) {
      throw new Error('仅允许读取 snippets/clipboard 下的文本文件');
    }
    if (!relPath.toLowerCase().endsWith('.txt')) {
      throw new Error('仅允许读取 .txt 文件');
    }

    const target = resolveInside(projectDir, relPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error('目标不是文件');

    const maxBytes = Math.max(1024, Math.min(1024 * 1024, Number(payload?.maxBytes) || 256 * 1024));
    const buf = fs.readFileSync(target);
    const truncated = buf.length > maxBytes;
    const sliced = truncated ? buf.subarray(0, maxBytes) : buf;
    const text = sliced.toString('utf-8');

    return { ok: true, projectName, relPath, text, truncated };
  });

  // ===== Explorer: open a file with OS default application =====
  ipcMain.handle('explorer/open', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');
    const target = resolveInside(projectDir, relPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error('仅支持打开文件（不支持打开文件夹）');

    // shell.openPath returns '' on success, otherwise an error message string.
    const errMsg = await shell.openPath(target);
    if (errMsg) throw new Error(`打开失败：${errMsg}`);
    return { ok: true, projectName, relPath: asPosixRel(relPath) };
  });

  ipcMain.handle('explorer/mkdir', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.relPath ?? '');
    const folderName = sanitizeFileName(payload?.folderName);
    if (!folderName) throw new Error('文件夹名称不能为空');

    const dir = resolveInside(projectDir, relPath);
    if (!fs.existsSync(dir)) throw new Error('目录不存在');

    const relPosix = normalizeRelPathPosix(path.join(relPath, folderName));
    if (isProtectedFolderNameRelPath(relPosix)) {
      throw new Error('业务/系统固定目录禁止创建/覆盖');
    }

    const desired = resolveInside(projectDir, path.join(relPath, folderName));
    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, conflict: true };
      const { fullPath, name } = ensureUniqueDirPath(dir, folderName);
      fs.mkdirSync(fullPath, { recursive: true });
      try {
        syncStructureJson(projectDir, projectName);
      } catch {
        // ignore
      }
      return { ok: true, projectName, createdName: name };
    }

    fs.mkdirSync(desired, { recursive: true });
    try {
      syncStructureJson(projectDir, projectName);
    } catch {
      // ignore
    }
    return { ok: true, projectName, createdName: folderName };
  });

  ipcMain.handle('explorer/delete', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const entryRelPath = String(payload?.relPath ?? '');
    if (!entryRelPath) throw new Error('目标路径不能为空');
    const relPosix = normalizeRelPathPosix(entryRelPath);
    if (isProtectedFolderNameRelPath(relPosix)) {
      throw new Error('系统目录禁止删除（如需删除请直接删除整个项目）');
    }
    const target = resolveInside(projectDir, entryRelPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    let wasDir = false;
    try {
      wasDir = fs.statSync(target).isDirectory();
    } catch {
      wasDir = false;
    }

    // Allow deleting files under temp/ (but not folders) to support user cleanup of staging files.
    const isTempChild = relPosix.startsWith('temp/');
    if (!isTempChild && isProtectedRelPath(relPosix)) {
      throw new Error('该目录为系统元数据目录，禁止删除');
    }
    if (isTempChild && wasDir) {
      throw new Error('temp 目录下不允许删除文件夹');
    }
    await trashOrRm(target);
    if (!waitUntilGoneSync(target)) {
      throw new Error('删除尚未完成，请稍后重试');
    }

    // If user deleted a staged temp file, mark pending AI suggestion as source_deleted to avoid stale ghosts.
    if (isTempChild && !wasDir) {
      try {
        const all = listAiSuggestions(projectDir, projectName, {});
        const s = all.find((x) => normalizeRelPathPosix(x?.sourceRelPath) === relPosix);
        if (s && String(s.status) === 'pending') {
          setAiSuggestionStatus(projectDir, projectName, relPosix, { status: 'source_deleted', deletedAt: new Date().toISOString() });
        }
      } catch {
        // ignore
      }
    }

    // If user deletes snippet/screenshot content files via explorer, keep records in sync (best-effort).
    try {
      // Ensure new layout exists for legacy projects
      ensureProjectStructure(projectName, payload?.domain);
      migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
      migrateLegacyScreenshotFolderIfNeeded(projectDir);
      migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
      const rp = relPosix;

      // Clipboard snippets content deletion => update clipboard record
      if (
        (rp === 'snippets/clipboard' || rp.startsWith('snippets/clipboard/')) &&
        !(rp === 'snippets/snippets-meta' || rp.startsWith('snippets/snippets-meta/'))
      ) {
        removeRecordItemsByContentRelPath(getClipboardRecordPath(projectDir), projectName, rp, wasDir);
      }

      // Screenshot snippets content deletion => update screenshot record
      if (
        (rp === 'snippets/screenshots' || rp.startsWith('snippets/screenshots/')) &&
        !(rp === 'snippets/snippets-meta' || rp.startsWith('snippets/snippets-meta/'))
      ) {
        removeRecordItemsByContentRelPath(getScreenshotRecordPath(projectDir), projectName, rp, wasDir);
      }
    } catch {
      // ignore in MVP
    }

    try {
      syncStructureJson(projectDir, projectName);
    } catch {
      // ignore
    }
    return { ok: true, projectName };
  });

  ipcMain.handle('explorer/upload', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const destRelPath = String(payload?.destRelPath ?? '');
    const destDir = resolveInside(projectDir, destRelPath);
    if (!fs.existsSync(destDir)) throw new Error('目标目录不存在');

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled) return { ok: true, projectName, copied: 0 };

    // Check conflicts first (same filename+ext)
    const planned = filePaths.map((srcPath) => {
      const baseName = path.basename(srcPath);
      const safeName = sanitizeFileName(baseName) || 'file';
      return { srcPath, safeName };
    });
    const conflicts = planned
      .map((p) => p.safeName)
      .filter((name, idx, arr) => arr.indexOf(name) !== idx || fs.existsSync(path.join(destDir, name)));
    const uniqConflicts = Array.from(new Set(conflicts));
    if (uniqConflicts.length) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, copied: 0, conflict: true, conflicts: uniqConflicts };
    }

    let copied = 0;
    for (const p of planned) {
      const targetPath = uniqConflicts.length ? ensureUniqueDestPath(destDir, p.safeName) : path.join(destDir, p.safeName);
      fs.copyFileSync(p.srcPath, targetPath);
      copied += 1;
    }
    return { ok: true, projectName, copied };
  });

  ipcMain.handle('explorer/drop-upload', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const destRelPath = String(payload?.destRelPath ?? '');
    const destDir = resolveInside(projectDir, destRelPath);
    if (!fs.existsSync(destDir)) throw new Error('目标目录不存在');

    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
    if (!filePaths.length) return { ok: true, projectName, copied: 0 };

    const copyRecursive = (srcPath, parentDir) => {
      const st = fs.statSync(srcPath);
      const baseName = sanitizeFileName(path.basename(srcPath)) || 'file';
      if (st.isFile()) {
        const dest = ensureUniqueDestPath(parentDir, baseName);
        fs.copyFileSync(srcPath, dest);
      } else if (st.isDirectory()) {
        const { fullPath } = ensureUniqueDirPath(parentDir, baseName);
        fs.mkdirSync(fullPath, { recursive: true });
        for (const child of fs.readdirSync(srcPath)) {
          copyRecursive(path.join(srcPath, child), fullPath);
        }
      }
    };

    let copied = 0;
    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) continue;
      copyRecursive(fp, destDir);
      copied += 1;
    }

    return { ok: true, projectName, copied };
  });

  ipcMain.handle('explorer/rename', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const entryRelPath = String(payload?.relPath ?? '');
    const newNameRaw = String(payload?.newName ?? '');
    if (!entryRelPath) throw new Error('目标路径不能为空');
    if (isProtectedFolderNameRelPath(entryRelPath)) {
      throw new Error('系统目录禁止重命名');
    }
    if (isProtectedRelPath(entryRelPath)) {
      throw new Error('该目录为系统元数据目录，禁止重命名');
    }
    const target = resolveInside(projectDir, entryRelPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');

    const st = fs.statSync(target);
    const parentDir = path.dirname(target);
    const newName = sanitizeFileName(newNameRaw);
    if (!newName) throw new Error('新名称不能为空');

    let desired = path.join(parentDir, newName);
    // Same name (no-op)
    if (path.resolve(desired) === path.resolve(target)) {
      return { ok: true, projectName, renamedTo: path.basename(target) };
    }
    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, conflict: true };
      if (st.isDirectory()) {
        const { fullPath, name } = ensureUniqueDirPath(parentDir, newName);
        desired = fullPath;
        try {
          const prev = safeReadJson(getProjectStructurePath(projectDir), null);
          const fromRel = asPosixRel(entryRelPath);
          const toRel = asPosixRel(path.relative(projectDir, desired));
          const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
          fs.renameSync(target, desired);
          syncStructureJson(projectDir, projectName, seeded);
        } catch {
          fs.renameSync(target, desired);
          try {
            syncStructureJson(projectDir, projectName);
          } catch {
            // ignore
          }
        }
        return { ok: true, projectName, renamedTo: name };
      }
      const unique = ensureUniqueDestPath(parentDir, newName);
      fs.renameSync(target, unique);
      return { ok: true, projectName, renamedTo: path.basename(unique) };
    }

    if (st.isDirectory()) {
      try {
        const prev = safeReadJson(getProjectStructurePath(projectDir), null);
        const fromRel = asPosixRel(entryRelPath);
        const toRel = asPosixRel(path.relative(projectDir, desired));
        const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
        fs.renameSync(target, desired);
        syncStructureJson(projectDir, projectName, seeded);
      } catch {
        fs.renameSync(target, desired);
        try {
          syncStructureJson(projectDir, projectName);
        } catch {
          // ignore
        }
      }
    } else {
      fs.renameSync(target, desired);
    }
    return { ok: true, projectName, renamedTo: newName };
  });

  ipcMain.handle('explorer/move', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const srcRelPath = String(payload?.srcRelPath ?? '');
    const destDirRelPath = String(payload?.destDirRelPath ?? '');
    if (!srcRelPath) throw new Error('源路径不能为空');
    if (isProtectedFolderNameRelPath(srcRelPath)) {
      throw new Error('系统目录禁止移动');
    }
    if (isProtectedRelPath(srcRelPath) || isProtectedRelPath(destDirRelPath)) {
      throw new Error('该目录为系统元数据目录，禁止移动');
    }

    const srcPath = resolveInside(projectDir, srcRelPath);
    if (!fs.existsSync(srcPath)) throw new Error('源目标不存在');

    const destDirPath = resolveInside(projectDir, destDirRelPath);
    if (!fs.existsSync(destDirPath)) throw new Error('目标目录不存在');
    const destDirStat = fs.statSync(destDirPath);
    if (!destDirStat.isDirectory()) throw new Error('目标不是目录');

    const st = fs.statSync(srcPath);
    const baseName = path.basename(srcPath);
    let desired = path.join(destDirPath, baseName);

    // no-op: moving into same folder
    if (path.resolve(desired) === path.resolve(srcPath)) {
      return { ok: true, projectName, movedTo: srcRelPath };
    }

    // prevent moving a folder into itself/descendant
    if (st.isDirectory()) {
      const srcAbs = path.resolve(srcPath);
      const destAbs = path.resolve(destDirPath);
      // drop into itself => treat as no-op
      if (destAbs === srcAbs) {
        return { ok: true, projectName, movedTo: srcRelPath };
      }
      if (destAbs.startsWith(srcAbs + path.sep)) {
        throw new Error('不能将文件夹移动到其自身或子目录中');
      }
    }

    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, conflict: true };
      if (st.isDirectory()) {
        const { fullPath, name } = ensureUniqueDirPath(destDirPath, baseName);
        desired = fullPath;
        try {
          const prev = safeReadJson(getProjectStructurePath(projectDir), null);
          const fromRel = asPosixRel(srcRelPath);
          const toRel = asPosixRel(path.relative(projectDir, desired));
          const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
          fs.renameSync(srcPath, desired);
          syncStructureJson(projectDir, projectName, seeded);
        } catch {
          fs.renameSync(srcPath, desired);
          try {
            syncStructureJson(projectDir, projectName);
          } catch {
            // ignore
          }
        }
        return {
          ok: true,
          projectName,
          movedTo: asPosixRel(path.relative(projectDir, desired)),
          movedName: name,
        };
      }
      const unique = ensureUniqueDestPath(destDirPath, baseName);
      fs.renameSync(srcPath, unique);
      return {
        ok: true,
        projectName,
        movedTo: asPosixRel(path.relative(projectDir, unique)),
        movedName: path.basename(unique),
      };
    }

    if (st.isDirectory()) {
      try {
        const prev = safeReadJson(getProjectStructurePath(projectDir), null);
        const fromRel = asPosixRel(srcRelPath);
        const toRel = asPosixRel(path.relative(projectDir, desired));
        const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
        fs.renameSync(srcPath, desired);
        syncStructureJson(projectDir, projectName, seeded);
      } catch {
        fs.renameSync(srcPath, desired);
        try {
          syncStructureJson(projectDir, projectName);
        } catch {
          // ignore
        }
      }
    } else {
      fs.renameSync(srcPath, desired);
    }
    return {
      ok: true,
      projectName,
      movedTo: asPosixRel(path.relative(projectDir, desired)),
      movedName: baseName,
    };
  });
}


