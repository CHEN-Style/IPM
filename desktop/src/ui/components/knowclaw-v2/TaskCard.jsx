// desktop/src/ui/components/knowclaw-v2/TaskCard.jsx
//
// U7: inline TaskCard rendered for `message.kind === 'tasks'` bubbles.
//
// Each time the agent calls `task_manager`, the renderer appends a
// snapshot bubble carrying `{ kind: 'tasks', tasks: Task[], ts }`.
// MessageBubble routes those bubbles to this component before the
// normal text-bubble pipeline. Old snapshots stay in the transcript
// untouched (as a history of the agent's planning evolution).
//
// Design language: Notion-style checklist — minimal, glanceable,
// readable. Status icons mirror Claude Code:
//   pending     ○  gray circle
//   in_progress ◐  blue half-circle (uses Loader2 for subtle spin)
//   completed   ✓  emerald check
//   cancelled   ×  rose x, with strike-through
//
// v1 is **read-only**: clicking does nothing. The agent owns the
// state machine. We'll consider manual checkbox-toggle in a later
// iteration if user feedback asks for it (D8/out-of-scope).

import React, { useMemo } from 'react';
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  ListTodo,
} from 'lucide-react';

const STATUS_META = {
  pending: {
    Icon: Circle,
    iconClass: 'text-gray-300',
    titleClass: 'text-gray-700',
    spin: false,
  },
  in_progress: {
    Icon: Loader2,
    iconClass: 'text-sky-500',
    titleClass: 'text-gray-900 font-medium',
    spin: true,
  },
  completed: {
    Icon: CheckCircle2,
    iconClass: 'text-emerald-500',
    titleClass: 'text-gray-400 line-through',
    spin: false,
  },
  cancelled: {
    Icon: XCircle,
    iconClass: 'text-rose-400',
    titleClass: 'text-gray-400 line-through',
    spin: false,
  },
};

function TaskRow({ task }) {
  const meta = STATUS_META[task.status] || STATUS_META.pending;
  const { Icon } = meta;
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0">
        <Icon
          size={14}
          className={`${meta.iconClass}${meta.spin ? ' animate-spin' : ''}`}
          strokeWidth={2}
        />
      </span>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] leading-snug ${meta.titleClass}`}>
          {task.title}
        </div>
        {task.notes && (
          <div className="mt-0.5 text-[11px] text-gray-400 leading-snug whitespace-pre-wrap break-words">
            {task.notes}
          </div>
        )}
      </div>
    </li>
  );
}

const TaskCard = ({ tasks, ts }) => {
  const safe = Array.isArray(tasks) ? tasks : [];

  const counts = useMemo(() => {
    const c = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const t of safe) {
      const s = t?.status;
      if (s && c[s] !== undefined) c[s] += 1;
    }
    return c;
  }, [safe]);

  const total = safe.length;
  const done = counts.completed;
  const isEmpty = total === 0;

  const headerLabel = isEmpty
    ? '任务清单'
    : `任务清单 · ${done} / ${total} 已完成`;

  return (
    <div className="my-2 max-w-full">
      <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 bg-gray-50/60 border-b border-gray-100">
          <ListTodo size={13} className="text-gray-500 shrink-0" />
          <span className="text-[12px] text-gray-600 font-medium">
            {headerLabel}
          </span>
          {!isEmpty && (counts.in_progress > 0 || counts.pending > 0) && (
            <span className="text-[10px] text-gray-400">
              · 进行中 {counts.in_progress} · 待办 {counts.pending}
              {counts.cancelled > 0 ? ` · 取消 ${counts.cancelled}` : ''}
            </span>
          )}
          <span className="flex-1" />
          {typeof ts === 'number' && Number.isFinite(ts) && (
            <span className="text-[10px] text-gray-400 font-mono">
              {new Date(ts).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>

        {isEmpty ? (
          <div className="px-3.5 py-3 text-[12px] text-gray-400 italic">
            （任务清单已清空）
          </div>
        ) : (
          <ul className="px-3 py-1.5 divide-y divide-gray-50">
            {safe.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
