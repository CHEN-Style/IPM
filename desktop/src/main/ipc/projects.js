import fs from 'node:fs';
import path from 'node:path';

export function registerProjectsIpc({
  ipcMain,
  shell,
  readState,
  writeState,
  getProjectsRoot,
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
  getProjectDirOrThrow,
  sleepSync,
  trashOrRm,
  closeProjectDb,
  getAgentSession,
  removeAgentSession,
}) {
  if (!ipcMain) throw new Error('registerProjectsIpc: ipcMain is required');

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
    const proj = ensureProjectStructure(name);
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

  ipcMain.handle('projects/delete', async (_evt, payload) => {
    const { name, projectDir } = getProjectDirOrThrow(payload?.name);
    const root = getProjectsRoot();

    try {
      const session = getAgentSession?.(projectDir);
      if (session) {
        try { await session.endSession(); } catch { /* ignore */ }
        try { removeAgentSession?.(projectDir); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

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
}


