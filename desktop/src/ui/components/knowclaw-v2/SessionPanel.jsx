// desktop/src/ui/components/knowclaw-v2/SessionPanel.jsx
//
// Phase 10: collapsible left-side panel listing persisted KnowClaw v2
// sessions (pi-coding-agent JSONL files under
// `app.getPath('userData')/knowclaw-sessions/<cwdHash>/`).
//
// Powered entirely by `useKnowClawV2Chat`'s session state/actions.
// Communicates via the `window.ipm.knowclaw` IPC bridge — does not
// touch the filesystem directly.
//
// Behavior:
//   - Click a row → openSession(path) → hook receives `history_loaded`
//     and replaces the chat transcript.
//   - Right-side ⋯ menu → 「打开 / 分支 / 删除」.
//   - Delete asks for confirmation.
//   - Fork (default behavior) duplicates the session at its current
//     leaf so the user can diverge without mutating history. Using a
//     specific entry index is plumbed through the IPC layer but not
//     exposed in this minimal Phase-10 UI (deferred to a per-message
//     "branch from here" affordance later).
//
// Layout: fixed-width (`w-72`) drawer that the parent page mounts/
// unmounts via the `showSessionPanel` flag in the hook.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  RotateCcw,
  Plus,
  MoreHorizontal,
  GitBranch,
  Trash2,
  FolderOpen,
  MessageSquare,
} from 'lucide-react';

const RTF = typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
  ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  : null;

const RELATIVE_BUCKETS = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

function formatRelative(timestampMs) {
  if (!timestampMs) return '';
  const diff = timestampMs - Date.now();
  const abs = Math.abs(diff);
  if (abs < 30 * 1000) return '刚刚';
  for (const bucket of RELATIVE_BUCKETS) {
    if (abs >= bucket.ms) {
      const value = Math.round(diff / bucket.ms);
      if (RTF) return RTF.format(value, bucket.unit);
      return `${value} ${bucket.unit}${value === 1 ? '' : 's'}`;
    }
  }
  return '刚刚';
}

function truncate(text, max = 60) {
  if (!text) return '';
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + '…';
}

const SessionRow = ({
  session,
  isActive,
  onOpen,
  onFork,
  onDelete,
  disabled = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  // D.1: when a turn is in flight on the active session, lock the
  // entire row — opening / forking would tear down the live session
  // and discard the streaming response. Delete is locked too;
  // deleting the in-flight session is destructive and there's no
  // recovery path. The active row itself stays visually active
  // (amber highlight) so the user can still tell where they are.
  const preview = session.firstMessage
    ? truncate(session.firstMessage, 56)
    : '(无内容)';
  const relTime = formatRelative(session.modified);

  const handleRowClick = () => {
    if (disabled) return;
    if (isActive) return;
    onOpen(session);
  };

  const lockTitle = '当前有对话正在进行，请先等待结束或中止';

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleRowClick();
        }
      }}
      className={`group relative px-3 py-2.5 mx-2 rounded-lg transition-colors ${
        disabled && !isActive
          ? 'cursor-not-allowed opacity-50 border border-transparent'
          : isActive
            ? 'cursor-default bg-amber-50 border border-amber-200'
            : 'cursor-pointer hover:bg-slate-50 border border-transparent'
      }`}
      title={disabled ? lockTitle : preview}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-medium leading-snug line-clamp-2 ${
            isActive ? 'text-amber-900' : 'text-slate-700'
          }`}>
            {preview}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <MessageSquare size={9} />
              {session.messageCount || 0}
            </span>
            <span>·</span>
            <span>{relTime}</span>
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              setMenuOpen((v) => !v);
            }}
            className={`p-1 rounded transition-colors ${
              disabled
                ? 'text-slate-300 opacity-0 group-hover:opacity-100 cursor-not-allowed'
                : menuOpen
                  ? 'bg-slate-200 text-slate-700'
                  : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700'
            }`}
            title={disabled ? lockTitle : '操作'}
          >
            <MoreHorizontal size={12} />
          </button>
          {menuOpen && !disabled && (
            <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onOpen(session);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs text-slate-600 hover:bg-slate-50"
              >
                <FolderOpen size={11} />
                <span>打开</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onFork(session);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs text-slate-600 hover:bg-slate-50"
              >
                <GitBranch size={11} />
                <span>分支</span>
              </button>
              <div className="my-1 mx-2 border-t border-slate-100" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete(session);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 size={11} />
                <span>删除</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SessionPanel = ({
  sessions,
  loading,
  currentSessionFile,
  onOpen,
  onFork,
  onDelete,
  onRefresh,
  onNewSession,
  // D.1: when true (turn in flight on the active session), disable
  // controls that would tear down the current session — opening,
  // forking, deleting, or creating-new. Refresh + search stay live.
  disabled = false,
}) => {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const lockTitle = '当前有对话正在进行，请先等待结束或中止';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      String(s.firstMessage || '').toLowerCase().includes(q),
    );
  }, [sessions, query]);

  const handleDeleteRequest = (session) => {
    setPendingDelete(session);
  };

  const handleConfirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    await onDelete(target.path);
  };

  const handleFork = async (session) => {
    try {
      const res = await onFork(session.path, undefined);
      if (res && !res.ok) {
        // eslint-disable-next-line no-console
        console.warn('[SessionPanel] fork failed:', res.error);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[SessionPanel] fork error:', err?.message || err);
    }
  };

  return (
    <div className="flex flex-col h-full w-72 border-r border-slate-100 bg-slate-50/40">
      <div className="px-3 py-3 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            历史会话
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              title="刷新"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              onClick={onNewSession}
              disabled={disabled}
              className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
              title={disabled ? lockTitle : '新建会话'}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索首条消息…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-300 focus:border-amber-300"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-2">
        {loading && sessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            {query.trim() ? '无匹配会话' : '暂无历史会话'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((session) => (
              <SessionRow
                key={session.path}
                session={session}
                isActive={Boolean(currentSessionFile) && session.path === currentSessionFile}
                onOpen={(s) => onOpen(s.path)}
                onFork={handleFork}
                onDelete={handleDeleteRequest}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="bg-white rounded-xl shadow-2xl p-5 w-72 mx-4">
            <h4 className="text-sm font-semibold text-slate-900 mb-2">
              删除会话
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              确认删除该会话？JSONL 文件将被永久移除，无法恢复。
            </p>
            <p className="text-[11px] text-slate-400 mb-4 font-mono break-all line-clamp-2">
              {truncate(pendingDelete.firstMessage || pendingDelete.id, 80)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionPanel;
