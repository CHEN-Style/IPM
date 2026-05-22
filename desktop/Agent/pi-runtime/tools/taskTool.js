// desktop/Agent/pi-runtime/tools/taskTool.js
//
// U7: task-tracking tool (`task_manager`).
//
// What it does
// ------------
// Exposes a Claude-Code style "TodoWrite" customTool. The model
// passes a **complete** array of tasks; we atomically replace the
// session's task list and persist a snapshot to the pi session
// JSONL via `sessionManager.appendCustomEntry(...)`. The persisted
// entry is a pi `CustomEntry` (NOT `CustomMessageEntry`), which
// means it survives reload but does NOT enter the LLM context —
// the model already knows the tasks via its own previous tool_call
// args, so re-injecting them as messages would just waste tokens.
//
// Why "atomic replace" vs "CRUD"
// ------------------------------
// - The model only needs to think about "what's the next state of
//   the list" instead of computing diffs against a prior call.
// - One action → one tool definition → one renderer card. No
//   per-action state machine on either side.
// - Token cost per call is slightly higher (the full list is
//   resent) but task lists rarely exceed ~10 items in practice, so
//   the overhead is dwarfed by the rest of the assistant turn.
//
// Tool result shape
// -----------------
//   details: { tasks: Task[], ts: number, persisted: boolean }
//   content: [{ type: 'text', text: '<short summary>' }]
//
// The renderer consumes `details.tasks` to render a TaskCard
// bubble; the `content[0].text` field is what the LLM sees as the
// tool result for its own follow-up reasoning. We keep the text
// short (a one-line summary like "3 tasks queued, 0 in progress,
// 5 done") because dumping the full JSON would defeat the whole
// "context isolation" point of using CustomEntry over
// CustomMessageEntry.

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

/**
 * Build a one-line summary of the task list for the model's
 * tool-result text. Keep it short — the model already has the
 * structured array in its own tool_call args.
 *
 * @param {Array<{status: string}>} tasks
 * @returns {string}
 */
function summarizeTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return 'task_manager: 任务清单已清空。';
  }
  const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const t of tasks) {
    const s = t?.status;
    if (typeof s === 'string' && counts[s] !== undefined) counts[s] += 1;
  }
  return [
    `task_manager: ${tasks.length} 个任务`,
    `(待办 ${counts.pending} / 进行中 ${counts.in_progress} / 已完成 ${counts.completed} / 已取消 ${counts.cancelled})`,
  ].join(' ');
}

/**
 * Validate task IDs are unique within the array.
 *
 * @param {Array<{id: string}>} tasks
 * @returns {string|null} Error message or null when valid.
 */
function findDuplicateId(tasks) {
  const seen = new Set();
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string') continue;
    if (seen.has(t.id)) return t.id;
    seen.add(t.id);
  }
  return null;
}

/**
 * Build the `task_manager` tool definition.
 *
 * @param {object} deps
 * @param {*}      deps.sessionManager  pi `SessionManager` of the
 *                                      *parent* session. The tool
 *                                      writes a `custom` entry on
 *                                      each call. May be null/undefined
 *                                      in edge cases (e.g. inMemory
 *                                      sub-agent) — persistence will
 *                                      be skipped gracefully.
 * @param {Function} [deps.log]         diagnostic logger
 * @returns {Array<object>} A ToolDefinition[] suitable for `customTools`.
 */
export function buildTaskTool(deps = {}) {
  const { sessionManager = null, log = () => {} } = deps;

  const tool = defineTool({
    name: 'task_manager',
    label: '任务清单',
    description: [
      '维护当前会话的多步骤任务清单（Claude Code TodoWrite 风格）。',
      '每次调用传入**完整**的任务数组，工具会原子替换整个清单——',
      '不要传 diff、不要省略已存在的任务，否则它们会从清单中消失。',
      '',
      '何时调用：',
      '- 用户给出多步骤任务（≥ 3 步，或跨多个工具调用）时，**先**用 task_manager 列出规划',
      '- 每完成一步立刻调用 task_manager 把对应任务的 status 改为 completed',
      '- 切换到下一步时把那一步标记为 in_progress',
      '- 任务作废或不再需要时标记为 cancelled（保留在清单里，不要直接删）',
      '',
      '何时不调用：',
      '- 单步任务（一次工具调用即可完成）——直接执行，不要凑数',
      '- 单纯回答问题、解释概念、聊天闲谈',
      '- 子代理（delegate_task）内部——它们看不到这个工具，使命单一',
    ].join('\n'),
    promptSnippet:
      'task_manager: maintain a multi-step task checklist for the current session. Pass the FULL tasks array each time (atomic replace, not diff). Use for ≥3-step tasks; skip for trivial single-step requests.',
    promptGuidelines: [
      '多步骤任务（≥ 3 步或跨多个工具调用）：开始执行前先调 task_manager 列规划。',
      '每完成一步：再调 task_manager 把刚完成的项 status 改为 completed、下一项改为 in_progress。',
      '调用时必须传完整数组——TodoWrite 风格，不是增量；遗漏的旧任务会从清单消失。',
      'ID 用稳定字符串（如 `step-1` / `analyze-files`），跨次调用保持不变，便于用户跟踪状态变化。',
      '单步任务、问答、闲聊——不要使用 task_manager。',
    ],
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          id: Type.String({
            minLength: 1,
            description:
              '任务唯一标识。跨次调用保持稳定（建议用短英文 slug，如 `step-1` / `analyze-files`）。',
          }),
          title: Type.String({
            minLength: 1,
            description: '简短的任务标题（一行能写完，给用户看的）。',
          }),
          status: Type.Union(
            [
              Type.Literal('pending'),
              Type.Literal('in_progress'),
              Type.Literal('completed'),
              Type.Literal('cancelled'),
            ],
            { description: '任务状态。' },
          ),
          notes: Type.Optional(
            Type.String({
              description: '可选的简短补充说明，例如卡点、引用的文件路径等。',
            }),
          ),
        }),
        {
          description:
            '**完整**任务数组，原子替换整张清单。空数组表示清空。',
        },
      ),
    }),

    async execute(_toolCallId, params /* , signal, onUpdate */) {
      const ts = Date.now();
      const rawTasks = Array.isArray(params?.tasks) ? params.tasks : [];

      // Defensive: TypeBox already validated shape, but the union
      // member literals only catch *known* status strings. Belt-and
      // -braces normalisation so a future schema relaxation doesn't
      // silently let through "in-progress" (hyphen) etc.
      const normalized = [];
      for (const t of rawTasks) {
        if (!t || typeof t !== 'object') continue;
        const id = typeof t.id === 'string' ? t.id.trim() : '';
        const title = typeof t.title === 'string' ? t.title.trim() : '';
        const status = typeof t.status === 'string' ? t.status.trim() : 'pending';
        if (!id || !title) continue;
        if (!VALID_STATUSES.includes(status)) continue;
        const entry = { id, title, status };
        if (typeof t.notes === 'string' && t.notes.trim()) {
          entry.notes = t.notes.trim();
        }
        normalized.push(entry);
      }

      // ID uniqueness — surface to model as a tool error so it
      // can retry with corrected IDs rather than silently merging.
      const dup = findDuplicateId(normalized);
      if (dup) {
        const errPayload = {
          ok: false,
          error: `重复的任务 id: '${dup}'。每个任务必须有唯一 id；请用稳定 slug（如 step-1 / step-2）。`,
          ts,
        };
        return {
          isError: true,
          details: errPayload,
          content: [{ type: 'text', text: errPayload.error }],
        };
      }

      // Persist as a pi CustomEntry (NOT CustomMessageEntry — see
      // file header). Best-effort: if persistence fails for any
      // reason, the tool still returns the snapshot so the
      // renderer's TaskCard updates and the model gets confirmation.
      let persisted = false;
      if (sessionManager && typeof sessionManager.appendCustomEntry === 'function') {
        try {
          sessionManager.appendCustomEntry('knowclaw:tasks', { tasks: normalized, ts });
          persisted = true;
        } catch (err) {
          log('taskTool: appendCustomEntry failed (non-fatal):', err?.message || err);
        }
      } else {
        log('taskTool: sessionManager unavailable — skipping persistence');
      }

      const details = { tasks: normalized, ts, persisted };
      return {
        details,
        content: [{ type: 'text', text: summarizeTasks(normalized) }],
      };
    },
  });

  return [tool];
}
