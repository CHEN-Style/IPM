import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { appendLog } from '../db/activityLog.js';

export function createUpdateFolderDescriptionTool(projectDir, ctx = {}) {
  return tool(
    async ({ folderPath, description }) => {
      const absPath = path.join(projectDir, folderPath);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        return JSON.stringify({ error: `Folder "${folderPath}" does not exist.` });
      }

      const structurePath = path.join(projectDir, 'meta', 'structure.json');
      let structureDoc;
      try {
        structureDoc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
      } catch {
        return JSON.stringify({ error: 'Cannot read structure.json.' });
      }

      const normalizedPath = folderPath.replace(/\\/g, '/');
      const folder = structureDoc?.folders?.[normalizedPath];
      const currentDesc = folder?.description || '(无描述)';

      const plan = {
        planId: randomUUID(),
        type: 'update_description',
        description: `更新「${folderPath}」的描述`,
        operations: [
          {
            action: 'update_description',
            folder: folderPath,
            oldDescription: currentDesc,
            description,
          },
        ],
        requiresConfirmation: true,
      };

      const decision = interrupt(plan);

      if (decision?.cancelled) return '用户取消了更新描述操作。';

      try {
        if (structureDoc?.folders?.[normalizedPath]) {
          structureDoc.folders[normalizedPath].description = description;
          structureDoc.folders[normalizedPath].updatedAt = new Date().toISOString();
          fs.writeFileSync(structurePath, JSON.stringify(structureDoc, null, 2), 'utf-8');
        }
        let logId = null;
        try {
          logId = appendLog(getProjectDb(projectDir), 'agent.update_description', { folder: folderPath, description }, {
            sessionId: ctx.sessionId || '',
            undoData: { folder: folderPath, oldDescription: currentDesc },
          });
        } catch { /* best effort */ }
        const msg = `已更新「${folderPath}」的描述。`;
        return logId ? JSON.stringify({ message: msg, _undoId: logId }) : msg;
      } catch (e) {
        return `更新描述失败：${e.message}`;
      }
    },
    {
      name: 'update_folder_description',
      description: 'Update a folder description in structure.json. Will pause for user confirmation before executing.',
      schema: z.object({
        folderPath: z.string().min(1).describe('Relative path of the folder'),
        description: z.string().min(1).describe('New description for the folder'),
      }),
    },
  );
}
