import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { appendLog } from '../db/activityLog.js';

export function createMoveFilesTool(projectDir, ctx = {}) {
  return tool(
    async ({ files, targetFolder }) => {
      const targetAbs = path.join(projectDir, targetFolder);
      if (!fs.existsSync(targetAbs) || !fs.statSync(targetAbs).isDirectory()) {
        return JSON.stringify({ error: `Target folder "${targetFolder}" does not exist.` });
      }

      const operations = [];
      const errors = [];

      for (const filePath of files) {
        const srcAbs = path.join(projectDir, filePath);
        if (!fs.existsSync(srcAbs)) {
          errors.push(`File "${filePath}" not found.`);
          continue;
        }
        if (!fs.statSync(srcAbs).isFile()) {
          errors.push(`"${filePath}" is not a file.`);
          continue;
        }
        const fileName = path.basename(filePath);
        const destRel = `${targetFolder}/${fileName}`;
        const destAbs = path.join(projectDir, destRel);
        if (fs.existsSync(destAbs)) {
          errors.push(`"${fileName}" already exists in "${targetFolder}".`);
          continue;
        }
        operations.push({ action: 'move', from: filePath, to: destRel });
      }

      if (!operations.length && errors.length) {
        return JSON.stringify({ error: 'No valid move operations.', details: errors });
      }

      const plan = {
        planId: randomUUID(),
        type: 'move_files',
        description: `移动 ${operations.length} 个文件到「${targetFolder}」`,
        operations,
        requiresConfirmation: true,
      };
      if (errors.length) plan.warnings = errors;

      const decision = interrupt(plan);

      if (decision?.cancelled) return '用户取消了移动操作。';

      const selected = decision?.selectedIds?.length
        ? operations.filter((_, i) => decision.selectedIds.includes(i))
        : operations;

      let succeeded = 0;
      let failed = 0;
      let lastLogId = null;
      for (const op of selected) {
        try {
          const srcAbs = path.join(projectDir, op.from);
          const destAbs = path.join(projectDir, op.to);
          const destDir = path.dirname(destAbs);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          if (!fs.existsSync(srcAbs)) throw new Error(`Source not found: ${op.from}`);
          if (fs.existsSync(destAbs)) throw new Error(`Destination exists: ${op.to}`);
          fs.renameSync(srcAbs, destAbs);
          succeeded++;
          try {
            lastLogId = appendLog(getProjectDb(projectDir), 'agent.move_file', { from: op.from, to: op.to }, {
              sessionId: ctx.sessionId || '',
              undoData: { from: op.from, to: op.to },
            });
          } catch { /* best effort */ }
        } catch {
          failed++;
        }
      }

      const msg = `移动完成：${succeeded} 个文件成功${failed ? `，${failed} 个失败` : ''}。`;
      return lastLogId ? JSON.stringify({ message: msg, _undoId: lastLogId }) : msg;
    },
    {
      name: 'move_files',
      description: 'Move files to a target folder. Will pause for user confirmation before executing.',
      schema: z.object({
        files: z.array(z.string()).min(1).describe('Array of relative file paths to move'),
        targetFolder: z.string().min(1).describe('Relative path of the target folder'),
      }),
    },
  );
}
