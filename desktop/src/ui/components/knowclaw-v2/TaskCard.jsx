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
    iconClass: 'text-emerald-500/70',
    titleClass: 'text-gray-400/70 line-through',
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
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 shrink-0">
        <Icon
          size={15}
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

// D.5: compact one-line summary for stale TaskCard snapshots.
// When an assistant turn fires `task_manager` multiple times, every
// successful call appends a new `kind:'tasks'` bubble. Old snapshots
// freeze in whatever state they had at the time — including any
// `in_progress` rows that keep spinning forever. To avoid misleading
// the user, only the latest snapshot renders as the full TaskCard;
// older snapshots collapse into this summary row (no spinner).
export function TaskCardSummary({ tasks, ts }) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const total = safe.length;
  const done = safe.reduce(
    (acc, t) => (t?.status === 'completed' ? acc + 1 : acc),
    0,
  );
  const timeStr =
    typeof ts === 'number' && Number.isFinite(ts)
      ? new Date(ts).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  const label = total > 0
    ? `任务清单${timeStr ? ` · ${timeStr}` : ''} · ${done}/${total} 已完成`
    : `任务清单${timeStr ? ` · ${timeStr}` : ''} · 已清空`;
  return (
    <div className="my-1.5 max-w-full">
      <div className="inline-flex items-center gap-2 px-3 py-1 text-[11px] text-gray-400 rounded-lg bg-gray-50/50 ring-1 ring-gray-100 shadow-xs">
        <ListTodo size={11} className="shrink-0" strokeWidth={2} />
        <span className="truncate">{label}</span>
      </div>
    </div>
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
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-r from-gray-50/80 to-white border-b border-gray-100">
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
          <div className="flex items-center justify-center gap-2 px-3.5 py-4 text-[12px] text-gray-300 italic">
            <ListTodo size={14} className="text-gray-200" />
            任务清单已清空
          </div>
        ) : (
          <ul className="px-3.5 py-2 divide-y divide-gray-100/60">
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
