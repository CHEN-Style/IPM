// desktop/src/ui/components/knowclaw-v2/DelegateTaskResult.jsx
//
// E.4: structured rendering for delegate_task tool results.
//
// pi-runtime's delegate_task tool returns a JSON string with:
//   {
//     ok: boolean,
//     summary: string,                  // child agent's final assistant text
//     filesRead: string[],
//     filesModified: string[],
//     toolCallCount: number,
//     turnCount: number,
//     durationMs: number,
//     truncatedReason: null | 'aborted' | 'timeout' | 'max_turns' | 'error',
//     error?: string,                   // only when truncatedReason === 'error'
//   }
//
// Previously rendered as raw JSON dump in ToolCallCard. This component
// parses the JSON and surfaces the most useful bits: ok/error badge,
// kind badge (from tool.args), summary text, runtime stats, and
// collapsible file lists. Falls back to a <pre> dump if parsing fails.

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  FileText,
  FilePenLine,
} from 'lucide-react';

const TRUNCATED_LABEL = {
  aborted: '已中止',
  timeout: '超时',
  max_turns: '超出最大轮数',
  error: '出错',
};

const KIND_LABEL = {
  research: { text: '只读研究', cls: 'text-sky-700 bg-sky-50 ring-sky-100' },
  edit:     { text: '编辑模式', cls: 'text-amber-700 bg-amber-50 ring-amber-100' },
};

function shortenPath(p) {
  if (!p || typeof p !== 'string') return '';
  if (p.length <= 60) return p;
  const segs = p.split(/[\\/]/).filter(Boolean);
  if (segs.length <= 3) return p;
  return `…/${segs.slice(-3).join('/')}`;
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

function FileList({ title, files, Icon }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(files) || files.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{title} · {files.length}</span>
      </button>
      {open && (
        <ul className="mt-1 ml-4 space-y-0.5">
          {files.map((f, i) => (
            <li
              key={`${i}-${f}`}
              className="flex items-center gap-1.5 text-[11px] text-gray-600 font-mono"
              title={f}
            >
              <Icon size={11} className="text-gray-400 shrink-0" />
              <span className="truncate">{shortenPath(f)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RawFallback({ result }) {
  return (
    <div className="px-3.5 py-2.5 bg-white">
      <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed font-mono">
        {result.length > 800 ? result.slice(0, 800) + '...' : result}
      </pre>
    </div>
  );
}

export default function DelegateTaskResult({ result, args }) {
  const parsed = useMemo(() => {
    if (typeof result !== 'string' || !result.trim()) return null;
    try {
      const obj = JSON.parse(result);
      if (obj && typeof obj === 'object') return obj;
      return null;
    } catch {
      return null;
    }
  }, [result]);

  if (!parsed) {
    return <RawFallback result={String(result || '')} />;
  }

  const {
    ok,
    summary,
    filesRead,
    filesModified,
    toolCallCount,
    turnCount,
    durationMs,
    truncatedReason,
    error,
  } = parsed;

  const kindMeta = args && typeof args === 'object' ? KIND_LABEL[args.kind] : null;
  const reasonLabel = truncatedReason ? (TRUNCATED_LABEL[truncatedReason] || truncatedReason) : '';
  const statsParts = [];
  if (typeof turnCount === 'number' && turnCount > 0) statsParts.push(`${turnCount} 轮`);
  if (typeof toolCallCount === 'number' && toolCallCount > 0) statsParts.push(`${toolCallCount} 次工具调用`);
  const durLabel = formatDuration(durationMs);
  if (durLabel) statsParts.push(durLabel);
  const statsLine = statsParts.join(' · ');

  return (
    <div className="px-3.5 py-2.5 bg-white space-y-2">
      {/* status + kind badges */}
      <div className="flex items-center flex-wrap gap-1.5">
        {ok ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100">
            <CheckCircle2 size={11} />
            完成
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-rose-700 bg-rose-50 ring-1 ring-rose-100">
            <AlertCircle size={11} />
            {reasonLabel || '失败'}
          </span>
        )}
        {kindMeta && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ${kindMeta.cls}`}>
            {kindMeta.text}
          </span>
        )}
      </div>

      {/* summary */}
      {summary && (
        <div className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {summary}
        </div>
      )}

      {/* stats + file lists */}
      {(statsLine || (filesRead && filesRead.length) || (filesModified && filesModified.length)) && (
        <div className="pt-1.5 border-t border-gray-100">
          {statsLine && (
            <div className="text-[11px] text-gray-400 font-mono">{statsLine}</div>
          )}
          <FileList title="读取文件" files={filesRead} Icon={FileText} />
          <FileList title="修改文件" files={filesModified} Icon={FilePenLine} />
        </div>
      )}

      {/* error detail (only when truncatedReason === 'error') */}
      {error && (
        <div className="px-2 py-1.5 rounded bg-rose-50 ring-1 ring-rose-100 text-[12px] text-rose-700 font-mono whitespace-pre-wrap break-words">
          {error}
        </div>
      )}
    </div>
  );
}
