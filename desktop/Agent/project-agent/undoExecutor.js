import fs from 'node:fs';
import path from 'node:path';
import { markUndone } from '../db/activityLog.js';

export function undoAction(projectDir, logEntry, db) {
  const { event, data, undoData, id } = logEntry;

  switch (event) {
    case 'agent.move_file':
      return undoMoveFile(projectDir, data, undoData, db, id);
    case 'agent.rename_file':
      return undoRenameFile(projectDir, data, undoData, db, id);
    case 'agent.create_folder':
      return undoCreateFolder(projectDir, data, undoData, db, id);
    case 'agent.update_description':
      return undoUpdateDescription(projectDir, data, undoData, db, id);
    default:
      return { ok: false, error: `不支持撤销的操作类型: ${event}` };
  }
}

function undoMoveFile(projectDir, data, undoData, db, logId) {
  const from = undoData?.from || data?.from;
  const to = undoData?.to || data?.to;
  if (!from || !to) return { ok: false, error: '缺少移动路径信息' };

  const srcAbs = path.join(projectDir, to);
  const destAbs = path.join(projectDir, from);

  if (!fs.existsSync(srcAbs)) return { ok: false, error: `文件不存在: ${to}` };
  if (fs.existsSync(destAbs)) return { ok: false, error: `原位置已有文件: ${from}` };

  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  fs.renameSync(srcAbs, destAbs);
  markUndone(db, logId);
  return { ok: true, message: `已撤销移动：${to} → ${from}` };
}

function undoRenameFile(projectDir, data, undoData, db, logId) {
  const resultPath = undoData?.resultPath;
  const originalPath = undoData?.originalPath || data?.target;
  if (!resultPath || !originalPath) return { ok: false, error: '缺少重命名路径信息' };

  const srcAbs = path.join(projectDir, resultPath);
  const destAbs = path.join(projectDir, originalPath);

  if (!fs.existsSync(srcAbs)) return { ok: false, error: `文件不存在: ${resultPath}` };
  if (fs.existsSync(destAbs)) return { ok: false, error: `原文件名已被占用: ${originalPath}` };

  fs.renameSync(srcAbs, destAbs);
  markUndone(db, logId);
  return { ok: true, message: `已撤销重命名：${path.basename(resultPath)} → ${path.basename(originalPath)}` };
}

function undoCreateFolder(projectDir, data, undoData, db, logId) {
  const folderPath = undoData?.path || data?.path;
  if (!folderPath) return { ok: false, error: '缺少文件夹路径信息' };

  const absPath = path.join(projectDir, folderPath);
  if (!fs.existsSync(absPath)) {
    markUndone(db, logId);
    return { ok: true, message: `文件夹已不存在: ${folderPath}` };
  }

  const entries = fs.readdirSync(absPath);
  if (entries.length > 0) return { ok: false, error: `文件夹非空，无法撤销: ${folderPath}` };

  fs.rmdirSync(absPath);

  try {
    const structurePath = path.join(projectDir, 'meta', 'structure.json');
    const doc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
    const key = folderPath.replace(/\\/g, '/');
    if (doc.folders?.[key]) {
      delete doc.folders[key];
      fs.writeFileSync(structurePath, JSON.stringify(doc, null, 2), 'utf-8');
    }
  } catch { /* ignore structure cleanup errors */ }

  markUndone(db, logId);
  return { ok: true, message: `已撤销创建文件夹: ${folderPath}` };
}

function undoUpdateDescription(projectDir, data, undoData, db, logId) {
  const folder = undoData?.folder || data?.folder;
  const oldDescription = undoData?.oldDescription;
  if (!folder || oldDescription === undefined) return { ok: false, error: '缺少描述恢复信息' };

  const structurePath = path.join(projectDir, 'meta', 'structure.json');
  try {
    const doc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
    const key = folder.replace(/\\/g, '/');
    if (doc.folders?.[key]) {
      doc.folders[key].description = oldDescription === '(无描述)' ? '' : oldDescription;
      doc.folders[key].updatedAt = new Date().toISOString();
      fs.writeFileSync(structurePath, JSON.stringify(doc, null, 2), 'utf-8');
    }
  } catch (e) {
    return { ok: false, error: `恢复描述失败: ${e.message}` };
  }

  markUndone(db, logId);
  return { ok: true, message: `已恢复「${folder}」的描述` };
}
