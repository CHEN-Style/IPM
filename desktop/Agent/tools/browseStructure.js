import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function countFiles(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

export function createBrowseStructureTool(projectDir) {
  return tool(
    async () => {
      const structurePath = path.join(projectDir, 'meta', 'structure.json');
      const doc = safeReadJson(structurePath, null);
      const folders =
        doc && typeof doc === 'object' && doc.folders && typeof doc.folders === 'object'
          ? doc.folders
          : {};

      const candidates = Object.values(folders)
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          relPath: String(f.relPath || ''),
          name: String(f.name || ''),
          description: typeof f.description === 'string' ? f.description : '',
          system: Boolean(f.system),
        }))
        .filter((f) => f.relPath && f.name && !f.system)
        .sort((a, b) => a.relPath.length - b.relPath.length)
        .map((f) => ({
          relPath: f.relPath,
          name: f.name,
          description: f.description,
          fileCount: countFiles(path.join(projectDir, f.relPath)),
        }));

      if (!candidates.length) return 'No folder candidates found in structure.json.';
      return JSON.stringify(candidates, null, 2);
    },
    {
      name: 'browse_structure',
      description:
        'List all available target folders for this project, including folder name, description, and current file count. Use this to understand the project structure before making a classification decision.',
      schema: z.object({}),
    },
  );
}
