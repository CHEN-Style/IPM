import React, { useCallback, useEffect, useState } from 'react';
import { GripVertical, Pencil, Plus, ShieldCheck, ToggleLeft, ToggleRight, Trash2, X, Zap } from 'lucide-react';

const EMPTY_FORM = {
  label: '',
  targetFolder: '',
  nameIncludes: '',
  nameExcludes: '',
  exts: '',
  sourceIncludes: '',
  sourceExcludes: '',
  confidence: 0.95,
};

function splitTags(str) {
  return String(str || '')
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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

function RuleRow({ rule, onToggle, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 group hover:bg-slate-50/60 transition-colors">
      <GripVertical size={14} className="text-slate-300 flex-shrink-0 cursor-grab" />
      <button
        type="button"
        onClick={() => onToggle(rule.id, !rule.enabled)}
        className="flex-shrink-0"
        title={rule.enabled ? '点击禁用' : '点击启用'}
      >
        {rule.enabled ? (
          <ToggleRight size={20} className="text-emerald-500" />
        ) : (
          <ToggleLeft size={20} className="text-slate-300" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${rule.enabled ? 'text-slate-800' : 'text-slate-400'}`}>
            {rule.label || '未命名规则'}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eceef7] text-[#3e4b9c] font-medium flex-shrink-0">
            {rule.targetFolder}
          </span>
          {rule.source === 'promoted' ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium flex-shrink-0">
              自动提升
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-slate-400 truncate mt-0.5">{conditionSummary(rule.conditions)}</div>
      </div>
      <div className="text-[11px] text-slate-400 flex-shrink-0 tabular-nums" title="命中次数">
        {rule.hitCount || 0} 次
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button type="button" onClick={() => onEdit(rule)} className="p-1 rounded hover:bg-slate-200" title="编辑">
          <Pencil size={13} className="text-slate-500" />
        </button>
        <button type="button" onClick={() => onDelete(rule.id)} className="p-1 rounded hover:bg-red-100" title="删除">
          <Trash2 size={13} className="text-red-400" />
        </button>
      </div>
    </div>
  );
}

function RuleForm({ folders, initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    if (!initial) return { ...EMPTY_FORM };
    const c = initial.conditions || {};
    return {
      label: initial.label || '',
      targetFolder: initial.targetFolder || '',
      nameIncludes: (c.nameIncludes || []).join(', '),
      nameExcludes: (c.nameExcludes || []).join(', '),
      exts: (c.exts || []).join(', '),
      sourceIncludes: (c.sourceIncludes || []).join(', '),
      sourceExcludes: (c.sourceExcludes || []).join(', '),
      confidence: initial.confidence ?? 0.95,
    };
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.targetFolder) return;
    const ni = splitTags(form.nameIncludes);
    const ne = splitTags(form.nameExcludes);
    const ex = splitTags(form.exts);
    const si = splitTags(form.sourceIncludes);
    const se = splitTags(form.sourceExcludes);
    if (!ni.length && !ex.length && !si.length) return;
    onSave({
      label: form.label.trim() || [ni.length ? `名含 ${ni.join('/')}` : '', `→ ${form.targetFolder}`].filter(Boolean).join(' '),
      targetFolder: form.targetFolder,
      conditions: {
        nameIncludes: ni,
        nameExcludes: ne,
        exts: ex,
        sourceIncludes: si,
        sourceExcludes: se,
      },
      confidence: Number(form.confidence) || 0.95,
    });
  };

  const inputCls =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40 bg-white';
  const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 border-t border-slate-200 bg-slate-50/60 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>规则名称</label>
          <input className={inputCls} placeholder="如：草稿类归过程文档" value={form.label} onChange={(e) => set('label', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>
            目标文件夹 <span className="text-red-400">*</span>
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
      </div>

      <div>
        <label className={labelCls}>
          文件名包含关键词 <span className="text-slate-400 font-normal">（逗号分隔，满足任一即命中）</span>
        </label>
        <input className={inputCls} placeholder="如：草稿, 修改意见, v2" value={form.nameIncludes} onChange={(e) => set('nameIncludes', e.target.value)} />
      </div>

      <div>
        <label className={labelCls}>
          文件名排除关键词 <span className="text-slate-400 font-normal">（含这些词时跳过此规则）</span>
        </label>
        <input className={inputCls} placeholder="如：终版, 定稿" value={form.nameExcludes} onChange={(e) => set('nameExcludes', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>
            扩展名 <span className="text-slate-400 font-normal">（空 = 不限）</span>
          </label>
          <input className={inputCls} placeholder="如：docx, pdf" value={form.exts} onChange={(e) => set('exts', e.target.value)} />
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
          {initial ? '保存修改' : '添加规则'}
        </button>
      </div>
    </form>
  );
}

const ClassifyRulesPanel = ({ projectName, domain, open, onClose, embedded = false }) => {
  const [rules, setRules] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  const active = embedded || open;

  const loadData = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const [rulesRes, explorerRes] = await Promise.all([
        window.ipm?.classifyRules?.list?.(projectName, { domain }),
        window.ipm?.explorer?.list?.(projectName, '', { domain }),
      ]);
      setRules(Array.isArray(rulesRes?.rules) ? rulesRes.rules : []);
      const entries = Array.isArray(explorerRes?.entries) ? explorerRes.entries : [];
      const SYSTEM_DIRS = new Set(['meta', 'temp', 'snippets']);
      setFolders(
        entries
          .filter((e) => e.kind === 'dir' && !SYSTEM_DIRS.has(e.name))
          .map((e) => ({ relPath: e.relPath || e.name, name: e.name, description: e.description || '' })),
      );
    } catch (e) {
      console.error('Failed to load rules/folders', e);
    } finally {
      setLoading(false);
    }
  }, [projectName, domain]);

  useEffect(() => {
    if (active) loadData();
  }, [active, loadData]);

  const handleAdd = async (data) => {
    try {
      await window.ipm?.classifyRules?.add?.(projectName, data, { domain });
      setShowForm(false);
      loadData();
    } catch (e) {
      console.error('Failed to add rule', e);
    }
  };

  const handleUpdate = async (data) => {
    if (!editingRule) return;
    try {
      await window.ipm?.classifyRules?.update?.(projectName, editingRule.id, data, { domain });
      setEditingRule(null);
      setShowForm(false);
      loadData();
    } catch (e) {
      console.error('Failed to update rule', e);
    }
  };

  const handleToggle = async (ruleId, enabled) => {
    try {
      await window.ipm?.classifyRules?.update?.(projectName, ruleId, { enabled }, { domain });
      loadData();
    } catch (e) {
      console.error('Failed to toggle rule', e);
    }
  };

  const handleDelete = async (ruleId) => {
    try {
      await window.ipm?.classifyRules?.delete?.(projectName, ruleId, { domain });
      loadData();
    } catch (e) {
      console.error('Failed to delete rule', e);
    }
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingRule(null);
  };

  if (!active) return null;

  const content = (
    <>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">加载中...</div>
        ) : rules.length === 0 && !showForm ? (
          <div className="px-5 py-10 text-center">
            <Zap size={28} className="mx-auto text-slate-300 mb-2" />
            <div className="text-sm text-slate-500">暂无自定义规则</div>
            <div className="text-[11px] text-slate-400 mt-1">添加规则后，符合条件的文件将自动快速分类</div>
          </div>
        ) : (
          <div>
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {showForm ? (
          <RuleForm
            folders={folders}
            initial={editingRule}
            onSave={editingRule ? handleUpdate : handleAdd}
            onCancel={handleCancelForm}
          />
        ) : null}
      </div>

      {!showForm ? (
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <div className="text-[11px] text-slate-400">{rules.length} 条规则</div>
          <button
            type="button"
            onClick={() => {
              setEditingRule(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] font-medium"
          >
            <Plus size={13} />
            添加规则
          </button>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="flex flex-col h-full">{content}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#eceef7] border border-[#d8dbed]">
              <ShieldCheck size={16} className="text-[#3e4b9c]" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">分类规则管理</div>
              <div className="text-[11px] text-slate-400">为当前项目配置快速通道规则，命中后跳过 AI 直接分类</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X size={16} className="text-slate-400" />
          </button>
        </div>
        {content}
      </div>
    </div>
  );
};

export default ClassifyRulesPanel;
