import React, { useState, useCallback, useEffect } from 'react';
import {
  ArrowRight,
  Check,
  X,
  FolderPlus,
  FileEdit,
  MoveRight,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

const ACTION_ICONS = {
  move: MoveRight,
  rename: FileEdit,
  create_folder: FolderPlus,
  update_description: FileText,
};

const ACTION_LABELS = {
  move: '移动',
  rename: '重命名',
  create_folder: '创建文件夹',
  update_description: '更新描述',
};

function OperationRow({ op, index, checked, onToggle, result, executed }) {
  const Icon = ACTION_ICONS[op.action] || FileText;
  const label = ACTION_LABELS[op.action] || op.action;

  return (
    <label
      className={`flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors ${
        executed
          ? result?.success ? 'bg-emerald-50' : 'bg-red-50'
          : checked ? 'bg-blue-50' : 'bg-slate-50 hover:bg-slate-100'
      } ${executed ? 'cursor-default' : 'cursor-pointer'}`}
    >
      {!executed && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(index)}
          className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
      )}
      {executed && (
        result?.success
          ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-500 flex-shrink-0" />
          : <XCircle size={16} className="mt-0.5 text-red-500 flex-shrink-0" />
      )}
      <Icon size={14} className="mt-0.5 text-slate-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {op.action === 'move' && (
          <div className="text-sm text-slate-700 flex items-center gap-1 flex-wrap">
            <span className="truncate max-w-[120px]" title={op.from}>{op.from}</span>
            <ArrowRight size={12} className="text-slate-400 flex-shrink-0" />
            <span className="truncate max-w-[120px] text-blue-600" title={op.to}>{op.to}</span>
          </div>
        )}
        {op.action === 'rename' && (
          <div className="text-sm text-slate-700 flex items-center gap-1 flex-wrap">
            <span className="truncate max-w-[120px]" title={op.target}>{op.target}</span>
            <ArrowRight size={12} className="text-slate-400 flex-shrink-0" />
            <span className="text-blue-600">{op.newName}</span>
          </div>
        )}
        {op.action === 'create_folder' && (
          <div className="text-sm text-slate-700">
            <span className="text-blue-600">{op.path}</span>
            {op.description && <span className="text-slate-400 text-xs ml-1">({op.description})</span>}
          </div>
        )}
        {op.action === 'update_description' && (
          <div className="text-sm text-slate-700">
            <span>{op.folder}</span>
            <span className="text-slate-400 text-xs ml-1">→ {op.description}</span>
          </div>
        )}
        {executed && result && !result.success && (
          <div className="text-xs text-red-500 mt-0.5">{result.error}</div>
        )}
      </div>
    </label>
  );
}

const ActionPlanCard = ({ plan, onExecute, onCancel, executed }) => {
  const ops = plan?.operations || [];
  const [checkedSet, setCheckedSet] = useState(() => new Set(ops.map((_, i) => i)));
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    const nextOps = plan?.operations || [];
    setCheckedSet(new Set(nextOps.map((_, i) => i)));
    setResults(null);
  }, [plan]);

  const toggleCheck = useCallback((index) => {
    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleExecute = useCallback(async () => {
    if (executing || !onExecute) return;
    setExecuting(true);
    try {
      const selectedIndices = [...checkedSet].sort((a, b) => a - b);
      const result = await onExecute(plan, selectedIndices);
      if (result?.details) {
        setResults(result.details);
      }
    } finally {
      setExecuting(false);
    }
  }, [executing, onExecute, plan, checkedSet]);

  const isCompleted = !!results || executed;

  return (
    <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
        <FileText size={14} className="text-amber-600" />
        <span className="text-sm font-medium text-amber-800">
          {isCompleted ? '执行结果' : '操作计划'}
        </span>
        <span className="text-xs text-amber-600 ml-auto">{ops.length} 项操作</span>
      </div>

      {plan?.description && (
        <div className="px-4 py-2 text-sm text-slate-600 border-b border-slate-100">
          {plan.description}
        </div>
      )}

      <div className="px-2 py-2 space-y-1">
        {ops.map((op, i) => (
          <OperationRow
            key={i}
            op={op}
            index={i}
            checked={checkedSet.has(i)}
            onToggle={toggleCheck}
            result={results?.[i]}
            executed={isCompleted}
          />
        ))}
      </div>

      {!isCompleted && (
        <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={executing}
              className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <X size={12} className="inline mr-1" />
              取消
            </button>
          )}
          <button
            type="button"
            onClick={handleExecute}
            disabled={executing || checkedSet.size === 0}
            className="px-4 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {executing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                执行中...
              </>
            ) : (
              <>
                <Check size={12} />
                确认执行 ({checkedSet.size}/{ops.length})
              </>
            )}
          </button>
        </div>
      )}

      {results && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
          <div className="text-xs text-slate-500">
            {results.filter((r) => r?.success).length} 项成功
            {results.filter((r) => r && !r.success).length > 0 &&
              `，${results.filter((r) => r && !r.success).length} 项失败`
            }
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionPlanCard;
