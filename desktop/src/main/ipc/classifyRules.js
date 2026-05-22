import {
  readClassifyRules,
  addRule,
  updateRule,
  deleteRule,
  reorderRules,
} from '../../../Agent/storage/classifyRules.js';

export function registerClassifyRulesIpc({ ipcMain, getWorkspaceDirOrThrow, isAttachedProject }) {
  if (!ipcMain) throw new Error('registerClassifyRulesIpc: ipcMain is required');

  // F1: 附属壳（外部导入项目）禁用硬规则。外部目录结构不稳定，规则易失效。
  const guardAttached = (projectDir) => {
    if (typeof isAttachedProject === 'function' && isAttachedProject(projectDir)) {
      throw new Error('外部导入项目不支持硬规则（仅 LLM 推理 + 描述）');
    }
  };

  ipcMain.handle('classifyRules/list', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    // list 允许（返回空数组），便于 UI 展示统一逻辑
    const rules = readClassifyRules(projectDir);
    return { ok: true, rules };
  });

  ipcMain.handle('classifyRules/add', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    guardAttached(projectDir);
    const rule = payload?.rule;
    if (!rule || !rule.targetFolder) throw new Error('rule.targetFolder 不能为空');
    const created = addRule(projectDir, rule);
    return { ok: true, rule: created };
  });

  ipcMain.handle('classifyRules/update', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    guardAttached(projectDir);
    const ruleId = String(payload?.ruleId || '');
    if (!ruleId) throw new Error('ruleId 不能为空');
    const patch = payload?.patch || {};
    const updated = updateRule(projectDir, ruleId, patch);
    if (!updated) throw new Error('规则不存在');
    return { ok: true, rule: updated };
  });

  ipcMain.handle('classifyRules/delete', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    // 删除允许（清理历史遗留数据），但 reorder 守卫，避免对附属壳的"无意义"操作。
    const ruleId = String(payload?.ruleId || '');
    if (!ruleId) throw new Error('ruleId 不能为空');
    const deleted = deleteRule(projectDir, ruleId);
    if (!deleted) throw new Error('规则不存在');
    return { ok: true };
  });

  ipcMain.handle('classifyRules/reorder', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    guardAttached(projectDir);
    const ruleIds = Array.isArray(payload?.ruleIds) ? payload.ruleIds : [];
    if (!ruleIds.length) throw new Error('ruleIds 不能为空');
    const rules = reorderRules(projectDir, ruleIds);
    return { ok: true, rules };
  });
}
