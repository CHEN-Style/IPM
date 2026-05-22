import fs from 'node:fs';
import path from 'node:path';

import { renameWorkspace } from '../../../Agent/storage/pathRemapper.js';

export function registerProjectsIpc({
  ipcMain,
  dialog,
  shell,
  readState,
  writeState,
  getProjectsRoot,
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
  getProjectDirOrThrow,
  sleepSync,
  trashOrRm,
  closeProjectDb,
  // W3b: rename 联动依赖
  getStudyDb,
  getSupervisorDb,
}) {
  if (!ipcMain) throw new Error('registerProjectsIpc: ipcMain is required');

  // F1: 读取附属壳 metadata，给 list 返回结果附加 attached/externalRootPath/broken 字段。
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

  ipcMain.handle('projects/list', async () => {
    const root = getProjectsRoot();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const state = readState();
    const statusMap = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (isTombstoneProjectName(name)) {
        // best-effort cleanup of tombstones; never show in UI
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
      // Clean up ghost project dirs that may remain as empty stubs after deletion (Windows edge cases).
      // F1: 附属壳的"业务文件夹"在外部，壳内只有 meta/temp/snippets，因此不参与 isEmptyDirSync 清理。
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
          // If we cannot delete, quarantine it so the name becomes available for re-creation.
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

  ipcMain.handle('projects/setStatus', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projDir = path.join(getProjectsRoot(), name);
    if (!fs.existsSync(projDir)) throw new Error(`项目不存在：${name}`);
    const status = normalizeProjectStatus(payload?.status);
    const state = readState();
    state.projectStatuses = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    state.projectStatuses[name] = status;
    writeState(state);
    return { ok: true, name, status };
  });

  ipcMain.handle('projects/create', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projectsRoot = getProjectsRoot();
    const projDir = path.join(projectsRoot, name);
    if (fs.existsSync(projDir)) {
      // If it's a ghost / invalid dir (or empty), clean/quarantine it so user can re-create same name.
      const isGhost = isEmptyDirSync(projDir) || !looksLikeValidProjectDirSync(projDir);
      if (!isGhost) {
        throw new Error(`项目已存在：${name}`);
      }

      // ENHANCED: Make writable first (Windows EPERM fix)
      try {
        makeWritableRecursiveSync(projDir);
      } catch {
        // ignore
      }

      // Try multiple strategies to remove ghost folder
      let cleared = false;

      // Strategy 1: Direct hard delete
      try {
        safeRmSync(projDir);
        if (!fs.existsSync(projDir)) {
          cleared = true;
        }
      } catch {
        // ignore, try next strategy
      }

      // Strategy 2: Move to recycle bin
      if (!cleared) {
        try {
          await shell.trashItem(projDir);
          if (!fs.existsSync(projDir)) {
            cleared = true;
          }
        } catch {
          // ignore, try next strategy
        }
      }

      // Strategy 3: Quarantine (rename) to free the name
      if (!cleared && fs.existsSync(projDir)) {
        try {
          const tombstone = quarantineProjectDirSync(projectsRoot, name);
          cleared = !fs.existsSync(projDir);
          // Try to delete tombstone in background
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

      // Final check: if original name still exists, we cannot proceed
      if (fs.existsSync(projDir)) {
        throw new Error(`发现残留项目目录但无法清理：${name}。请稍后重试、重启应用，或手动删除该文件夹。`);
      }
    }
    // W1: 接收 renderer 传入的模板参数（'default' / 'blank'），向下传递至
    // ensureProjectStructure；缺省回退 'default' 保持向后兼容。
    const template = payload?.template === 'blank' ? 'blank' : 'default';
    const proj = ensureProjectStructure(name, 'projects', { template });
    // best-effort: seed structure.json immediately on creation
    try {
      syncStructureJson(proj.path, name);
    } catch {
      // ignore
    }
    // auto set current on creation
    const state = readState();
    state.currentProject = name;
    state.projectStatuses = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    state.projectStatuses[name] = normalizeProjectStatus(state.projectStatuses[name] || 'active');
    writeState(state);
    return proj;
  });

  ipcMain.handle('projects/getCurrent', async () => {
    return readState().currentProject ?? null;
  });

  ipcMain.handle('projects/setCurrent', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projDir = path.join(getProjectsRoot(), name);
    if (!fs.existsSync(projDir)) throw new Error(`项目不存在：${name}`);
    const state = readState();
    state.currentProject = name;
    writeState(state);
    return { ok: true, currentProject: name };
  });

  // W3b: 项目重命名
  ipcMain.handle('projects/rename', async (_evt, payload) => {
    const oldName = sanitizeProjectName(payload?.oldName);
    const newName = sanitizeProjectName(payload?.newName);
    if (!oldName) throw new Error('原项目名不能为空');
    if (!newName) throw new Error('新项目名不能为空');
    if (oldName === newName) return { ok: true, projectName: oldName, noOp: true };

    const root = getProjectsRoot();
    const oldDir = path.join(root, oldName);
    const newDir = path.join(root, newName);
    if (!fs.existsSync(oldDir)) throw new Error(`项目不存在：${oldName}`);
    if (fs.existsSync(newDir)) throw new Error(`新名称已存在：${newName}`);

    const res = renameWorkspace({
      oldName,
      newName,
      domain: 'projects',
      oldDir,
      newDir,
      readState,
      writeState,
      closeProjectDb,
      getStudyDb,
      getSupervisorDb,
    });

    if (!res.ok && !res.summary?.diskRenamed) {
      // 主操作（磁盘 rename）都失败了 → 整体失败
      throw new Error(res.errors?.join('; ') || '重命名失败');
    }

    return {
      ok: res.ok,
      projectName: newName,
      summary: res.summary,
      errors: res.errors,
    };
  });

  ipcMain.handle('projects/delete', async (_evt, payload) => {
    const { name, projectDir } = getProjectDirOrThrow(payload?.name);
    const root = getProjectsRoot();

    try { closeProjectDb?.(projectDir); } catch { /* ignore */ }

    await new Promise((r) => setTimeout(r, 150));

    if (!fs.existsSync(projectDir)) {
      // Already gone, just clean up state
      const state = readState();
      if (state.currentProject === name) {
        state.currentProject = null;
      }
      if (state.projectStatuses && typeof state.projectStatuses === 'object') {
        delete state.projectStatuses[name];
      }
      writeState(state);
      return { ok: true };
    }

    // STRATEGY A: Try to rename (quarantine) first to free the name immediately
    let tombstonePath = null;
    let renameSucceeded = false;

    // Try up to 3 times to rename (with aggressive permission fixes)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (fs.existsSync(projectDir) && path.dirname(projectDir) === root) {
          // Aggressive prep: make writable + wait
          try {
            makeWritableRecursiveSync(projectDir);
          } catch {
            // ignore
          }

          if (attempt > 0) {
            sleepSync(80 * attempt); // Brief delay for filesystem to settle
          }

          tombstonePath = quarantineProjectDirSync(root, name);

          // Verify rename actually succeeded
          if (!fs.existsSync(projectDir) && fs.existsSync(tombstonePath)) {
            renameSucceeded = true;
            break;
          } else {
            // Rename returned but didn't work? Roll back if needed
            if (fs.existsSync(tombstonePath) && fs.existsSync(projectDir)) {
              try {
                safeRmSync(tombstonePath);
              } catch {
                // ignore
              }
            }
            tombstonePath = null;
          }
        }
      } catch {
        // Retry on next iteration
        tombstonePath = null;
      }
    }

    // STRATEGY B: If rename failed, try direct deletion + verify it's gone
    if (!renameSucceeded) {
      // Make writable before delete
      try {
        makeWritableRecursiveSync(projectDir);
      } catch {
        // ignore
      }

      // Try recycle bin first (often works better than fs.rmSync on Windows)
      try {
        await shell.trashItem(projectDir);
        if (!fs.existsSync(projectDir)) {
          // Success! Original name is now free.
          const state = readState();
          if (state.currentProject === name) {
            state.currentProject = null;
          }
          if (state.projectStatuses && typeof state.projectStatuses === 'object') {
            delete state.projectStatuses[name];
          }
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore, try hard delete
      }

      // Try hard delete
      try {
        safeRmSync(projectDir);
        // Wait a bit and verify
        sleepSync(100);
        if (!fs.existsSync(projectDir)) {
          // Success! Original name is now free.
          const state = readState();
          if (state.currentProject === name) {
            state.currentProject = null;
          }
          if (state.projectStatuses && typeof state.projectStatuses === 'object') {
            delete state.projectStatuses[name];
          }
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore
      }

      // Both rename and delete failed => cannot proceed safely
      throw new Error(`无法删除项目文件夹：${name}。\n\n可能原因：\n1. 文件夹被其他程序占用\n2. 权限不足\n3. Windows资源管理器正在访问该文件夹\n\n建议：\n- 关闭可能访问该文件夹的程序\n- 或重启应用后重试`);
    }

    // Rename succeeded! Now the original name is FREE.
    // Delete the tombstone in background (don't block user).

    // Best-effort: attempt immediate delete of tombstone (prefer recycle bin)
    try {
      await trashOrRm(tombstonePath);
    } catch {
      try {
        safeRmSync(tombstonePath);
      } catch {
        // ignore; will retry in background
      }
    }

    // If tombstone still exists, enqueue for background deletion
    if (fs.existsSync(tombstonePath)) {
      try {
        enqueueDeleteDir(tombstonePath);
      } catch {
        // ignore
      }
    }

    // CRITICAL: Double-check that original name is truly free (Windows edge case: may recreate empty stub)
    if (fs.existsSync(projectDir)) {
      try {
        makeWritableRecursiveSync(projectDir);
        if (isEmptyDirSync(projectDir)) {
          // Remove empty ghost folder immediately
          safeRmSync(projectDir);
          if (fs.existsSync(projectDir)) {
            // Still there? Quarantine it again
            try {
              const ghost = quarantineProjectDirSync(root, name);
              enqueueDeleteDir(ghost);
            } catch {
              enqueueDeleteDir(projectDir);
            }
          }
        } else {
          // Non-empty ghost? Quarantine (should never happen, but failsafe)
          try {
            const ghost = quarantineProjectDirSync(root, name);
            enqueueDeleteDir(ghost);
          } catch {
            enqueueDeleteDir(projectDir);
          }
        }
      } catch {
        // Best effort
        try {
          enqueueDeleteDir(projectDir);
        } catch {
          // ignore
        }
      }
    }

    // Clean up app state
    const state = readState();
    if (state.currentProject === name) {
      state.currentProject = null;
    }
    if (state.projectStatuses && typeof state.projectStatuses === 'object') {
      delete state.projectStatuses[name];
    }
    writeState(state);
    return { ok: true };
  });

  // ===== F1: Attached import (external folder) =====
  //
  // 在 projects/ 根下创建附属壳目录，写 meta/external-link.json 指向外部根，
  // 调用 syncStructureFromExternal 首次扫描。不复制外部文件。
  ipcMain.handle('projects/importAttached', async (_evt, payload) => {
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

    const root = getProjectsRoot();
    fs.mkdirSync(root, { recursive: true });

    // 防止把数据存储区内部的文件夹错误地"附属导入"
    const rootResolved = path.resolve(root);
    if (path.resolve(externalRoot) === rootResolved
      || path.resolve(externalRoot).startsWith(rootResolved + path.sep)) {
      throw new Error('不能将数据存储区内部的目录作为外部文件夹导入');
    }

    // 候选壳名 = 外部目录最后一级；非法字符替换；与现有项目同名时自动加后缀
    const baseName = sanitizeFileName(path.basename(externalRoot)) || 'imported';
    const { name: shellName, fullPath: shellDir } = ensureUniqueDirPath(root, baseName);

    // 创建壳（使用 blank 模板：仅系统目录）
    ensureProjectStructure(shellName, 'projects', { template: 'blank' });

    // 写 external-link.json
    writeExternalLink(shellDir, {
      rootPath: externalRoot,
      importedAt: new Date().toISOString(),
      lastScanAt: '',
      lastScanStatus: '',
      broken: false,
      brokenReason: '',
    });

    // 首次扫描：构造 structure.json（外部根条目）
    let scanError = null;
    try {
      syncStructureFromExternal(shellDir, shellName);
    } catch (e) {
      scanError = e?.message || String(e);
    }

    // 设为 active 并切换 currentProject
    const state = readState();
    state.projectStatuses = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    state.projectStatuses[shellName] = normalizeProjectStatus(state.projectStatuses[shellName] || 'active');
    state.currentProject = shellName;
    writeState(state);

    return {
      ok: true,
      name: shellName,
      path: shellDir,
      externalRootPath: externalRoot,
      scanError,
    };
  });

  // 重新定位（外部根路径变更）
  ipcMain.handle('projects/relocateAttached', async (_evt, payload) => {
    if (!dialog) throw new Error('dialog 不可用');
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projectDir = path.join(getProjectsRoot(), name);
    if (!fs.existsSync(projectDir)) throw new Error(`项目不存在：${name}`);
    if (typeof isAttachedProject !== 'function' || !isAttachedProject(projectDir)) {
      throw new Error('该项目不是外部导入项目（附属壳）');
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

  // 手动刷新外部目录扫描
  ipcMain.handle('projects/refreshAttached', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projectDir = path.join(getProjectsRoot(), name);
    if (!fs.existsSync(projectDir)) throw new Error(`项目不存在：${name}`);
    if (typeof isAttachedProject !== 'function' || !isAttachedProject(projectDir)) {
      throw new Error('该项目不是外部导入项目（附属壳）');
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


