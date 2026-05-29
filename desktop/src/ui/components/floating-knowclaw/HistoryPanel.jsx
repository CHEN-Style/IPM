// desktop/src/ui/components/floating-knowclaw/HistoryPanel.jsx
//
// FK3-5: session history slide-over for the floating KnowClaw panel.
// Overlays the chat list area (absolute positioned) when toggled open
// from the header's history button. Simplified compared to the main
// window's SessionPanel: no fork, no right-click menu, just search +
// select + delete.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Trash2 } from 'lucide-react';

function formatRelativeTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}天前`;
  return new Date(ms).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export default function HistoryPanel({
  currentSessionId,
  onSelect,
  onDelete,
  onClose,
  listSessions,
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listSessions?.();
        if (!cancelled && Array.isArray(list)) setSessions(list);
      } catch { /* non-fatal */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [listSessions]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.trim().toLowerCase();
    return sessions.filter((s) =>
      (s.firstMessage || '').toLowerCase().includes(q),
    );
  }, [sessions, search]);

  const handleDelete = useCallback(async (e, path) => {
    e.stopPropagation();
    if (confirmDelete !== path) {
      setConfirmDelete(path);
      return;
    }
    try {
      await onDelete?.(path);
      setSessions((prev) => prev.filter((s) => s.path !== path));
    } catch { /* non-fatal */ }
    setConfirmDelete(null);
  }, [confirmDelete, onDelete]);

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col bg-white/98 rounded-b-[14px]
                 animate-[slideIn_160ms_ease-out]"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <div className="flex-1 flex items-center gap-1.5 h-7 px-2 rounded-lg
                        border border-slate-200 bg-slate-50">
          <Search size={12} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话..."
            className="flex-1 bg-transparent border-0 outline-none
                       text-[11px] text-slate-700 placeholder:text-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 grid place-items-center rounded-md
                     text-slate-400 hover:text-slate-700 hover:bg-slate-100
                     transition-colors"
          aria-label="关闭历史"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1.5"
           style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(148,163,184,0.3) transparent' }}>
        {loading ? (
          <div className="py-6 text-center text-[11px] text-slate-400">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-slate-400">
            {search.trim() ? '无匹配会话' : '暂无历史会话'}
          </div>
        ) : (
          filtered.map((s) => {
            const isCurrent = currentSessionId && s.path?.includes(currentSessionId);
            return (
              <button
                key={s.path}
                type="button"
                onClick={() => onSelect?.(s.path)}
                className={`w-full flex items-start gap-2 px-2.5 py-2 mb-0.5 rounded-lg
                           text-left transition-colors group
                           ${isCurrent
                             ? 'bg-indigo-50/70 border border-indigo-200/60'
                             : 'border border-transparent hover:bg-slate-50'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-slate-700 font-medium truncate leading-tight">
                    {s.firstMessage || '(空白会话)'}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                    <span>{s.messageCount || 0} 条</span>
                    <span>{formatRelativeTime(s.modified)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, s.path)}
                  className={`shrink-0 w-5 h-5 grid place-items-center rounded
                             transition-all
                             ${confirmDelete === s.path
                               ? 'text-rose-500 bg-rose-50'
                               : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-500'}`}
                  title={confirmDelete === s.path ? '再次点击确认删除' : '删除会话'}
                  aria-label="删除"
                >
                  <Trash2 size={11} />
                </button>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
