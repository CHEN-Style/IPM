import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { updateEventFeedback } from '../db/events.js';

export function createAddEventFeedbackTool(projectDir) {
  return tool(
    async ({ eventId, feedback }) => {
      if (!eventId) return JSON.stringify({ error: '缺少 eventId' });
      if (!feedback) return JSON.stringify({ error: '缺少 feedback（反馈内容）' });

      try {
        const db = getProjectDb(projectDir);
        updateEventFeedback(db, eventId, feedback);
        return JSON.stringify({ message: `已为事件 ${eventId.slice(0, 8)}... 添加反馈：「${feedback}」` });
      } catch (e) {
        return JSON.stringify({ error: `添加反馈失败: ${e.message}` });
      }
    },
    {
      name: 'add_event_feedback',
      description: `Add or update user feedback on a classification event (typically a rejected one). 
This helps the classification AI learn from mistakes.
Workflow: first use list_classify_events to find the event, then add feedback explaining why it was wrong.
Guide user to describe: why was the classification wrong? Where should it have gone? What pattern should be learned?`,
      schema: z.object({
        eventId: z.string().min(1).describe('The event ID from list_classify_events'),
        feedback: z.string().min(1).describe('User feedback explaining the classification error'),
      }),
    },
  );
}
