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

      const allFolders = Object.values(folders)
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          relPath: String(f.relPath || ''),
          name: String(f.name || ''),
          description: typeof f.description === 'string' ? f.description : '',
          system: Boolean(f.system),
        }))
        .filter((f) => f.relPath && f.name);

      const candidates = allFolders
        .filter((f) => !f.system)
        .sort((a, b) => a.relPath.length - b.relPath.length)
        .map((f) => ({
          relPath: f.relPath,
          name: f.name,
          description: f.description,
          fileCount: countFiles(path.join(projectDir, f.relPath)),
        }));

      const tempDir = path.join(projectDir, 'temp');
      const tempFileCount = countFiles(tempDir);

      const result = { targetFolders: candidates };
      if (tempFileCount > 0) {
        let tempFiles = [];
        try {
          tempFiles = fs.readdirSync(tempDir, { withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .slice(0, 30);
        } catch { /* ignore */ }
        result.pendingInTemp = {
          fileCount: tempFileCount,
          note: 'These files in temp/ are awaiting classification. You can use inspect_folder, search_files, or move_files to help organise them.',
          sampleFiles: tempFiles,
        };
      }

      if (!candidates.length && !tempFileCount) return 'No folder candidates found in structure.json.';
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'browse_structure',
      description:
        'List all available target folders for this project, including folder name, description, and current file count. Use this to understand the project structure before making a classification decision.',
      schema: z.object({}),
    },
  );
}
