import fs from 'node:fs';
import path from 'node:path';

export function registerCasesIpc({
  ipcMain,
  shell,
  readState,
  writeState,
  getCasesRoot,
  sanitizeProjectName,
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
  getWorkspaceDirOrThrow,
  sleepSync,
  trashOrRm,
  closeProjectDb,
}) {
  if (!ipcMain) throw new Error('registerCasesIpc: ipcMain is required');

  // ===== Cases (案件) =====
  ipcMain.handle('cases/list', async () => {
    const root = getCasesRoot();
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

    const created = ensureProjectStructure(name, 'cases');
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
}


