import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listAiSuggestions } from '../storage/aiStorage.js';

export function createQueryHistoryTool(projectDir, projectName) {
  return tool(
    async ({ status, keyword }) => {
      const statusFilter = status || '';
      const items = listAiSuggestions(projectDir, projectName, { status: statusFilter });

      let filtered = items;
      if (keyword) {
        const kw = keyword.toLowerCase();
        filtered = items.filter((s) => {
          const fn = String(s.fileName || '').toLowerCase();
          const ext = String(s.ext || '').toLowerCase();
          const folder = String(s.suggestedFolderRelPath || '').toLowerCase();
          return fn.includes(kw) || ext.includes(kw) || folder.includes(kw);
        });
      }

      const recent = filtered.slice(0, 30);

      if (!recent.length) return 'No matching classification history found.';

      const summary = recent.map((s) => ({
        fileName: s.fileName || '',
        ext: s.ext || '',
        suggestedFolder: s.suggestedFolderRelPath || '',
        status: s.status || '',
        rationale: s.rationale || '',
      }));
      return JSON.stringify(summary, null, 2);
    },
    {
      name: 'query_history',
      description:
        'Query past classification decisions (accepted/rejected/pending) for this project. Use this to learn from previous user decisions on similar files.',
      schema: z.object({
        status: z
          .enum(['accepted', 'rejected', 'pending', ''])
          .optional()
          .default('')
          .describe('Filter by status. Empty string returns all.'),
        keyword: z
          .string()
          .optional()
          .default('')
          .describe('Optional keyword to filter by fileName, ext, or folder.'),
      }),
    },
  );
}
