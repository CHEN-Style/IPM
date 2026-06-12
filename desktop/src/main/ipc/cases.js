import fs from 'node:fs';
import path from 'node:path';

import { renameWorkspace } from '../../../Agent/storage/pathRemapper.js';

export function registerCasesIpc({
  ipcMain,
  dialog,
  shell,
  readState,
  writeState,
  getCasesRoot,
  sanitizeProjectName,
  sanitizeFileName,
  ensureUniqueDirPath,
  normalizeProjectStatus,
  isTombstoneProjectName,
  isEmptyDirSync,
  safeRmSync,
  quarantineProjectDirSync,
  looksLikeValidProjectDirSync,
  makeWritableRecursiveSync,
  enqueueDeleteDir,
  ensureProjectStructure,
  syncStructureJson,
  syncStructureFromExternal,
  isAttachedProject,
  readExternalLink,
  writeExternalLink,
  getWorkspaceDirOrThrow,
  sleepSync,
  trashOrRm,
  closeProjectDb,
  // W3b: rename 联动依赖
  getStudyDb,
  getSupervisorDb,
}) {
  if (!ipcMain) throw new Error('registerCasesIpc: ipcMain is required');

  const buildAttachedMeta = (projectDir) => {
    if (typeof isAttachedProject !== 'function' || !isAttachedProject(projectDir)) {
      return { attached: false };
    }
    const link = (typeof readExternalLink === 'function' ? readExternalLink(projectDir) : null) || {};
    return {
      attached: true,
      externalRootPath: link.rootPath || '',
      broken: Boolean(link.broken),
      brokenReason: link.brokenReason || '',
      lastScanAt: link.lastScanAt || '',
    };
  };

  // ===== Cases (案件) =====
  ipcMain.handle('cases/list', async () => {
    const root = getCasesRoot();
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
      return [];
    }
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const state = readState();
    const statusMap = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (isTombstoneProjectName(name)) {
        const fullPath = path.join(root, name);
        if (isEmptyDirSync(fullPath)) {
          try {
            safeRmSync(fullPath);
          } catch {
            // ignore
          }
        }
        continue;
      }
      const fullPath = path.join(root, name);
      // F1: 附属壳跳过 isEmptyDirSync 清理
      if (typeof isAttachedProject === 'function' && isAttachedProject(fullPath)) {
        out.push({
          name,
          path: fullPath,
          status: normalizeProjectStatus(statusMap[name] || 'active'),
          ...buildAttachedMeta(fullPath),
        });
        continue;
      }
      if (isEmptyDirSync(fullPath)) {
        try {
          safeRmSync(fullPath);
        } catch {
          try {
            quarantineProjectDirSync(root, name);
          } catch {
            // ignore
          }
        }
        continue;
      }
      out.push({
        name,
        path: fullPath,
        status: normalizeProjectStatus(statusMap[name] || 'active'),
        attached: false,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return out;
  });

  ipcMain.handle('cases/setStatus', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('名称不能为空');
    const dir = path.join(getCasesRoot(), name);
    if (!fs.existsSync(dir)) throw new Error(`目录不存在：${name}`);
    const status = normalizeProjectStatus(payload?.status);
    const state = readState();
    state.caseStatuses = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    state.caseStatuses[name] = status;
    writeState(state);
    return { ok: true, name, status };
  });

  ipcMain.handle('cases/create', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('名称不能为空');
    const root = getCasesRoot();
    const dir = path.join(root, name);
    if (fs.existsSync(dir)) {
      const isGhost = isEmptyDirSync(dir) || !looksLikeValidProjectDirSync(dir);
      if (!isGhost) {
        throw new Error(`已存在：${name}`);
      }
      try {
        makeWritableRecursiveSync(dir);
      } catch {
        // ignore
      }

      let cleared = false;
      try {
        safeRmSync(dir);
        if (!fs.existsSync(dir)) cleared = true;
      } catch {
        // ignore
      }

      if (!cleared) {
        try {
          await shell.trashItem(dir);
          if (!fs.existsSync(dir)) cleared = true;
        } catch {
          // ignore
        }
      }

      if (!cleared && fs.existsSync(dir)) {
        try {
          const tombstone = quarantineProjectDirSync(root, name);
          cleared = !fs.existsSync(dir);
          if (cleared) {
            try {
              enqueueDeleteDir(tombstone);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      if (fs.existsSync(dir)) {
        throw new Error(`发现残留目录但无法清理：${name}。请稍后重试、重启应用，或手动删除该文件夹。`);
      }
    }

    // W1: 同 projects/create，接收模板参数。
    const template = payload?.template === 'blank' ? 'blank' : 'default';
    const created = ensureProjectStructure(name, 'cases', { template });
    try {
      syncStructureJson(created.path, name);
    } catch {
      // ignore
    }
    const state = readState();
    state.currentCase = name;
    state.caseStatuses = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    state.caseStatuses[name] = normalizeProjectStatus(state.caseStatuses[name] || 'active');
    writeState(state);
    return created;
  });

  ipcMain.handle('cases/getCurrent', async () => {
    return readState().currentCase ?? null;
  });

  ipcMain.handle('cases/setCurrent', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('名称不能为空');
    const dir = path.join(getCasesRoot(), name);
    if (!fs.existsSync(dir)) throw new Error(`目录不存在：${name}`);
    const state = readState();
    state.currentCase = name;
    writeState(state);
    return { ok: true, currentCase: name };
  });

  // W3b: 案件重命名
  ipcMain.handle('cases/rename', async (_evt, payload) => {
    const oldName = sanitizeProjectName(payload?.oldName);
    const newName = sanitizeProjectName(payload?.newName);
    if (!oldName) throw new Error('原案件名不能为空');
    if (!newName) throw new Error('新案件名不能为空');
    if (oldName === newName) return { ok: true, projectName: oldName, noOp: true };

    const root = getCasesRoot();
    const oldDir = path.join(root, oldName);
    const newDir = path.join(root, newName);
    if (!fs.existsSync(oldDir)) throw new Error(`案件不存在：${oldName}`);
    if (fs.existsSync(newDir)) throw new Error(`新名称已存在：${newName}`);

    const res = renameWorkspace({
      oldName,
      newName,
      domain: 'cases',
      oldDir,
      newDir,
      readState,
      writeState,
      closeProjectDb,
      getStudyDb,
      getSupervisorDb,
    });

    if (!res.ok && !res.summary?.diskRenamed) {
      throw new Error(res.errors?.join('; ') || '重命名失败');
    }

    return {
      ok: res.ok,
      projectName: newName,
      summary: res.summary,
      errors: res.errors,
    };
  });

  ipcMain.handle('cases/delete', async (_evt, payload) => {
    const { name, projectDir } = getWorkspaceDirOrThrow(payload?.name, 'cases');
    const root = getCasesRoot();

    try { closeProjectDb?.(projectDir); } catch { /* ignore */ }

    // Step 3: brief delay for Windows to release file handles
    await new Promise((r) => setTimeout(r, 150));

    if (!fs.existsSync(projectDir)) {
      const state = readState();
      if (state.currentCase === name) state.currentCase = null;
      if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
      writeState(state);
      return { ok: true };
    }

    let tombstonePath = null;
    let renameSucceeded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (fs.existsSync(projectDir) && path.dirname(projectDir) === root) {
          try {
            makeWritableRecursiveSync(projectDir);
          } catch {
            // ignore
          }
          if (attempt > 0) sleepSync(80 * attempt);
          tombstonePath = quarantineProjectDirSync(root, name);
          if (!fs.existsSync(projectDir) && fs.existsSync(tombstonePath)) {
            renameSucceeded = true;
            break;
          }
          if (fs.existsSync(tombstonePath) && fs.existsSync(projectDir)) {
            try {
              safeRmSync(tombstonePath);
            } catch {
              // ignore
            }
          }
          tombstonePath = null;
        }
      } catch {
        tombstonePath = null;
      }
    }

    if (!renameSucceeded) {
      try {
        makeWritableRecursiveSync(projectDir);
      } catch {
        // ignore
      }

      try {
        await shell.trashItem(projectDir);
        if (!fs.existsSync(projectDir)) {
          const state = readState();
          if (state.currentCase === name) state.currentCase = null;
          if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore
      }

      try {
        safeRmSync(projectDir);
        sleepSync(100);
        if (!fs.existsSync(projectDir)) {
          const state = readState();
          if (state.currentCase === name) state.currentCase = null;
          if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore
      }

      throw new Error(`无法删除案件文件夹：${name}。\n\n可能原因：\n1. 文件夹被其他程序占用\n2. 权限不足\n3. Windows资源管理器正在访问该文件夹\n\n建议：\n- 关闭可能访问该文件夹的程序\n- 或重启应用后重试`);
    }

    try {
      await trashOrRm(tombstonePath);
    } catch {
      try {
        safeRmSync(tombstonePath);
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(tombstonePath)) {
      try {
        enqueueDeleteDir(tombstonePath);
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(projectDir)) {
      try {
        makeWritableRecursiveSync(projectDir);
        if (isEmptyDirSync(projectDir)) {
          safeRmSync(projectDir);
          if (fs.existsSync(projectDir)) {
            try {
              const ghost = quarantineProjectDirSync(root, name);
              enqueueDeleteDir(ghost);
            } catch {
              enqueueDeleteDir(projectDir);
            }
          }
        } else {
          try {
            const ghost = quarantineProjectDirSync(root, name);
            enqueueDeleteDir(ghost);
          } catch {
            enqueueDeleteDir(projectDir);
          }
        }
      } catch {
        try {
          enqueueDeleteDir(projectDir);
        } catch {
          // ignore
        }
      }
    }

    const state = readState();
    if (state.currentCase === name) state.currentCase = null;
    if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
    writeState(state);
    return { ok: true };
  });

  // ===== F1: Attached import =====
  ipcMain.handle('cases/importAttached', async (_evt, payload) => {
    if (!dialog) throw new Error('dialog 不可用');
    let pickedPath = String(payload?.path || '').trim();
    if (!pickedPath) {
      const res = await dialog.showOpenDialog({
        title: '选择要导入的外部文件夹（不会被复制）',
        properties: ['openDirectory'],
      });
      if (res.canceled || !res.filePaths?.length) {
        return { ok: true, canceled: true };
      }
      pickedPath = String(res.filePaths[0] || '').trim();
    }
    if (!pickedPath) return { ok: true, canceled: true };
    const externalRoot = path.resolve(pickedPath);
    let st;
    try { st = fs.statSync(externalRoot); }
    catch (e) { throw new Error(`所选路径不可访问：${e?.message || e}`); }
    if (!st.isDirectory()) throw new Error('所选路径不是文件夹');

    const root = getCasesRoot();
    fs.mkdirSync(root, { recursive: true });

    const rootResolved = path.resolve(root);
    if (path.resolve(externalRoot) === rootResolved
      || path.resolve(externalRoot).startsWith(rootResolved + path.sep)) {
      throw new Error('不能将数据存储区内部的目录作为外部文件夹导入');
    }

    const baseName = sanitizeFileName(path.basename(externalRoot)) || 'imported';
    const { name: shellName, fullPath: shellDir } = ensureUniqueDirPath(root, baseName);

    ensureProjectStructure(shellName, 'cases', { template: 'blank' });

    writeExternalLink(shellDir, {
      rootPath: externalRoot,
      importedAt: new Date().toISOString(),
      lastScanAt: '',
      lastScanStatus: '',
      broken: false,
      brokenReason: '',
    });

    let scanError = null;
    try {
      syncStructureFromExternal(shellDir, shellName);
    } catch (e) {
      scanError = e?.message || String(e);
    }

    const state = readState();
    state.caseStatuses = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    state.caseStatuses[shellName] = normalizeProjectStatus(state.caseStatuses[shellName] || 'active');
    state.currentCase = shellName;
    writeState(state);

    return {
      ok: true,
      name: shellName,
      path: shellDir,
      externalRootPath: externalRoot,
      scanError,
    };
  });

  ipcMain.handle('cases/relocateAttached', async (_evt, payload) => {
    if (!dialog) throw new Error('dialog 不可用');
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('案件名不能为空');
    const projectDir = path.join(getCasesRoot(), name);
    if (!fs.existsSync(projectDir)) throw new Error(`案件不存在：${name}`);
    if (typeof isAttachedProject !== 'function' || !isAttachedProject(projectDir)) {
      throw new Error('该案件不是外部导入项目（附属壳）');
    }

    let newPath = String(payload?.newPath || '').trim();
    if (!newPath) {
      const res = await dialog.showOpenDialog({
        title: '选择新的外部根路径',
        properties: ['openDirectory'],
      });
      if (res.canceled || !res.filePaths?.length) return { ok: true, canceled: true };
      newPath = String(res.filePaths[0] || '').trim();
    }
    if (!newPath) return { ok: true, canceled: true };
    const newAbs = path.resolve(newPath);
    let st;
    try { st = fs.statSync(newAbs); }
    catch (e) { throw new Error(`新路径不可访问：${e?.message || e}`); }
    if (!st.isDirectory()) throw new Error('新路径不是文件夹');

    const link = readExternalLink(projectDir) || {};
    writeExternalLink(projectDir, {
      ...link,
      rootPath: newAbs,
      lastScanAt: '',
      broken: false,
      brokenReason: '',
    });
    let scanError = null;
    try {
      syncStructureFromExternal(projectDir, name);
    } catch (e) {
      scanError = e?.message || String(e);
    }
    return { ok: true, name, externalRootPath: newAbs, scanError };
  });

  ipcMain.handle('cases/refreshAttached', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('案件名不能为空');
    const projectDir = path.join(getCasesRoot(), name);
    if (!fs.existsSync(projectDir)) throw new Error(`案件不存在：${name}`);
    if (typeof isAttachedProject !== 'function' || !isAttachedProject(projectDir)) {
      throw new Error('该案件不是外部导入项目（附属壳）');
    }
    let scanError = null;
    try {
      syncStructureFromExternal(projectDir, name);
    } catch (e) {
      scanError = e?.message || String(e);
    }
    const link = readExternalLink(projectDir) || {};
    return {
      ok: true,
      name,
      externalRootPath: link.rootPath || '',
      broken: Boolean(link.broken),
      brokenReason: link.brokenReason || '',
      lastScanAt: link.lastScanAt || '',
      scanError,
    };
  });
}


