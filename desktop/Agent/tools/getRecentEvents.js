import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { listEvents } from '../db/events.js';
import { listLogs } from '../db/activityLog.js';

export function createGetRecentEventsTool(projectDir) {
  return tool(
    async ({ count, eventType }) => {
      const db = getProjectDb(projectDir);
      const limit = Math.min(50, Math.max(1, count || 20));

      const classifyEvents = listEvents(db, {
        eventType: eventType || undefined,
        limit,
      });

      const activityLogs = listLogs(db, { limit: Math.min(limit, 20) });

      const combined = [];

      for (const e of classifyEvents.events) {
        combined.push({
          type: 'classify',
          time: e.ts,
          event: e.event,
          fileName: e.fileName,
          suggestedFolder: e.suggestedFolder,
          actualFolder: e.actualFolder || undefined,
          userFeedback: e.userFeedback || undefined,
        });
      }

      for (const l of activityLogs) {
        combined.push({
          type: 'activity',
          time: l.ts,
          event: l.event,
          data: l.data,
        });
      }

      combined.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      const result = combined.slice(0, limit);

      if (!result.length) return 'No recent events found.';
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'get_recent_events',
      description: 'Get recent classification events and activity logs for this project. Useful for understanding recent changes and user behavior.',
      schema: z.object({
        count: z.number().optional().default(20).describe('Number of events to return (max 50)'),
        eventType: z.string().optional().default('').describe('Filter classify events by type: classify.accepted, classify.rejected, or empty for all'),
      }),
    },
  );
}
