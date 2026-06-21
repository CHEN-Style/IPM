// F1 (DEPRECATED): 此模块在 F1 阶段被「附属导入」(`projects/importAttached` /
// `cases/importAttached`) 完全取代。前端已不再展示本模块管理的「本地文件夹」分组，
// `useLocalFolders` Hook 中的导入入口现已转走 importAttached。
//
// 本文件保留是为了兼容仍持有 state.localFolders 数组的旧用户：
//   - localFolders/list 仍可返回历史数据，方便用户检视；
//   - localFolders/remove 仍可清理过时记录；
//   - localFolders/import 暂保留但前端不再触发，避免老的快捷键 / 第三方触发崩溃。
//
// 计划在确认所有用户都已迁移后删除。新代码不应依赖这里的 IPC。

import fs from 'node:fs';
import path from 'node:path';

const safeReadJson = (filePath, fallback = null) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
};

const atomicWriteFileSync = (filePath, data, encoding = 'utf-8') => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, data, encoding);
  fs.renameSync(tmpPath, filePath);
};

const normalizeAbsDirPath = (p) => {
  const raw = String(p || '').trim();
  if (!raw) return '';
  const abs = path.resolve(raw);
  if (abs === '/') return abs; // keep POSIX root "/"
  return abs.replace(/\/+$/, ''); // only `/` is a path separator on macOS
};

// macOS preserves case and (on case-sensitive volumes) is case-significant,
// so we only fold case for dedup/comparison on Windows.
const pathKey = (abs) => (process.platform === 'win32' ? abs.toLowerCase() : abs);

const getLocalFolderPathsFromState = (state) => {
  const arr = Array.isArray(state?.localFolders) ? state.localFolders : [];
  const out = [];
  const seen = new Set();
  for (const p of arr) {
    const abs = normalizeAbsDirPath(p);
    if (!abs) continue;
    const key = pathKey(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
};

const setLocalFolderPathsToState = (state, absPaths) => {
  state.localFolders = Array.isArray(absPaths) ? absPaths : [];
  return state;
};

const getFolderDisplayName = (absPath) => {
  const abs = String(absPath || '');
  if (abs === '/') return '/'; // POSIX root
  const base = path.basename(abs);
  return base || abs;
};

const statDirExists = (absPath) => {
  try {
    if (!fs.existsSync(absPath)) return { exists: false, reason: 'not_found' };
    const st = fs.statSync(absPath);
    if (!st.isDirectory()) return { exists: false, reason: 'not_directory' };
    return { exists: true, reason: '' };
  } catch {
    return { exists: false, reason: 'stat_failed' };
  }
};

export const registerLocalFoldersIpc = ({ ipcMain, dialog, getStatePath }) => {
  const readState = () => safeReadJson(getStatePath(), {}) || {};
  const writeState = (next) => atomicWriteFileSync(getStatePath(), JSON.stringify(next, null, 2), 'utf-8');

  const listFolders = () => {
    const state = readState();
    const paths = getLocalFolderPathsFromState(state);
    return paths.map((abs) => {
      const st = statDirExists(abs);
      return {
        path: abs,
        name: getFolderDisplayName(abs),
        exists: st.exists,
        reason: st.reason,
      };
    });
  };

  ipcMain.handle('localFolders/list', async () => {
    return { ok: true, folders: listFolders() };
  });

  ipcMain.handle('localFolders/import', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择要导入的本地文件夹',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths?.length) {
      return { ok: true, canceled: true, folders: listFolders() };
    }

    const picked = normalizeAbsDirPath(res.filePaths[0]);
    if (!picked) return { ok: true, canceled: true, folders: listFolders() };
    const st = statDirExists(picked);
    if (!st.exists) {
      // Still allow saving? Spec says if user moved/deleted later we mark red; but at import time we expect it exists.
      throw new Error('所选路径不是有效文件夹（可能已被移动/删除）');
    }

    const state = readState();
    const paths = getLocalFolderPathsFromState(state);
    const key = pathKey(picked);
    if (!paths.some((p) => pathKey(p) === key)) {
      paths.push(picked);
    }
    setLocalFolderPathsToState(state, paths);
    writeState(state);
    return { ok: true, canceled: false, addedPath: picked, folders: listFolders() };
  });

  ipcMain.handle('localFolders/remove', async (_evt, payload) => {
    const abs = normalizeAbsDirPath(payload?.path);
    if (!abs) throw new Error('path 不能为空');
    const state = readState();
    const paths = getLocalFolderPathsFromState(state).filter((p) => pathKey(p) !== pathKey(abs));
    setLocalFolderPathsToState(state, paths);
    writeState(state);
    return { ok: true, removedPath: abs, folders: listFolders() };
  });
};

export const _localFoldersInternals = {
  normalizeAbsDirPath,
  getLocalFolderPathsFromState,
  statDirExists,
};












