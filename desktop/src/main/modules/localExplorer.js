import fs from 'node:fs';
import path from 'node:path';

const normalizeRelPathPosix = (relPath) => {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
};

const safeReadJson = (filePath, fallback = null) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
};

const normalizeAbsDirPath = (p) => {
  const raw = String(p || '').trim();
  if (!raw) return '';
  const abs = path.resolve(raw);
  const root = path.parse(abs).root;
  if (abs === root) return abs;
  return abs.replace(/[\\/]+$/, '');
};

const resolveInside = (baseDir, unsafeRelPath) => {
  const rel = String(unsafeRelPath ?? '');
  const target = path.resolve(baseDir, rel);
  const base = path.resolve(baseDir);
  if (target === base) return target;
  if (!target.startsWith(base + path.sep)) {
    throw new Error('路径非法');
  }
  return target;
};

const ensureUniqueDestPath = (destDir, fileName) => {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let i = 1;
  while (fs.existsSync(path.join(destDir, candidate))) {
    candidate = `${base} (${i})${ext}`;
    i += 1;
  }
  return path.join(destDir, candidate);
};

const ensureUniqueDirPath = (parentDir, folderName) => {
  let candidate = folderName;
  let i = 1;
  while (fs.existsSync(path.join(parentDir, candidate))) {
    candidate = `${folderName} (${i})`;
    i += 1;
  }
  return { name: candidate, fullPath: path.join(parentDir, candidate) };
};

const confirmAutoSuffix = async (dialog) => {
  const res = await dialog.showMessageBox({
    type: 'question',
    buttons: ['自动添加后缀', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '发现重名',
    message: '目标位置已存在同名文件/文件夹。',
    detail: '是否自动添加一个小后缀来避免重名？',
  });
  return res.response === 0;
};

const trashOrRm = async (shell, targetPath) => {
  try {
    await shell.trashItem(targetPath);
    return;
  } catch {
    // fall back
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const getAllowedRoots = (statePath) => {
  const state = safeReadJson(statePath, {}) || {};
  const arr = Array.isArray(state?.localFolders) ? state.localFolders : [];
  const out = [];
  const seen = new Set();
  for (const p of arr) {
    const abs = normalizeAbsDirPath(p);
    if (!abs) continue;
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
};

const assertRootAllowedOrThrow = (statePath, rootPath) => {
  const rootAbs = normalizeAbsDirPath(rootPath);
  if (!rootAbs) throw new Error('rootPath 不能为空');
  const allowed = getAllowedRoots(statePath);
  if (!allowed.some((p) => p.toLowerCase() === rootAbs.toLowerCase())) {
    throw new Error('该本地文件夹未被导入或已取消关联');
  }
  if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
    throw new Error('该本地文件夹已失效（可能被移动/删除/重命名）');
  }
  return rootAbs;
};

export const registerLocalExplorerIpc = ({ ipcMain, dialog, shell, getStatePath }) => {
  const statePath = () => getStatePath();

  ipcMain.handle('localExplorer/list', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const dir = resolveInside(rootAbs, relPath);
    if (!fs.existsSync(dir)) throw new Error('目录不存在');

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const mapped = entries.map((e) => {
      const fullPath = path.join(dir, e.name);
      const st = fs.statSync(fullPath);
      const kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other';
      return {
        name: e.name,
        kind,
        relPath: path.relative(rootAbs, fullPath).split(path.sep).join('/'),
        sizeBytes: kind === 'file' ? st.size : 0,
        mtimeMs: st.mtimeMs,
      };
    });

    mapped.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    return { ok: true, rootPath: rootAbs, relPath, entries: mapped };
  });

  ipcMain.handle('localExplorer/open', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');
    const target = resolveInside(rootAbs, relPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error('仅支持打开文件（不支持打开文件夹）');
    const errMsg = await shell.openPath(target);
    if (errMsg) throw new Error(`打开失败：${errMsg}`);
    return { ok: true, rootPath: rootAbs, relPath };
  });

  ipcMain.handle('localExplorer/mkdir', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const folderName = String(payload?.folderName ?? '').trim();
    if (!folderName) throw new Error('文件夹名称不能为空');
    const dir = resolveInside(rootAbs, relPath);
    if (!fs.existsSync(dir)) throw new Error('目录不存在');
    const desired = resolveInside(rootAbs, path.join(relPath, folderName));
    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix(dialog);
      if (!ok) return { ok: false, conflict: true };
      const { fullPath, name } = ensureUniqueDirPath(dir, folderName);
      fs.mkdirSync(fullPath, { recursive: true });
      return { ok: true, createdName: name };
    }
    fs.mkdirSync(desired, { recursive: true });
    return { ok: true, createdName: folderName };
  });

  ipcMain.handle('localExplorer/upload', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const destRelPath = normalizeRelPathPosix(payload?.destRelPath ?? '');
    const destDir = resolveInside(rootAbs, destRelPath);
    if (!fs.existsSync(destDir)) throw new Error('目标目录不存在');
    if (!fs.statSync(destDir).isDirectory()) throw new Error('目标不是目录');

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled) return { ok: true, copied: 0 };

    const planned = filePaths.map((srcPath) => ({ srcPath, baseName: path.basename(srcPath) || 'file' }));
    const conflicts = planned
      .map((p) => p.baseName)
      .filter((name, idx, arr) => arr.indexOf(name) !== idx || fs.existsSync(path.join(destDir, name)));
    const uniqConflicts = Array.from(new Set(conflicts));
    if (uniqConflicts.length) {
      const ok = await confirmAutoSuffix(dialog);
      if (!ok) return { ok: false, copied: 0, conflict: true, conflicts: uniqConflicts };
    }

    let copied = 0;
    for (const p of planned) {
      const targetPath = uniqConflicts.length ? ensureUniqueDestPath(destDir, p.baseName) : path.join(destDir, p.baseName);
      fs.copyFileSync(p.srcPath, targetPath);
      copied += 1;
    }
    return { ok: true, copied };
  });

  ipcMain.handle('localExplorer/delete', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const entryRelPath = normalizeRelPathPosix(payload?.relPath ?? '');
    if (!entryRelPath) throw new Error('目标路径不能为空');
    const target = resolveInside(rootAbs, entryRelPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    await trashOrRm(shell, target);
    return { ok: true };
  });

  ipcMain.handle('localExplorer/rename', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const entryRelPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const newNameRaw = String(payload?.newName ?? '').trim();
    if (!entryRelPath) throw new Error('目标路径不能为空');
    if (!newNameRaw) throw new Error('新名称不能为空');
    const target = resolveInside(rootAbs, entryRelPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    const parentDir = path.dirname(target);

    let desired = path.join(parentDir, newNameRaw);
    if (path.resolve(desired) === path.resolve(target)) return { ok: true, renamedTo: path.basename(target) };
    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix(dialog);
      if (!ok) return { ok: false, conflict: true };
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        const { fullPath, name } = ensureUniqueDirPath(parentDir, newNameRaw);
        desired = fullPath;
        fs.renameSync(target, desired);
        return { ok: true, renamedTo: name };
      }
      const unique = ensureUniqueDestPath(parentDir, newNameRaw);
      fs.renameSync(target, unique);
      return { ok: true, renamedTo: path.basename(unique) };
    }
    fs.renameSync(target, desired);
    return { ok: true, renamedTo: path.basename(desired) };
  });

  ipcMain.handle('localExplorer/move', async (_evt, payload) => {
    const rootAbs = assertRootAllowedOrThrow(statePath(), payload?.rootPath);
    const srcRelPath = normalizeRelPathPosix(payload?.srcRelPath ?? '');
    const destDirRelPath = normalizeRelPathPosix(payload?.destDirRelPath ?? '');
    if (!srcRelPath) throw new Error('源路径不能为空');
    const srcPath = resolveInside(rootAbs, srcRelPath);
    if (!fs.existsSync(srcPath)) throw new Error('源目标不存在');
    const destDirPath = resolveInside(rootAbs, destDirRelPath);
    if (!fs.existsSync(destDirPath)) throw new Error('目标目录不存在');
    if (!fs.statSync(destDirPath).isDirectory()) throw new Error('目标不是目录');

    const baseName = path.basename(srcPath);
    let desired = path.join(destDirPath, baseName);
    if (path.resolve(desired) === path.resolve(srcPath)) return { ok: true, movedTo: srcRelPath };

    const st = fs.statSync(srcPath);
    if (st.isDirectory()) {
      const srcAbs = path.resolve(srcPath);
      const destAbs = path.resolve(destDirPath);
      if (destAbs.startsWith(srcAbs + path.sep)) throw new Error('不能将文件夹移动到其自身或子目录中');
    }

    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix(dialog);
      if (!ok) return { ok: false, conflict: true };
      if (st.isDirectory()) {
        const { fullPath, name } = ensureUniqueDirPath(destDirPath, baseName);
        desired = fullPath;
        fs.renameSync(srcPath, desired);
        return { ok: true, movedTo: path.relative(rootAbs, desired).split(path.sep).join('/'), movedName: name };
      }
      const unique = ensureUniqueDestPath(destDirPath, baseName);
      fs.renameSync(srcPath, unique);
      return { ok: true, movedTo: path.relative(rootAbs, unique).split(path.sep).join('/'), movedName: path.basename(unique) };
    }

    fs.renameSync(srcPath, desired);
    return { ok: true, movedTo: path.relative(rootAbs, desired).split(path.sep).join('/'), movedName: baseName };
  });
};











