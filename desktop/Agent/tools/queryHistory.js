import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';

export function createQueryHistoryTool(projectDir, projectName) {
  return tool(
    async ({ status, keyword }) => {
      const db = getProjectDb(projectDir);

      const conditions = [];
      const params = {};

      if (status) {
        const eventType = status === 'accepted' ? 'classify.accepted' : status === 'rejected' ? 'classify.rejected' : '';
        if (eventType) {
          conditions.push('event = @eventType');
          params.eventType = eventType;
        }
      }

      if (keyword) {
        conditions.push(`(
          file_name LIKE @kw COLLATE NOCASE
          OR suggested_folder LIKE @kw COLLATE NOCASE
          OR actual_folder LIKE @kw COLLATE NOCASE
          OR user_feedback LIKE @kw COLLATE NOCASE
        )`);
        params.kw = `%${keyword}%`;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC LIMIT 30`).all(params);

      if (!rows.length) return 'No matching classification history found.';

      const summary = rows.map((r) => {
        const entry = {
          fileName: r.file_name || '',
          ext: r.ext || '',
          event: r.event === 'classify.accepted' ? 'accepted' : r.event === 'classify.rejected' ? 'rejected' : r.event,
          suggestedFolder: r.suggested_folder || '',
          rationale: r.rationale || '',
          time: r.ts || '',
        };
        if (r.actual_folder) entry.actualFolder = r.actual_folder;
        if (r.user_feedback) entry.userFeedback = r.user_feedback;
        if (r.source_dir) entry.sourceDir = r.source_dir;
        return entry;
      });

      return JSON.stringify(summary, null, 2);
    },
    {
      name: 'query_history',
      description:
        'Query past classification events (user accepted/rejected decisions) for this project. Each record represents a real user decision. When results include "userFeedback", the user explicitly explained why a classification was wrong — this is the most valuable learning signal. NEVER repeat a mistake the user already explained.',
      schema: z.object({
        status: z
          .enum(['accepted', 'rejected', ''])
          .optional()
          .default('')
          .describe('Filter by decision type. Empty string returns all.'),
        keyword: z
          .string()
          .optional()
          .default('')
          .describe('Optional keyword to filter by fileName, folder, or userFeedback content.'),
      }),
    },
  );
}
