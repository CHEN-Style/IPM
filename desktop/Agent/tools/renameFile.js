import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { appendLog } from '../db/activityLog.js';

export function createRenameFileTool(projectDir, ctx = {}) {
  return tool(
    async ({ filePath, newName }) => {
      const srcAbs = path.join(projectDir, filePath);
      if (!fs.existsSync(srcAbs)) {
        return JSON.stringify({ error: `File "${filePath}" not found.` });
      }
      if (!fs.statSync(srcAbs).isFile()) {
        return JSON.stringify({ error: `"${filePath}" is not a file.` });
      }

      const dir = path.dirname(filePath);
      const destRel = dir === '.' ? newName : `${dir}/${newName}`;
      const destAbs = path.join(projectDir, destRel);

      if (fs.existsSync(destAbs)) {
        return JSON.stringify({ error: `A file named "${newName}" already exists in "${dir}".` });
      }

      const plan = {
        planId: randomUUID(),
        type: 'rename_file',
        description: `重命名「${path.basename(filePath)}」为「${newName}」`,
        operations: [
          { action: 'rename', target: filePath, newName, resultPath: destRel },
        ],
        requiresConfirmation: true,
      };

      const decision = interrupt(plan);

      if (decision?.cancelled) return '用户取消了重命名操作。';

      try {
        fs.renameSync(srcAbs, destAbs);
        let logId = null;
        try {
          logId = appendLog(getProjectDb(projectDir), 'agent.rename_file', { target: filePath, newName }, {
            sessionId: ctx.sessionId || '',
            undoData: { resultPath: destRel, originalPath: filePath },
          });
        } catch { /* best effort */ }
        const msg = `已将「${path.basename(filePath)}」重命名为「${newName}」。`;
        return logId ? JSON.stringify({ message: msg, _undoId: logId }) : msg;
      } catch (e) {
        return `重命名失败：${e.message}`;
      }
    },
    {
      name: 'rename_file',
      description: 'Rename a file. Will pause for user confirmation before executing.',
      schema: z.object({
        filePath: z.string().min(1).describe('Relative path of the file to rename'),
        newName: z.string().min(1).describe('New file name including extension'),
      }),
    },
  );
}
