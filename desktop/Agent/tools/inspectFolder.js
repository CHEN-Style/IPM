import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function createInspectFolderTool(projectDir) {
  return tool(
    async ({ folderRelPath }) => {
      const absPath = path.join(projectDir, folderRelPath);
      if (!fs.existsSync(absPath)) return `Folder "${folderRelPath}" does not exist.`;

      let stat;
      try {
        stat = fs.statSync(absPath);
      } catch {
        return `Cannot read "${folderRelPath}".`;
      }
      if (!stat.isDirectory()) return `"${folderRelPath}" is not a directory.`;

      let entries;
      try {
        entries = fs.readdirSync(absPath, { withFileTypes: true });
      } catch {
        return `Cannot list contents of "${folderRelPath}".`;
      }

      const files = entries
        .filter((e) => e.isFile())
        .map((e) => {
          let mtime = '';
          try {
            mtime = fs.statSync(path.join(absPath, e.name)).mtime.toISOString();
          } catch {
            /* ignore */
          }
          return { name: e.name, modifiedAt: mtime };
        })
        .sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));

      if (!files.length) return `Folder "${folderRelPath}" is empty (no files).`;

      const top = files.slice(0, 50);
      const result = {
        folderRelPath,
        totalFiles: files.length,
        showing: top.length,
        files: top,
      };
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'inspect_folder',
      description:
        'List files inside a specific project folder (name + last modified time). Use this to see what files already exist in a candidate target folder, helping decide if the new file belongs there.',
      schema: z.object({
        folderRelPath: z
          .string()
          .min(1)
          .describe('Relative path of the folder to inspect (e.g. "收到资料").'),
      }),
    },
  );
}
