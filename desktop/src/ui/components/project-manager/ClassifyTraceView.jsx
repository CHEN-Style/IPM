import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, MessageSquare, Search, Wrench, X, Zap } from 'lucide-react';

const TOOL_LABELS = {
  browse_project_structure: '浏览项目文件夹结构',
  query_classification_history: '查询分类历史',
  inspect_folder_contents: '查看文件夹内容',
  get_file_source_info: '获取文件来源信息',
  get_user_rules: '获取用户自定义规则',
};

function toolLabel(name) {
  return TOOL_LABELS[name] || name;
}

function confidenceColor(c) {
  if (c >= 0.85) return 'text-emerald-600';
  if (c >= 0.5) return 'text-amber-600';
  return 'text-rose-500';
}

function confidenceBar(c) {
  const pct = Math.round((c ?? 0) * 100);
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function classifiedByLabel(cb) {
  if (cb === 'fast-path') return '快速通道（规则匹配）';
  if (cb === 'agent') return 'AI Agent（智能分析）';
  return cb || '未知';
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function ToolResultContent({ content }) {
  const parsed = tryParseJson(content);
  if (Array.isArray(parsed)) {
    return (
      <div className="space-y-1">
        {parsed.map((item, i) => (
          <div key={i} className="text-xs text-slate-600">
            {typeof item === 'object' ? (
              <span>
                {item.relPath || item.name || item.fileName || ''}
                {item.description ? <span className="text-slate-400"> — {item.description}</span> : null}
                {typeof item.fileCount === 'number' ? <span className="text-slate-400"> ({item.fileCount} 个文件)</span> : null}
                {item.userAction ? <span className={`ml-1 ${item.userAction === 'accepted' ? 'text-emerald-500' : 'text-rose-400'}`}>({item.userAction === 'accepted' ? '已接受' : '已拒绝'})</span> : null}
                {item.classifiedTo ? <span className="text-slate-400"> → {item.classifiedTo}</span> : null}
              </span>
            ) : (
              String(item)
            )}
          </div>
        ))}
      </div>
    );
  }
  if (parsed && typeof parsed === 'object') {
    return (
      <div className="space-y-0.5">
        {Object.entries(parsed).map(([k, v]) => (
          <div key={k} className="text-xs">
            <span className="text-slate-400">{k}:</span>{' '}
            <span className="text-slate-600">{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}</span>
          </div>
        ))}
      </div>
    );
  }
  return <div className="text-xs text-slate-600 whitespace-pre-wrap break-all">{content || '（无内容）'}</div>;
}

function CollapsibleResult({ content }) {
  const [open, setOpen] = useState(false);
  const isLong = (content || '').length > 200;

  return (
    <div className="mt-1.5 ml-6 border-l-2 border-slate-200 pl-3">
      <button
        type="button"
        className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        返回结果
      </button>
      {(open || !isLong) && (
        <div className="mt-1 p-2 bg-slate-50 rounded text-xs max-h-60 overflow-y-auto">
          <ToolResultContent content={content} />
        </div>
      )}
    </div>
  );
}

function TraceStepNode({ step, index }) {
  if (step.type === 'fast-path') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Zap size={14} className="text-amber-600" />
          </div>
          <div className="w-px flex-1 bg-slate-200" />
        </div>
        <div className="pb-5 flex-1 min-w-0">
          <div className="text-xs font-semibold text-amber-700">快速通道匹配</div>
          <div className="mt-1 p-2.5 bg-amber-50/60 rounded border border-amber-100">
            <div className="text-xs text-slate-600">
              <span className="text-slate-400">规则：</span>{step.rule}
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              <span className="text-slate-400">目标：</span>{step.target}
            </div>
            {step.rationale && (
              <div className="text-xs text-slate-500 mt-0.5">{step.rationale}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step.type === 'tool-call') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Wrench size={14} className="text-blue-600" />
          </div>
          <div className="w-px flex-1 bg-slate-200" />
        </div>
        <div className="pb-1 flex-1 min-w-0">
          <div className="text-xs font-semibold text-blue-700">
            Step {index + 1} &middot; {toolLabel(step.name)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 font-mono">{step.name}</div>
          {step.args && Object.keys(step.args).length > 0 && (
            <div className="mt-1 text-xs text-slate-500">
              参数：{JSON.stringify(step.args)}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step.type === 'tool-result') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Search size={14} className="text-slate-400" />
          </div>
          <div className="w-px flex-1 bg-slate-200" />
        </div>
        <div className="pb-5 flex-1 min-w-0">
          <div className="text-xs font-medium text-slate-500">{toolLabel(step.name)} 返回</div>
          <CollapsibleResult content={step.content} />
        </div>
      </div>
    );
  }

  if (step.type === 'reasoning') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
            <MessageSquare size={14} className="text-violet-600" />
          </div>
          <div className="w-px flex-1 bg-slate-200" />
        </div>
        <div className="pb-5 flex-1 min-w-0">
          <div className="text-xs font-semibold text-violet-700">AI 推理</div>
          <div className="mt-1 p-2.5 bg-violet-50/50 rounded border border-violet-100 text-xs text-slate-700 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
            {step.content}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function groupTraceSteps(trace) {
  if (!Array.isArray(trace)) return [];
  const grouped = [];
  let stepIdx = 0;
  for (let i = 0; i < trace.length; i++) {
    const s = trace[i];
    if (s.type === 'tool-call') {
      const next = trace[i + 1];
      if (next?.type === 'tool-result' && next.name === s.name) {
        grouped.push({ ...s, _idx: stepIdx++ });
        grouped.push({ ...next, _idx: stepIdx });
        i += 1;
      } else {
        grouped.push({ ...s, _idx: stepIdx++ });
      }
    } else {
      grouped.push({ ...s, _idx: stepIdx++ });
    }
  }
  return grouped;
}

const ClassifyTraceView = ({ open, loading, data, onClose }) => {
  if (!open) return null;

  const suggestion = data?.suggestion;
  const trace = data?.trace || [];
  const error = data?.error;
  const grouped = groupTraceSteps(trace);
  const toolCallSteps = grouped.filter((s) => s.type === 'tool-call');
  const isFastPath = trace.length > 0 && trace[0].type === 'fast-path';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] bg-white rounded-xl border border-slate-200 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <Search size={16} className="text-slate-400 flex-shrink-0" />
            <div className="text-sm font-semibold text-slate-800 truncate">
              AI 分类过程{suggestion?.fileName ? `：${suggestion.fileName}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded hover:bg-slate-100 transition-colors"
            onClick={onClose}
          >
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> 加载中...
            </div>
          )}

          {error && !loading && (
            <div className="px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-600 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && suggestion && (
            <>
              {/* Summary card */}
              <div className="mb-5 p-4 bg-slate-50 rounded-lg border border-slate-100">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">结论</div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 flex-shrink-0">目标文件夹：</span>
                    <span className="font-medium text-slate-800">{suggestion.suggestedFolderRelPath || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 flex-shrink-0">置信度：</span>
                    <span className={`font-semibold ${confidenceColor(suggestion.confidence)}`}>
                      {Math.round((suggestion.confidence ?? 0) * 100)}%
                    </span>
                    <span className="font-mono text-[10px] text-slate-300 tracking-tighter">
                      {confidenceBar(suggestion.confidence)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 flex-shrink-0">分类方式：</span>
                    <span className="text-slate-700">{classifiedByLabel(suggestion.classifiedBy)}</span>
                    {!isFastPath && toolCallSteps.length > 0 && (
                      <span className="text-xs text-slate-400">（调用了 {toolCallSteps.length} 个工具）</span>
                    )}
                  </div>
                  {suggestion.rationale && (
                    <div className="flex gap-2 text-sm">
                      <span className="text-slate-400 flex-shrink-0">理由：</span>
                      <span className="text-slate-700">{suggestion.rationale}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Trace timeline */}
              {grouped.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">推理过程</div>
                  <div className="ml-1">
                    {grouped.map((step, i) => (
                      <TraceStepNode key={`${step.type}-${i}`} step={step} index={step._idx} />
                    ))}
                    {/* Terminal node */}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        </div>
                      </div>
                      <div className="flex items-center h-7">
                        <span className="text-xs font-semibold text-emerald-600">分类完成</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {grouped.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-8">
                  暂无推理过程数据（可能是早期分类，未记录 trace）
                </div>
              )}
            </>
          )}

          {!loading && !error && !suggestion && (
            <div className="text-center text-sm text-slate-400 py-8">
              未找到该文件的分类记录
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassifyTraceView;
