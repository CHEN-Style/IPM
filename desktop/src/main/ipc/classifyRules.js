import {
  readClassifyRules,
  addRule,
  updateRule,
  deleteRule,
  reorderRules,
} from '../../../Agent/storage/classifyRules.js';

export function registerClassifyRulesIpc({ ipcMain, getWorkspaceDirOrThrow }) {
  if (!ipcMain) throw new Error('registerClassifyRulesIpc: ipcMain is required');

  ipcMain.handle('classifyRules/list', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const rules = readClassifyRules(projectDir);
    return { ok: true, rules };
  });

  ipcMain.handle('classifyRules/add', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const rule = payload?.rule;
    if (!rule || !rule.targetFolder) throw new Error('rule.targetFolder 不能为空');
    const created = addRule(projectDir, rule);
    return { ok: true, rule: created };
  });

  ipcMain.handle('classifyRules/update', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const ruleId = String(payload?.ruleId || '');
    if (!ruleId) throw new Error('ruleId 不能为空');
    const patch = payload?.patch || {};
    const updated = updateRule(projectDir, ruleId, patch);
    if (!updated) throw new Error('规则不存在');
    return { ok: true, rule: updated };
  });

  ipcMain.handle('classifyRules/delete', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const ruleId = String(payload?.ruleId || '');
    if (!ruleId) throw new Error('ruleId 不能为空');
    const deleted = deleteRule(projectDir, ruleId);
    if (!deleted) throw new Error('规则不存在');
    return { ok: true };
  });

  ipcMain.handle('classifyRules/reorder', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const ruleIds = Array.isArray(payload?.ruleIds) ? payload.ruleIds : [];
    if (!ruleIds.length) throw new Error('ruleIds 不能为空');
    const rules = reorderRules(projectDir, ruleIds);
    return { ok: true, rules };
  });
}
