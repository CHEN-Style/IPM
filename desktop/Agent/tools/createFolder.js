import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { appendLog } from '../db/activityLog.js';

const SYSTEM_DIRS = new Set(['meta', 'temp', 'snippets']);

export function createCreateFolderTool(projectDir, ctx = {}) {
  return tool(
    async ({ folderPath, description }) => {
      const topLevel = folderPath.split('/')[0];
      if (SYSTEM_DIRS.has(topLevel)) {
        return JSON.stringify({ error: `Cannot create folder inside system directory "${topLevel}".` });
      }

      const absPath = path.join(projectDir, folderPath);
      if (fs.existsSync(absPath)) {
        return JSON.stringify({ error: `Folder "${folderPath}" already exists.` });
      }

      const plan = {
        planId: randomUUID(),
        type: 'create_folder',
        description: `创建文件夹「${folderPath}」${description ? `（${description}）` : ''}`,
        operations: [
          { action: 'create_folder', path: folderPath, description: description || '' },
        ],
        requiresConfirmation: true,
      };

      const decision = interrupt(plan);

      if (decision?.cancelled) return '用户取消了创建文件夹操作。';

      try {
        fs.mkdirSync(absPath, { recursive: true });
        if (description) {
          updateStructureDescription(projectDir, folderPath, description);
        }
        let logId = null;
        try {
          logId = appendLog(getProjectDb(projectDir), 'agent.create_folder', { path: folderPath, description }, {
            sessionId: ctx.sessionId || '',
            undoData: { path: folderPath },
          });
        } catch { /* best effort */ }
        const msg = `已创建文件夹「${folderPath}」${description ? `（描述：${description}）` : ''}。`;
        return logId ? JSON.stringify({ message: msg, _undoId: logId }) : msg;
      } catch (e) {
        return `创建文件夹失败：${e.message}`;
      }
    },
    {
      name: 'create_folder',
      description: 'Create a new folder in the project. Will pause for user confirmation before executing.',
      schema: z.object({
        folderPath: z.string().min(1).describe('Relative path of the new folder'),
        description: z.string().optional().default('').describe('Description of what this folder will contain'),
      }),
    },
  );
}

function updateStructureDescription(projectDir, folderRel, description) {
  const structurePath = path.join(projectDir, 'meta', 'structure.json');
  try {
    const doc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
    const key = folderRel.replace(/\\/g, '/');
    if (!doc.folders) doc.folders = {};
    if (!doc.folders[key]) {
      doc.folders[key] = {
        relPath: key,
        name: key.split('/').pop(),
        description: '',
        createdAt: new Date().toISOString(),
      };
    }
    doc.folders[key].description = description;
    doc.folders[key].updatedAt = new Date().toISOString();
    fs.writeFileSync(structurePath, JSON.stringify(doc, null, 2), 'utf-8');
  } catch { /* ignore */ }
}
