import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, Filter, MessageSquare, Pencil, Search, X, XCircle } from 'lucide-react';

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function classifiedByLabel(cb) {
  if (cb === 'fast-path') return '内置规则';
  if (cb === 'fast-path-user-rule') return '用户规则';
  if (cb === 'agent') return 'AI Agent';
  return cb || '未知';
}

function groupByDate(events) {
  const groups = [];
  let currentDate = null;
  let currentItems = [];
  for (const e of events) {
    const date = fmtDate(e.ts);
    if (date !== currentDate) {
      if (currentDate !== null) groups.push({ date: currentDate, items: currentItems });
      currentDate = date;
      currentItems = [];
    }
    currentItems.push(e);
  }
  if (currentDate !== null) groups.push({ date: currentDate, items: currentItems });
  return groups;
}

function EventRow({ event, detailed, onEditFeedback }) {
  const isAccepted = event.event === 'classify.accepted';
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group border-b border-slate-100 last:border-b-0">
      <div
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/60 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-shrink-0">
          {isAccepted ? (
            <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center">
              <Check size={13} className="text-emerald-600" />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
              <XCircle size={13} className="text-slate-400" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-800 truncate">{event.fileName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eceef7] text-[#3e4b9c] font-medium flex-shrink-0">
              {isAccepted ? event.actualFolder : event.suggestedFolder}
            </span>
            {!isAccepted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-500 font-medium flex-shrink-0">
                已拒绝
              </span>
            )}
          </div>
          {detailed && (
            <div className="text-[11px] text-slate-400 mt-0.5 truncate">
              {classifiedByLabel(event.classifiedBy)}
              {event.confidence != null ? ` · 置信度 ${Math.round(event.confidence * 100)}%` : ''}
              {event.sourceDir ? ` · 来源: ${event.sourceDir}` : ''}
            </div>
          )}
        </div>

        {event.userFeedback && (
          <MessageSquare size={13} className="text-amber-500 flex-shrink-0" title="有用户反馈" />
        )}

        <div className="text-[11px] text-slate-400 flex-shrink-0 tabular-nums">{fmtTs(event.ts)}</div>

        <div className="flex-shrink-0 w-4">
          {expanded ? <ChevronDown size={14} className="text-slate-300" /> : <ChevronRight size={14} className="text-slate-300" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pl-[52px] space-y-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
            <div>
              <span className="text-slate-400">分类方式：</span>
              <span className="text-slate-600">{classifiedByLabel(event.classifiedBy)}</span>
            </div>
            <div>
              <span className="text-slate-400">置信度：</span>
              <span className="text-slate-600">{event.confidence != null ? `${Math.round(event.confidence * 100)}%` : '-'}</span>
            </div>
            {event.suggestedFolder && (
              <div>
                <span className="text-slate-400">建议文件夹：</span>
                <span className="text-slate-600">{event.suggestedFolder}</span>
              </div>
            )}
            {event.actualFolder && (
              <div>
                <span className="text-slate-400">实际归入：</span>
                <span className="text-slate-600">{event.actualFolder}</span>
              </div>
            )}
            {event.sourcePath && (
              <div className="col-span-2">
                <span className="text-slate-400">原始来源：</span>
                <span className="text-slate-600 break-all">{event.sourcePath}</span>
              </div>
            )}
          </div>
          {event.rationale && (
            <div className="text-[11px]">
              <span className="text-slate-400">AI 理由：</span>
              <span className="text-slate-600">{event.rationale}</span>
            </div>
          )}
          <div className="text-[11px] flex items-start gap-1">
            <span className="text-slate-400 flex-shrink-0">用户反馈：</span>
            {event.userFeedback ? (
              <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{event.userFeedback}</span>
            ) : (
              <span className="text-slate-300 italic">无</span>
            )}
            {!isAccepted && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditFeedback?.(event);
                }}
                className="ml-1 p-0.5 rounded hover:bg-slate-200 transition-colors"
                title={event.userFeedback ? '修改反馈' : '添加反馈'}
              >
                <Pencil size={11} className="text-slate-400" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'classify.accepted', label: '已接受' },
  { value: 'classify.rejected', label: '已拒绝' },
];

const ClassifyEventsTab = ({ projectName, domain }) => {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('all');
  const [detailed, setDetailed] = useState(true);
  const [editingEvent, setEditingEvent] = useState(null);
  const [feedbackDraft, setFeedbackDraft] = useState('');

  const loadEvents = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const res = await window.ipm?.classifyEvents?.list?.(projectName, {
        domain,
        eventType: eventType === 'all' ? undefined : eventType,
        search: search || undefined,
        limit: 200,
      });
      setEvents(Array.isArray(res?.events) ? res.events : []);
      setTotal(res?.total ?? 0);
    } catch (e) {
      console.error('Failed to load events', e);
    } finally {
      setLoading(false);
    }
  }, [projectName, domain, eventType, search]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleEditFeedback = (event) => {
    setEditingEvent(event);
    setFeedbackDraft(event.userFeedback || '');
  };

  const handleSaveFeedback = async () => {
    if (!editingEvent) return;
    try {
      await window.ipm?.classifyEvents?.updateFeedback?.(projectName, editingEvent.id, feedbackDraft.trim() || null, { domain });
      setEditingEvent(null);
      loadEvents();
    } catch (e) {
      console.error('Failed to update feedback', e);
    }
  };

  const groups = groupByDate(events);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索文件名、文件夹..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40 bg-white"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100">
              <X size={12} className="text-slate-400" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEventType(opt.value)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all ${
                eventType === opt.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDetailed(!detailed)}
          className={`px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
            detailed ? 'bg-[#3e4b9c] text-white border-[#3e4b9c]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {detailed ? '详细' : '简略'}
        </button>

        <div className="text-[11px] text-slate-400 ml-auto">{total} 条记录</div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">加载中...</div>
        ) : events.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <BookOpen size={32} className="mx-auto text-slate-300 mb-2" />
            <div className="text-sm text-slate-500">暂无分类事件</div>
            <div className="text-[11px] text-slate-400 mt-1">接受或拒绝 AI 分类建议后，事件将记录在这里</div>
          </div>
        ) : (
          <div>
            {groups.map((group) => (
              <div key={group.date}>
                <div className="px-5 py-2 bg-slate-50/80 border-b border-slate-100 sticky top-0 z-10">
                  <span className="text-[11px] font-semibold text-slate-500">{group.date}</span>
                  <span className="text-[11px] text-slate-400 ml-2">{group.items.length} 条</span>
                </div>
                {group.items.map((evt) => (
                  <EventRow
                    key={evt.id}
                    event={evt}
                    detailed={detailed}
                    onEditFeedback={handleEditFeedback}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feedback editor modal */}
      {editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setEditingEvent(null)}>
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-1">编辑反馈</div>
            <div className="text-[11px] text-slate-400 mb-3 truncate">{editingEvent.fileName}</div>
            <textarea
              value={feedbackDraft}
              onChange={(e) => setFeedbackDraft(e.target.value)}
              placeholder="说明拒绝原因，例如：这个文件应该归到交付成果，因为..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => setEditingEvent(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveFeedback}
                className="px-4 py-1.5 text-xs bg-[#3e4b9c] text-white rounded-lg hover:bg-[#4e5bab] font-medium"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassifyEventsTab;
