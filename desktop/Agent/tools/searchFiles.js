import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const SYSTEM_DIRS = new Set(['meta', 'snippets']);
const MAX_RESULTS = 50;

function searchRecursive(dirPath, relBase, query, ext, results) {
  if (results.length >= MAX_RESULTS) return;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const ent of entries) {
    if (results.length >= MAX_RESULTS) return;
    if (ent.name.startsWith('.')) continue;
    if (relBase === '' && SYSTEM_DIRS.has(ent.name)) continue;

    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;

    if (ent.isFile()) {
      const nameMatch = !query || ent.name.toLowerCase().includes(query.toLowerCase());
      const extMatch = !ext || ent.name.toLowerCase().endsWith(`.${ext.toLowerCase()}`);
      if (nameMatch && extMatch) {
        let size = 0;
        try { size = fs.statSync(path.join(dirPath, ent.name)).size; } catch { /* skip */ }
        results.push({ path: rel, name: ent.name, sizeMB: Math.round(size / 1024 / 1024 * 100) / 100 });
      }
    } else if (ent.isDirectory()) {
      searchRecursive(path.join(dirPath, ent.name), rel, query, ext, results);
    }
  }
}

export function createSearchFilesTool(projectDir) {
  return tool(
    async ({ query, extension }) => {
      const results = [];
      searchRecursive(projectDir, '', query || '', extension || '', results);

      if (!results.length) return `No files found matching query="${query || ''}" ext="${extension || ''}".`;
      return JSON.stringify({
        matchCount: results.length,
        truncated: results.length >= MAX_RESULTS,
        files: results,
      }, null, 2);
    },
    {
      name: 'search_files',
      description: 'Search for files in the project by name keyword and/or extension. Returns matching file paths and sizes.',
      schema: z.object({
        query: z.string().optional().default('').describe('Keyword to search in file names (case-insensitive). Empty matches all.'),
        extension: z.string().optional().default('').describe('Filter by file extension without dot (e.g. "pdf", "docx"). Empty matches all.'),
      }),
    },
  );
}
