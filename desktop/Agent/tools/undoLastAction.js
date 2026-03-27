import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getProjectDb } from '../db/index.js';
import { getLogById, getLastUndoableLog } from '../db/activityLog.js';
import { undoAction } from '../project-agent/undoExecutor.js';

const EVENT_LABELS = {
  'agent.move_file': '移动文件',
  'agent.rename_file': '重命名文件',
  'agent.create_folder': '创建文件夹',
  'agent.update_description': '更新文件夹描述',
};

export function createUndoLastActionTool(projectDir) {
  return tool(
    async ({ actionId }) => {
      const db = getProjectDb(projectDir);

      let logEntry;
      if (actionId) {
        logEntry = getLogById(db, Number(actionId));
        if (!logEntry) return JSON.stringify({ error: `找不到操作记录 #${actionId}` });
        if (logEntry.isUndone) return JSON.stringify({ error: `操作 #${actionId} 已被撤销` });
      } else {
        logEntry = getLastUndoableLog(db);
        if (!logEntry) return '没有可撤销的操作。';
      }

      const label = EVENT_LABELS[logEntry.event] || logEntry.event;

      const plan = {
        planId: randomUUID(),
        type: 'undo_action',
        description: `撤销操作：${label}`,
        operations: [{
          action: 'undo',
          originalEvent: logEntry.event,
          originalData: logEntry.data,
          logId: logEntry.id,
        }],
        requiresConfirmation: true,
      };

      const decision = interrupt(plan);

      if (decision?.cancelled) return '用户取消了撤销操作。';

      const result = undoAction(projectDir, logEntry, db);
      if (result.ok) {
        return result.message;
      }
      return `撤销失败：${result.error}`;
    },
    {
      name: 'undo_last_action',
      description: 'Undo the last write operation (move, rename, create folder, update description). Pauses for user confirmation.',
      schema: z.object({
        actionId: z.string().optional().describe('Specific action log ID to undo. If omitted, undoes the most recent action.'),
      }),
    },
  );
}
