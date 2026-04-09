import React, { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Loader2, MessageSquarePlus, Pencil, Plus, Sparkles, ToggleLeft, ToggleRight, Trash2, X, Zap } from 'lucide-react';

function splitTags(str) {
  return String(str || '')
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function strengthLabel(s) {
  if (s >= 0.9) return '极强';
  if (s >= 0.7) return '强';
  if (s >= 0.5) return '中';
  if (s >= 0.3) return '弱';
  return '极弱';
}

function strengthColor(s) {
  if (s >= 0.7) return 'bg-emerald-500';
  if (s >= 0.5) return 'bg-amber-400';
  return 'bg-slate-300';
}

function conditionSummary(c) {
  const parts = [];
  if (c?.nameIncludes?.length) parts.push(`名含: ${c.nameIncludes.join(', ')}`);
  if (c?.nameExcludes?.length) parts.push(`名排除: ${c.nameExcludes.join(', ')}`);
  if (c?.exts?.length) parts.push(`扩展名: .${c.exts.join(', .')}`);
  if (c?.sourceIncludes?.length) parts.push(`来源含: ${c.sourceIncludes.join(', ')}`);
  if (c?.sourceExcludes?.length) parts.push(`来源排除: ${c.sourceExcludes.join(', ')}`);
  return parts.length ? parts.join(' | ') : '无条件';
}

function sourceLabel(src) {
  if (src === 'auto_learned') return '自动学习';
  if (src === 'natural_language') return '自然语言';
  return '手动创建';
}

function PrefRow({ pref, onToggle, onEdit, onDelete }) {
  const str = pref.tendency?.strength ?? 0;
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 group hover:bg-slate-50/60 transition-colors">
      <button
        type="button"
        onClick={() => onToggle(pref.id, !pref.enabled)}
        className="flex-shrink-0"
        title={pref.enabled ? '点击禁用' : '点击启用'}
      >
        {pref.enabled ? (
          <ToggleRight size={20} className="text-emerald-500" />
        ) : (
          <ToggleLeft size={20} className="text-slate-300" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${pref.enabled ? 'text-slate-800' : 'text-slate-400'}`}>
            {pref.pattern || '未命名偏好'}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eceef7] text-[#3e4b9c] font-medium flex-shrink-0">
            {pref.tendency?.folder || '-'}
          </span>
          {pref.source !== 'user_defined' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eceef7] text-[#515668] font-medium flex-shrink-0">
              {sourceLabel(pref.source)}
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-400 truncate mt-0.5">{conditionSummary(pref.conditions)}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0" title={`倾向强度: ${strengthLabel(str)} (${Math.round(str * 100)}%)`}>
        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full ${strengthColor(str)} transition-all`} style={{ width: `${str * 100}%` }} />
        </div>
        <span className="text-[10px] text-slate-400 w-8 tabular-nums">{Math.round(str * 100)}%</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button type="button" onClick={() => onEdit(pref)} className="p-1 rounded hover:bg-slate-200" title="编辑">
          <Pencil size={13} className="text-slate-500" />
        </button>
        <button type="button" onClick={() => onDelete(pref.id)} className="p-1 rounded hover:bg-red-100" title="删除">
          <Trash2 size={13} className="text-red-400" />
        </button>
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  pattern: '',
  targetFolder: '',
  strength: 0.7,
  nameIncludes: '',
  nameExcludes: '',
  exts: '',
  sourceIncludes: '',
  sourceExcludes: '',
};

function PrefForm({ folders, initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    if (!initial) return { ...EMPTY_FORM };
    const c = initial.conditions || {};
    return {
      pattern: initial.pattern || '',
      targetFolder: initial.tendency?.folder || '',
      strength: initial.tendency?.strength ?? 0.7,
      nameIncludes: (c.nameIncludes || []).join(', '),
      nameExcludes: (c.nameExcludes || []).join(', '),
      exts: (c.exts || []).join(', '),
      sourceIncludes: (c.sourceIncludes || []).join(', '),
      sourceExcludes: (c.sourceExcludes || []).join(', '),
    };
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.pattern.trim() || !form.targetFolder) return;
    onSave({
      pattern: form.pattern.trim(),
      tendency: {
        folder: form.targetFolder,
        strength: Number(form.strength) || 0.7,
      },
      conditions: {
        nameIncludes: splitTags(form.nameIncludes),
        nameExcludes: splitTags(form.nameExcludes),
        exts: splitTags(form.exts),
        sourceIncludes: splitTags(form.sourceIncludes),
        sourceExcludes: splitTags(form.sourceExcludes),
      },
    });
  };

  const inputCls =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40 bg-white';
  const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 border-t border-slate-200 bg-slate-50/60 space-y-3">
      <div>
        <label className={labelCls}>
          偏好描述 <span className="text-red-400">*</span>
          <span className="text-slate-400 font-normal ml-1">（自然语言，AI 会读到这段话）</span>
        </label>
        <textarea
          className={`${inputCls} resize-none`}
          placeholder="例如：来自微信的 PDF 文件通常是客户发来的外部资料"
          value={form.pattern}
          onChange={(e) => set('pattern', e.target.value)}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>
            倾向文件夹 <span className="text-red-400">*</span>
          </label>
          <select className={inputCls} value={form.targetFolder} onChange={(e) => set('targetFolder', e.target.value)}>
            <option value="">选择文件夹...</option>
            {(folders || []).map((f) => (
              <option key={f.relPath} value={f.relPath}>
                {f.relPath}
                {f.description ? ` — ${f.description}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>
            倾向强度：{strengthLabel(form.strength)} ({Math.round(form.strength * 100)}%)
          </label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={form.strength}
            onChange={(e) => set('strength', parseFloat(e.target.value))}
            className="w-full mt-2"
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>
          文件名包含关键词 <span className="text-slate-400 font-normal">（逗号分隔，可选）</span>
        </label>
        <input className={inputCls} placeholder="如：草稿, 修改意见" value={form.nameIncludes} onChange={(e) => set('nameIncludes', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>
            扩展名 <span className="text-slate-400 font-normal">（空 = 不限）</span>
          </label>
          <input className={inputCls} placeholder="如：pdf, docx" value={form.exts} onChange={(e) => set('exts', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>
            来源路径包含 <span className="text-slate-400 font-normal">（空 = 不限）</span>
          </label>
          <input className={inputCls} placeholder="如：WXWork, 微信" value={form.sourceIncludes} onChange={(e) => set('sourceIncludes', e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-4 py-1.5 text-xs rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] font-medium"
        >
          {initial ? '保存修改' : '添加偏好'}
        </button>
      </div>
    </form>
  );
}

function NLPreviewCard({ result, onConfirm, onEditThenAdd, onCancel }) {
  return (
    <div className="mx-4 my-3 p-4 rounded-xl border border-[#d8dbed] bg-[#eceef7]/50 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-[#3e4b9c]">
        <Sparkles size={14} />
        AI 解析结果预览
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <span className="text-slate-500">描述：</span>
          <span className="text-slate-800">{result.pattern}</span>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <span className="text-slate-500">目标文件夹：</span>
            <span className="px-1.5 py-0.5 rounded bg-[#d8dbed] text-[#3e4b9c] text-xs font-medium">{result.tendency?.folder}</span>
          </div>
          <div>
            <span className="text-slate-500">强度：</span>
            <span className="text-slate-800">{strengthLabel(result.tendency?.strength)} ({Math.round((result.tendency?.strength ?? 0) * 100)}%)</span>
          </div>
        </div>
        <div>
          <span className="text-slate-500">条件：</span>
          <span className="text-slate-600 text-xs">{conditionSummary(result.conditions)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] font-medium"
        >
          <Check size={13} />
          确认添加
        </button>
        <button
          type="button"
          onClick={onEditThenAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[#d8dbed] text-[#3e4b9c] hover:bg-[#eceef7] font-medium"
        >
          <Pencil size={13} />
          编辑后添加
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
        >
          <X size={13} />
          取消
        </button>
      </div>
    </div>
  );
}

const PreferencesPanel = ({ projectName, domain, embedded = false, addTriggerRef }) => {
  const [prefs, setPrefs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingPref, setEditingPref] = useState(null);

  const [nlText, setNlText] = useState('');
  const [nlParsing, setNlParsing] = useState(false);
  const [nlResult, setNlResult] = useState(null);
  const [nlError, setNlError] = useState('');

  const active = embedded;

  const loadData = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const [prefsRes, explorerRes] = await Promise.all([
        window.ipm?.preferences?.list?.(projectName, { domain }),
        window.ipm?.explorer?.list?.(projectName, '', { domain }),
      ]);
      setPrefs(Array.isArray(prefsRes?.preferences) ? prefsRes.preferences : []);
      const entries = Array.isArray(explorerRes?.entries) ? explorerRes.entries : [];
      const SYSTEM_DIRS = new Set(['meta', 'temp', 'snippets']);
      setFolders(
        entries
          .filter((e) => e.kind === 'dir' && !SYSTEM_DIRS.has(e.name))
          .map((e) => ({ relPath: e.relPath || e.name, name: e.name, description: e.description || '' })),
      );
    } catch (e) {
      console.error('Failed to load preferences/folders', e);
    } finally {
      setLoading(false);
    }
  }, [projectName, domain]);

  useEffect(() => {
    if (active) loadData();
  }, [active, loadData]);

  useEffect(() => {
    if (addTriggerRef) {
      addTriggerRef.current = () => { setEditingPref(null); setShowForm(true); };
    }
    return () => { if (addTriggerRef) addTriggerRef.current = null; };
  }, [addTriggerRef]);

  const handleAdd = async (data) => {
    try {
      const source = editingPref?._prefill ? 'natural_language' : 'user_defined';
      await window.ipm?.preferences?.add?.(projectName, { ...data, source }, { domain });
      setShowForm(false);
      setEditingPref(null);
      loadData();
    } catch (e) {
      console.error('Failed to add preference', e);
    }
  };

  const handleUpdate = async (data) => {
    if (!editingPref) return;
    try {
      await window.ipm?.preferences?.update?.(projectName, editingPref.id, data, { domain });
      setEditingPref(null);
      setShowForm(false);
      loadData();
    } catch (e) {
      console.error('Failed to update preference', e);
    }
  };

  const handleToggle = async (prefId, enabled) => {
    try {
      await window.ipm?.preferences?.update?.(projectName, prefId, { enabled }, { domain });
      loadData();
    } catch (e) {
      console.error('Failed to toggle preference', e);
    }
  };

  const handleDelete = async (prefId) => {
    try {
      await window.ipm?.preferences?.delete?.(projectName, prefId, { domain });
      loadData();
    } catch (e) {
      console.error('Failed to delete preference', e);
    }
  };

  const handleEdit = (pref) => {
    setEditingPref(pref);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingPref(null);
  };

  const handleNlParse = async () => {
    if (!nlText.trim() || nlParsing) return;
    setNlParsing(true);
    setNlError('');
    setNlResult(null);
    try {
      const res = await window.ipm?.preferences?.parseNaturalLanguage?.(projectName, nlText.trim(), { domain });
      if (res?.ok && res.result) {
        setNlResult(res.result);
      } else {
        setNlError(res?.error || '解析失败，请重试');
      }
    } catch (e) {
      setNlError(e?.message || '解析请求失败');
    } finally {
      setNlParsing(false);
    }
  };

  const handleNlConfirm = async () => {
    if (!nlResult) return;
    try {
      await window.ipm?.preferences?.add?.(projectName, {
        pattern: nlResult.pattern,
        conditions: nlResult.conditions,
        tendency: nlResult.tendency,
        source: 'natural_language',
      }, { domain });
      setNlResult(null);
      setNlText('');
      loadData();
    } catch (e) {
      console.error('Failed to add NL preference', e);
    }
  };

  const handleNlEditThenAdd = () => {
    if (!nlResult) return;
    const prefill = {
      pattern: nlResult.pattern,
      conditions: nlResult.conditions,
      tendency: nlResult.tendency,
      source: 'natural_language',
      _prefill: true,
    };
    setEditingPref(prefill);
    setShowForm(true);
    setNlResult(null);
    setNlText('');
  };

  const handleNlCancel = () => {
    setNlResult(null);
    setNlError('');
  };

  if (!active) return null;

  return (
    <div className="flex flex-col h-full">
      {/* NL input area */}
      <div className="px-4 pt-4 pb-2 border-b border-slate-100">
        <div className="flex items-start gap-2">
          <textarea
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40 bg-white resize-none"
            placeholder="用自然语言描述偏好，例如：来自微信的 PDF 通常放到「外部资料」文件夹..."
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            rows={2}
            disabled={nlParsing}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleNlParse();
              }
            }}
          />
          <button
            type="button"
            onClick={handleNlParse}
            disabled={!nlText.trim() || nlParsing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
          >
            {nlParsing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            AI 解析
          </button>
        </div>
        {nlError && (
          <div className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {nlError}
          </div>
        )}
      </div>

      {/* NL preview card */}
      {nlResult && (
        <NLPreviewCard
          result={nlResult}
          onConfirm={handleNlConfirm}
          onEditThenAdd={handleNlEditThenAdd}
          onCancel={handleNlCancel}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">加载中...</div>
        ) : prefs.length === 0 && !showForm ? (
          <div className="px-5 py-10 text-center">
            <Brain size={28} className="mx-auto text-slate-300 mb-2" />
            <div className="text-sm text-slate-500">暂无软偏好</div>
            <div className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
              添加偏好后，AI 分类时会参考这些倾向信号来辅助判断。
              偏好不是硬规则，AI 会综合考虑后做出最终决策。
            </div>
          </div>
        ) : (
          <div>
            {prefs.map((p) => (
              <PrefRow key={p.id} pref={p} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {showForm ? (
          <PrefForm
            folders={folders}
            initial={editingPref}
            onSave={editingPref && !editingPref._prefill ? handleUpdate : handleAdd}
            onCancel={handleCancelForm}
          />
        ) : null}
      </div>

      {!showForm && !embedded ? (
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <div className="text-[11px] text-slate-400">{prefs.length} 条偏好</div>
          <button
            type="button"
            onClick={() => {
              setEditingPref(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] font-medium"
          >
            <Plus size={13} />
            手动添加
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default PreferencesPanel;
