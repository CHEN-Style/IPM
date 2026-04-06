import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { ArrowLeft, Save, Clock, Tag, X, Pin, PinOff, Trash2, StickyNote, LayoutDashboard } from 'lucide-react';

const NoteEditor = lazy(() => import('./NoteEditor.jsx'));

export default function NoteEditorPage({ projectName, domain, itemId, onBack, onAddToTempBoard }) {
  const domainOpts = domain ? { domain } : {};
  const api = window.ipm?.knowledge;

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [newTag, setNewTag] = useState('');
  const [tags, setTags] = useState([]);
  const [importance, setImportance] = useState(null);

  const pendingContentRef = useRef(null);
  const autoSaveTimerRef = useRef(null);

  const loadItem = useCallback(async () => {
    if (!api?.get || !itemId) return;
    setLoading(true);
    try {
      const res = await api.get(projectName, itemId, domainOpts);
      const it = res?.item;
      if (it) {
        setItem(it);
        setTitle(it.title || '');
        setTags(Array.isArray(it.tags) ? it.tags : []);
        setImportance(it.importance || null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectName, itemId, domain]);

  useEffect(() => { loadItem(); }, [loadItem]);

  const saveNow = useCallback(async (extraPatch = {}) => {
    if (!api?.update || !itemId) return;
    setSaving(true);
    try {
      const patch = { title, tags, importance, ...extraPatch };
      const content = pendingContentRef.current;
      if (content) {
        patch.content_json = content.json ? JSON.stringify(content.json) : undefined;
        patch.content_text = content.text;
      }
      await api.update(projectName, itemId, patch, domainOpts);
    } catch { /* ignore */ }
    setSaving(false);
  }, [projectName, itemId, domain, title, tags, importance]);

  const handleNoteChange = useCallback(({ json, text }) => {
    pendingContentRef.current = { json, text };
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveNow();
    }, 2000);
  }, [saveNow]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const handleBack = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    saveNow().then(() => onBack?.());
  }, [saveNow, onBack]);

  const handleTitleBlur = () => saveNow();

  const handleAddTag = (e) => {
    if (e.key === 'Enter' && newTag.trim()) {
      e.preventDefault();
      if (!tags.includes(newTag.trim())) {
        const next = [...tags, newTag.trim()];
        setTags(next);
        saveNow({ tags: next });
      }
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    const next = tags.filter((t) => t !== tagToRemove);
    setTags(next);
    saveNow({ tags: next });
  };

  const handleTogglePin = async () => {
    if (!api?.update || !item) return;
    try {
      await api.update(projectName, itemId, { pinned: !item.pinned }, domainOpts);
      setItem((prev) => prev ? { ...prev, pinned: !prev.pinned } : prev);
    } catch { /* ignore */ }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定删除「${title || '未命名'}」吗？`)) return;
    if (!api?.delete) return;
    try {
      await api.delete(projectName, itemId, domainOpts);
      onBack?.();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white h-full">
        <div className="text-sm text-slate-400">加载笔记...</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white h-full gap-3">
        <div className="text-sm text-slate-400">未找到该笔记</div>
        <button type="button" onClick={onBack} className="text-sm text-indigo-600 hover:underline">返回</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleBack} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-all shadow-sm">
            <ArrowLeft size={14} /> 返回
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-md">
              <StickyNote size={16} />
            </div>
            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">笔记编辑</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-slate-400">保存中...</span>}
          {onAddToTempBoard && (
            <button type="button" onClick={() => onAddToTempBoard?.(item)} className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-400 hover:text-teal-600 hover:border-teal-200 hover:bg-teal-50 transition-colors" title="加入临时看板">
              <LayoutDashboard size={15} />
            </button>
          )}
          <button type="button" onClick={handleTogglePin} className={`p-1.5 rounded-md border transition-colors ${item.pinned ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-400 hover:text-amber-500'}`} title={item.pinned ? '取消置顶' : '置顶'}>
            {item.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button type="button" onClick={handleDelete} className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 transition-colors" title="删除">
            <Trash2 size={15} />
          </button>
          <button type="button" onClick={() => saveNow()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors">
            <Save size={14} /> 保存
          </button>
        </div>
      </div>

      {/* Title + Meta bar */}
      <div className="px-8 pt-6 pb-4 border-b border-slate-100 bg-white">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          className="w-full text-2xl font-bold text-slate-800 border-none outline-none p-0 bg-transparent placeholder:text-slate-300"
          placeholder="笔记标题..."
        />
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <Clock size={11} />
            <span>{(item.created_at || '').slice(0, 10)}</span>
          </div>

          {/* Importance */}
          <div className="flex items-center gap-1">
            {['low', 'medium', 'high'].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => {
                  const next = importance === level ? null : level;
                  setImportance(next);
                  saveNow({ importance: next });
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                  importance === level
                    ? level === 'high' ? 'bg-red-50 border-red-200 text-red-600' : level === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-blue-50 border-blue-200 text-blue-600'
                    : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                }`}
              >
                {level === 'high' ? '高' : level === 'medium' ? '中' : '低'}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-slate-200" />

          {/* Tags */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] border border-slate-200">
                {tag}
                <button type="button" onClick={() => handleRemoveTag(tag)} className="text-slate-400 hover:text-slate-600 ml-0.5"><X size={10} /></button>
              </span>
            ))}
            <div className="relative flex items-center">
              <Tag size={10} className="absolute left-1.5 text-slate-400" />
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={handleAddTag}
                className="pl-5 pr-2 py-0.5 w-20 text-[11px] bg-white border border-slate-200 rounded focus:border-slate-400 outline-none transition-all"
                placeholder="标签..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Editor area - takes remaining space */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-6">
          <Suspense fallback={<div className="text-sm text-slate-400 py-8 text-center">加载编辑器...</div>}>
            <NoteEditor
              initialContent={item.content_json}
              markdownFallback={!item.content_json && item.content_text ? item.content_text : undefined}
              onChange={handleNoteChange}
              editorKey={item.id}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
