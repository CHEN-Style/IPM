import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, Trash2, AlertTriangle, MessageSquare, ChevronDown } from 'lucide-react';

function groupByDate(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekStart = new Date(today.getTime() - today.getDay() * 86400000);

  const groups = { today: [], yesterday: [], week: [], earlier: [] };

  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    if (d >= today) groups.today.push(s);
    else if (d >= yesterday) groups.yesterday.push(s);
    else if (d >= weekStart) groups.week.push(s);
    else groups.earlier.push(s);
  }
  return groups;
}

const GROUP_LABELS = { today: '今天', yesterday: '昨天', week: '本周', earlier: '更早' };

const HistoryDropdown = ({ projectName, domain, activeSessionId, onSelect, onDelete, onClearAll }) => {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const res = await window.ipm?.agent?.listSessions?.(projectName, domain, { limit: 100 });
      if (res?.ok) setSessions(res.sessions || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectName, domain]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = (s) => {
    setOpen(false);
    onSelect?.(s.id);
  };

  const handleDelete = async (e, s) => {
    e.stopPropagation();
    if (!confirm(`确定删除对话「${s.title || '无标题'}」？`)) return;
    try {
      await window.ipm?.agent?.deleteSession?.(projectName, domain, s.id);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      onDelete?.(s.id);
    } catch { /* ignore */ }
  };

  const handleClearAll = async (e) => {
    e.stopPropagation();
    if (!sessions.length) return;
    if (!confirm(`确定删除全部 ${sessions.length} 条历史对话？此操作不可恢复。`)) return;
    setClearing(true);
    try {
      const failed = [];
      for (const s of sessions) {
        try {
          await window.ipm?.agent?.deleteSession?.(projectName, domain, s.id);
        } catch {
          failed.push(s);
        }
      }
      setSessions(failed);
      if (!failed.length) onClearAll?.();
    } finally {
      setClearing(false);
    }
  };

  const groups = groupByDate(sessions);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        title="对话历史"
      >
        <Clock size={13} />
        <span>历史</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-[60] w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(28rem,calc(100vh-6rem))] bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden flex flex-col animate-chat-panel"
        >
          <div className="px-4 py-3 border-b border-slate-100 text-xs font-medium text-slate-500 flex items-center justify-between gap-2 shrink-0">
            <span>对话历史</span>
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={clearing || loading}
                className="text-[10px] text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                {clearing ? '删除中…' : '清空全部'}
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1 min-h-0 overscroll-contain">
            {loading ? (
              <div className="p-4 text-center text-xs text-slate-400">加载中...</div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">暂无历史对话</div>
            ) : (
              Object.entries(groups).map(([key, list]) =>
                list.length ? (
                  <div key={key}>
                    <div className="px-4 py-1.5 text-[10px] text-slate-400 font-medium uppercase tracking-wide bg-slate-50">
                      {GROUP_LABELS[key]}
                    </div>
                    {list.map((s) => {
                      const isActive = s.id === activeSessionId;
                      return (
                        <div
                          key={s.id}
                          onClick={() => handleSelect(s)}
                          className={`px-3 py-2.5 flex items-center gap-2 cursor-pointer transition-colors border-b border-slate-50 last:border-0 ${
                            isActive ? 'bg-slate-100' : 'hover:bg-slate-50'
                          }`}
                        >
                          <MessageSquare size={14} className="text-slate-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-700 truncate font-medium">
                                {s.title || '无标题对话'}
                              </span>
                              {s.status === 'interrupted' && (
                                <span className="inline-flex flex-shrink-0" title="对话曾中断">
                                  <AlertTriangle size={11} className="text-amber-500" />
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {formatTime(s.updatedAt)} · {s.messageCount || 0} 条消息
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, s)}
                            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="删除此对话"
                            aria-label="删除此对话"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null,
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const M = d.getMonth() + 1;
    const D = d.getDate();
    return `${M}/${D} ${hh}:${mm}`;
  } catch {
    return '';
  }
}

export default HistoryDropdown;
