import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { listEvents } from '../db/events.js';

export function createListClassifyEventsTool(projectDir) {
  return tool(
    async ({ eventType, search, limit }) => {
      const db = getProjectDb(projectDir);
      const lim = Math.min(30, Math.max(1, limit || 15));

      const result = listEvents(db, {
        eventType: eventType || undefined,
        search: search || undefined,
        limit: lim,
      });

      if (!result.events.length) return '没有找到匹配的分类事件。';

      const formatted = result.events.map((e) => ({
        id: e.id,
        time: e.ts,
        event: e.event,
        fileName: e.fileName,
        ext: e.ext,
        suggestedFolder: e.suggestedFolder,
        actualFolder: e.actualFolder || undefined,
        userFeedback: e.userFeedback || undefined,
        confidence: e.confidence,
      }));

      return JSON.stringify({ total: result.total, showing: formatted.length, events: formatted }, null, 2);
    },
    {
      name: 'list_classify_events',
      description: `Query classification events (accepted / rejected decisions). Use this to:
- See which files were rejected and why
- Find events that lack user feedback
- Understand classification patterns over time
Tip: use eventType='classify.rejected' to find all rejections, then check userFeedback field.`,
      schema: z.object({
        eventType: z.string().optional().default('').describe("Filter: 'classify.accepted', 'classify.rejected', or empty for all"),
        search: z.string().optional().default('').describe('Search keyword in file name, folder, or feedback'),
        limit: z.number().optional().default(15).describe('Max results (1-30)'),
      }),
    },
  );
}
