import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, ClipboardCopy, Check, Loader2,
  Sparkles, Search, FolderTree, History, Code2, X, Zap, File,
} from 'lucide-react';

const TOOL_LABELS = {
  browse_project_structure: '浏览项目文件夹结构',
  browse_structure: '浏览项目文件夹结构',
  query_classification_history: '查询分类历史',
  query_history: '查询分类历史',
  inspect_folder_contents: '查看文件夹内容',
  inspect_folder: '查看文件夹内容',
  get_file_source_info: '获取文件来源信息',
  get_source_info: '获取文件来源信息',
  get_user_rules: '获取用户自定义规则',
  get_preferences: '获取软偏好',
};

const TOOL_ICONS = {
  browse_project_structure: FolderTree,
  browse_structure: FolderTree,
  query_classification_history: History,
  query_history: History,
  inspect_folder_contents: Search,
  inspect_folder: Search,
  get_file_source_info: Search,
  get_source_info: Search,
  get_user_rules: Code2,
  get_preferences: Code2,
};

function toolLabel(name) {
  return TOOL_LABELS[name] || name;
}

function getToolIcon(name) {
  const Icon = TOOL_ICONS[name] || Code2;
  return <Icon size={12} strokeWidth={2} />;
}

function confidenceColor(c) {
  if (c >= 0.85) return 'text-emerald-600';
  if (c >= 0.5) return 'text-amber-600';
  return 'text-rose-500';
}

function confidenceBgColor(c) {
  if (c >= 0.85) return 'bg-emerald-500';
  if (c >= 0.5) return 'bg-amber-500';
  return 'bg-rose-500';
}

function classifiedByLabel(cb) {
  if (cb === 'fast-path') return '快速通道（内置规则）';
  if (cb === 'fast-path-user-rule') return '快速通道（用户规则）';
  if (cb === 'agent') return 'AI Agent（智能分析）';
  return cb || '未知';
}

function tryParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function checkHasUserFeedback(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed.some((item) => item.userFeedback);
  } catch { /* ignore */ }
  return false;
}

/* ── Data display helpers ── */

function HistoryItemCard({ item }) {
  const statusLabel = item.status === 'accepted' ? '已接受' : item.status === 'rejected' ? '已拒绝' : '待处理';
  const statusColor = item.status === 'accepted'
    ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700'
    : item.status === 'rejected'
      ? 'border-rose-200 bg-rose-50/50 text-rose-600'
      : 'border-gray-200 bg-gray-50/50 text-gray-500';

  return (
    <div className={`p-2.5 rounded-lg border ${statusColor} text-xs space-y-1`}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700">{item.fileName || '(unknown)'}</span>
        <span className="text-[10px] font-medium">{statusLabel}</span>
      </div>
      <div className="text-gray-500">
        <span className="text-gray-400">建议 →</span> {item.suggestedFolder || '(无)'}
        {item.actualFolder && item.actualFolder !== item.suggestedFolder && (
          <span className="ml-1">
            <span className="text-gray-400">实际 →</span>{' '}
            <span className="text-emerald-600 font-medium">{item.actualFolder}</span>
          </span>
        )}
      </div>
      {item.rationale && (
        <div className="text-gray-500">
          <span className="text-gray-400">理由：</span>{item.rationale}
        </div>
      )}
      {item.userFeedback && (
        <div className="mt-1 p-1.5 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-[11px]">
          <span className="font-semibold">用户反馈：</span>{item.userFeedback}
        </div>
      )}
    </div>
  );
}

function ToolResultContent({ content, toolName }) {
  const parsed = tryParseJson(content);

  if (toolName === 'query_history' && Array.isArray(parsed)) {
    if (!parsed.length) return <div className="text-xs text-gray-400 italic">无匹配的分类历史</div>;
    return (
      <div className="space-y-2">
        {parsed.map((item, i) => <HistoryItemCard key={i} item={item} />)}
      </div>
    );
  }

  if (toolName === 'get_preferences' && Array.isArray(parsed)) {
    if (!parsed.length) return <div className="text-xs text-gray-400 italic">无匹配的软偏好</div>;
    return (
      <div className="space-y-1.5">
        {parsed.map((p, i) => (
          <div key={i} className="p-2 rounded-lg border border-indigo-100 bg-indigo-50/40 text-xs">
            <div className="text-gray-700"><span className="text-gray-400">偏好：</span>{p.pattern || '(无描述)'}</div>
            <div className="text-gray-600">
              <span className="text-gray-400">目标 →</span> {p.folder || '(无)'}
              <span className="ml-2 text-gray-400">强度：</span>
              <span className={p.strength >= 0.7 ? 'text-indigo-600 font-semibold' : 'text-gray-500'}>{p.strength}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (Array.isArray(parsed)) {
    return (
      <div className="space-y-1">
        {parsed.map((item, i) => (
          <div key={i} className="text-xs text-gray-600">
            {typeof item === 'object' ? (
              <span>
                {item.relPath || item.name || item.fileName || ''}
                {item.description ? <span className="text-gray-400"> — {item.description}</span> : null}
                {typeof item.fileCount === 'number' ? <span className="text-gray-400"> ({item.fileCount} 个文件)</span> : null}
              </span>
            ) : String(item)}
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
            <span className="text-gray-400">{k}:</span>{' '}
            <span className="text-gray-600">{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}</span>
          </div>
        ))}
      </div>
    );
  }

  return <div className="text-xs text-gray-600 whitespace-pre-wrap break-all">{content || '（无内容）'}</div>;
}

/* ── Expandable result (replaces old CollapsibleResult) ── */

function ExpandableResult({ content, toolName, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        返回数据
      </button>
      {open && (
        <div className="mt-2 p-3 bg-white border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
          <ToolResultContent content={content} toolName={toolName} />
        </div>
      )}
    </div>
  );
}

/* ── Merge tool-call + tool-result into unified steps ── */

function groupTraceStepsMerged(trace) {
  if (!Array.isArray(trace)) return [];
  const merged = [];
  let toolNum = 0;
  for (let i = 0; i < trace.length; i++) {
    const s = trace[i];
    if (s.type === 'tool-call') {
      toolNum++;
      const next = trace[i + 1];
      if (next?.type === 'tool-result' && next.name === s.name) {
        merged.push({ type: 'tool-pair', call: s, result: next, toolNum });
        i++;
      } else {
        merged.push({ ...s, toolNum });
      }
    } else {
      merged.push(s);
    }
  }
  return merged;
}

/* ── Step node (timeline item) ── */

function StepNode({ step, animDelay }) {
  const style = { animation: `traceStepIn 0.4s ease-out ${animDelay}ms both` };

  if (step.type === 'fast-path') {
    return (
      <div className="flex items-start gap-4" style={style}>
        <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-200/60 flex items-center justify-center shrink-0 z-10 mt-0.5">
          <Zap size={14} className="text-amber-500" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="text-sm font-medium text-amber-700 mb-2">快速通道匹配</div>
          <div className="p-3.5 bg-amber-50/50 border border-amber-100 rounded-xl space-y-1">
            <div className="text-xs text-gray-600">
              <span className="text-gray-400">规则：</span>{step.rule}
            </div>
            <div className="text-xs text-gray-600">
              <span className="text-gray-400">目标：</span>
              <span className="font-medium text-gray-800">{step.target}</span>
            </div>
            {step.rationale && (
              <div className="text-xs text-gray-500 pt-0.5">{step.rationale}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step.type === 'fast-path-user-rule') {
    return (
      <div className="flex items-start gap-4" style={style}>
        <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200/60 flex items-center justify-center shrink-0 z-10 mt-0.5">
          <Zap size={14} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="text-sm font-medium text-blue-700 mb-2">用户规则匹配</div>
          <div className="p-3.5 bg-blue-50/50 border border-blue-100 rounded-xl space-y-1">
            {step.ruleLabel && (
              <div className="text-xs text-gray-600">
                <span className="text-gray-400">规则：</span>{step.ruleLabel}
              </div>
            )}
            <div className="text-xs text-gray-600">
              <span className="text-gray-400">目标：</span>
              <span className="font-medium text-gray-800">{step.target}</span>
            </div>
            {step.rationale && (
              <div className="text-xs text-gray-500 pt-0.5">{step.rationale}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step.type === 'reasoning') {
    return (
      <div className="flex items-start gap-4" style={style}>
        <div className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center shrink-0 z-10 mt-0.5">
          <Sparkles size={14} className="text-gray-400" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0 pt-1.5">
          <div className="text-sm text-gray-600 leading-relaxed">
            <span className="text-gray-400 font-medium mr-1.5">思考中...</span>
            &ldquo;{step.content}&rdquo;
          </div>
        </div>
      </div>
    );
  }

  if (step.type === 'tool-pair') {
    const hasUF = step.result.name === 'query_history' && checkHasUserFeedback(step.result.content);
    return (
      <div className="flex items-start gap-4" style={style}>
        <div className="w-8 h-8 flex items-center justify-center shrink-0 z-10">
          {/* timeline passes through */}
        </div>
        <div className="flex-1 bg-gray-50/80 border border-gray-100 rounded-xl p-3.5">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-500 uppercase tracking-wider">
            {getToolIcon(step.call.name)}
            <span>{step.call.name}</span>
            {hasUF && (
              <span className="text-amber-600 font-sans normal-case tracking-normal font-semibold text-[11px]">
                含用户反馈
              </span>
            )}
          </div>
          <div className="text-sm text-gray-700 font-medium mt-1.5">
            {toolLabel(step.call.name)}
          </div>
          {step.call.args && Object.keys(step.call.args).length > 0 && (
            <div className="mt-1 text-xs text-gray-400 font-mono break-all">
              {JSON.stringify(step.call.args)}
            </div>
          )}
          <ExpandableResult
            content={step.result.content}
            toolName={step.result.name}
            defaultOpen={hasUF}
          />
        </div>
      </div>
    );
  }

  if (step.type === 'tool-call') {
    return (
      <div className="flex items-start gap-4" style={style}>
        <div className="w-8 h-8 flex items-center justify-center shrink-0 z-10" />
        <div className="flex-1 bg-gray-50/80 border border-gray-100 rounded-xl p-3.5">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-500 uppercase tracking-wider">
            {getToolIcon(step.name)}
            <span>{step.name}</span>
          </div>
          <div className="text-sm text-gray-700 font-medium mt-1.5">
            {toolLabel(step.name)}
          </div>
          {step.args && Object.keys(step.args).length > 0 && (
            <div className="mt-1 text-xs text-gray-400 font-mono break-all">
              {JSON.stringify(step.args)}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step.type === 'tool-result') {
    const hasUF = step.name === 'query_history' && checkHasUserFeedback(step.content);
    return (
      <div className="flex items-start gap-4" style={style}>
        <div className="w-8 h-8 flex items-center justify-center shrink-0 z-10" />
        <div className="flex-1 min-w-0">
          <ExpandableResult content={step.content} toolName={step.name} defaultOpen={hasUF} />
        </div>
      </div>
    );
  }

  return null;
}

/* ── Copy text builder ── */

function buildCopyText(suggestion, trace) {
  const lines = [];
  lines.push('=== AI 分类过程 ===');
  if (suggestion) {
    lines.push(`文件: ${suggestion.fileName || ''}`);
    lines.push(`目标文件夹: ${suggestion.suggestedFolderRelPath || ''}`);
    lines.push(`置信度: ${Math.round((suggestion.confidence ?? 0) * 100)}%`);
    lines.push(`分类方式: ${classifiedByLabel(suggestion.classifiedBy)}`);
    if (suggestion.rationale) lines.push(`理由: ${suggestion.rationale}`);
    lines.push('');
  }

  if (!trace?.length) return lines.join('\n');

  lines.push('=== 推理过程 ===');
  let stepNum = 0;
  for (const step of trace) {
    if (step.type === 'reasoning') {
      lines.push(`\n[AI 推理]`);
      lines.push(step.content);
    } else if (step.type === 'tool-call') {
      stepNum++;
      lines.push(`\n[Step ${stepNum}] 调用工具: ${step.name}`);
      if (step.args && Object.keys(step.args).length > 0) {
        lines.push(`参数: ${JSON.stringify(step.args)}`);
      }
    } else if (step.type === 'tool-result') {
      lines.push(`[${step.name} 返回数据]`);
      try {
        const parsed = JSON.parse(step.content);
        lines.push(JSON.stringify(parsed, null, 2));
      } catch {
        lines.push(step.content || '(空)');
      }
    } else if (step.type === 'fast-path' || step.type === 'fast-path-user-rule') {
      lines.push(`\n[快速通道] ${step.type}`);
      if (step.rule || step.ruleLabel) lines.push(`规则: ${step.ruleLabel || step.rule}`);
      lines.push(`目标: ${step.target}`);
      if (step.rationale) lines.push(`理由: ${step.rationale}`);
    }
  }

  return lines.join('\n');
}

/* ── Main component ── */

const ClassifyTraceView = ({ open, loading, data, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const suggestion = data?.suggestion;
  const trace = data?.trace || [];
  const error = data?.error;
  const merged = groupTraceStepsMerged(trace);
  const toolCount = trace.filter((s) => s.type === 'tool-call').length;
  const isFastPath = trace.length > 0 && (trace[0].type === 'fast-path' || trace[0].type === 'fast-path-user-rule');
  const pct = Math.round((suggestion?.confidence ?? 0) * 100);

  const handleCopy = async () => {
    const text = buildCopyText(suggestion, trace);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-[2px]" onClick={onClose}>
      <style>{`
        @keyframes traceModalIn {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes traceStepIn {
          from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
          to   { opacity: 1; transform: translateY(0); filter: blur(0px); }
        }
        @keyframes traceBarGrow {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
      `}</style>
      <div
        className="w-[640px] max-h-[85vh] bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col font-sans selection:bg-gray-100"
        style={{ animation: 'traceModalIn 0.3s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Sparkles size={14} className="text-gray-500" strokeWidth={1.5} />
            </div>
            <span className="text-sm font-semibold text-gray-800 truncate">
              AI 分类过程
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {!loading && !error && suggestion && (
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  copied ? 'bg-emerald-50 text-emerald-600' : 'hover:bg-gray-100 text-gray-400'
                }`}
                onClick={handleCopy}
                title="复制完整思考过程"
              >
                {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                {copied ? '已复制' : '复制'}
              </button>
            )}
            <button
              type="button"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              onClick={onClose}
            >
              <X size={16} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2.5 text-sm">
              <Loader2 size={16} className="animate-spin" /> 加载中...
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-sm">
              {error}
            </div>
          )}

          {/* Content */}
          {!loading && !error && suggestion && (
            <>
              {/* ── Summary card ── */}
              <div
                className="mb-8 p-5 bg-gray-50 border border-gray-100 rounded-2xl"
                style={{ animation: 'traceStepIn 0.4s ease-out both' }}
              >
                {/* File info */}
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200/60">
                  <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center shrink-0">
                    <File size={18} className="text-gray-400" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-800 truncate">
                      {suggestion.fileName || '未知文件'}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {classifiedByLabel(suggestion.classifiedBy)}
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">目标文件夹</span>
                    <span className="text-sm font-medium text-gray-800">
                      {suggestion.suggestedFolderRelPath || '-'}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-400">置信度</span>
                      <span className={`text-sm font-semibold tabular-nums ${confidenceColor(suggestion.confidence)}`}>
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${confidenceBgColor(suggestion.confidence)}`}
                        style={{
                          width: `${pct}%`,
                          transformOrigin: 'left',
                          animation: 'traceBarGrow 0.6s ease-out 0.15s both',
                        }}
                      />
                    </div>
                  </div>

                  {!isFastPath && toolCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">工具调用</span>
                      <span className="text-xs text-gray-500 tabular-nums">{toolCount} 次</span>
                    </div>
                  )}
                </div>

                {/* Rationale */}
                {suggestion.rationale && (
                  <div className="mt-4 pt-3 border-t border-gray-200/60">
                    <div className="text-xs text-gray-500 leading-relaxed">
                      {suggestion.rationale}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Trace timeline ── */}
              {merged.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">
                    推理过程
                  </div>
                  <div className="relative">
                    {/* Continuous vertical line */}
                    <div className="absolute left-[15.5px] top-4 bottom-4 w-px bg-gray-100" />

                    <div className="flex flex-col gap-6">
                      {merged.map((step, i) => (
                        <StepNode
                          key={`${step.type}-${i}`}
                          step={step}
                          animDelay={80 + i * 60}
                        />
                      ))}

                      {/* Terminal node */}
                      <div
                        className="flex items-center gap-4 mt-2 pt-4 border-t border-gray-100"
                        style={{
                          animation: `traceStepIn 0.4s ease-out ${80 + merged.length * 60}ms both`,
                        }}
                      >
                        <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center shrink-0 z-10 shadow-md">
                          <Check size={14} className="text-white" strokeWidth={2.5} />
                        </div>
                        <span className="text-sm text-gray-800 font-medium">分类完成</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {merged.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-12">
                  暂无推理过程数据（可能是早期分类，未记录 trace）
                </div>
              )}
            </>
          )}

          {/* No data */}
          {!loading && !error && !suggestion && (
            <div className="text-center text-sm text-gray-400 py-12">
              未找到该文件的分类记录
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassifyTraceView;
