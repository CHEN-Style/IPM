import fs from 'node:fs';
import path from 'node:path';
import { getProjectDb } from '../db/index.js';
import { appendLog } from '../db/activityLog.js';

/**
 * Execute a confirmed action plan.
 * @param {string} projectDir
 * @param {string} projectName
 * @param {object} plan - The plan object with operations array
 * @param {string[]} selectedIds - Indices of confirmed operations (if empty, execute all)
 * @param {object} deps - Injected dependencies { syncStructureJson }
 */
export async function executePlan(projectDir, projectName, plan, selectedIds, deps = {}) {
  const { syncStructureJson } = deps;
  const ops = plan.operations || [];
  const selected = selectedIds?.length
    ? ops.filter((_, i) => selectedIds.includes(i))
    : ops;

  const results = [];
  let structureChanged = false;

  for (const op of selected) {
    try {
      switch (op.action) {
        case 'move':
          executeMove(projectDir, op);
          structureChanged = true;
          results.push({ action: 'move', from: op.from, to: op.to, success: true });
          logOp(projectDir, 'agent.move_file', { from: op.from, to: op.to });
          break;

        case 'rename':
          executeRename(projectDir, op);
          results.push({ action: 'rename', target: op.target, newName: op.newName, success: true });
          logOp(projectDir, 'agent.rename_file', { target: op.target, newName: op.newName });
          break;

        case 'create_folder':
          executeCreateFolder(projectDir, op);
          structureChanged = true;
          results.push({ action: 'create_folder', path: op.path, success: true });
          logOp(projectDir, 'agent.create_folder', { path: op.path, description: op.description });
          break;

        case 'update_description':
          executeUpdateDescription(projectDir, op);
          results.push({ action: 'update_description', folder: op.folder, success: true });
          logOp(projectDir, 'agent.update_description', { folder: op.folder });
          break;

        default:
          results.push({ action: op.action, success: false, error: `Unknown action: ${op.action}` });
      }
    } catch (e) {
      results.push({
        action: op.action,
        from: op.from || op.target || op.path || op.folder,
        success: false,
        error: e.message,
      });
    }
  }

  if (structureChanged && typeof syncStructureJson === 'function') {
    try { syncStructureJson(projectDir, projectName); } catch { /* best effort */ }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { total: results.length, succeeded, failed, details: results };
}

function executeMove(projectDir, op) {
  const srcAbs = path.join(projectDir, op.from);
  const destAbs = path.join(projectDir, op.to);

  if (!fs.existsSync(srcAbs)) throw new Error(`Source not found: ${op.from}`);

  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  if (fs.existsSync(destAbs)) throw new Error(`Destination already exists: ${op.to}`);

  fs.renameSync(srcAbs, destAbs);
}

function executeRename(projectDir, op) {
  const srcAbs = path.join(projectDir, op.target);
  if (!fs.existsSync(srcAbs)) throw new Error(`File not found: ${op.target}`);

  const dir = path.dirname(op.target);
  const destRel = op.resultPath || (dir === '.' ? op.newName : `${dir}/${op.newName}`);
  const destAbs = path.join(projectDir, destRel);

  if (fs.existsSync(destAbs)) throw new Error(`"${op.newName}" already exists`);

  fs.renameSync(srcAbs, destAbs);
}

function executeCreateFolder(projectDir, op) {
  const absPath = path.join(projectDir, op.path);
  if (fs.existsSync(absPath)) throw new Error(`Folder already exists: ${op.path}`);

  fs.mkdirSync(absPath, { recursive: true });

  if (op.description) {
    setFolderDescription(projectDir, op.path, op.description);
  }
}

function executeUpdateDescription(projectDir, op) {
  setFolderDescription(projectDir, op.folder, op.description);
}

function setFolderDescription(projectDir, folderRel, description) {
  const structurePath = path.join(projectDir, 'meta', 'structure.json');
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
  } catch {
    return;
  }

  const normalizedRel = folderRel.replace(/\\/g, '/');
  if (doc?.folders?.[normalizedRel]) {
    doc.folders[normalizedRel].description = description;
    doc.folders[normalizedRel].updatedAt = new Date().toISOString();
    fs.writeFileSync(structurePath, JSON.stringify(doc, null, 2), 'utf-8');
  }
}

function logOp(projectDir, event, data) {
  try {
    const db = getProjectDb(projectDir);
    appendLog(db, event, data);
  } catch { /* best effort */ }
}
