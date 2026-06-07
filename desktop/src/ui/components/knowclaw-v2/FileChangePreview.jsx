// desktop/src/ui/components/knowclaw-v2/FileChangePreview.jsx
//
// E.2: Cursor-style live preview for file-mutator tools.
//
// Routes `tool.args` (or `tool.partialArgs` during streaming) to one
// of two compact views:
//   - WritePreview  → renders `args.content` as a fenced code block
//                     with line-count / char-count meta + tail-aware
//                     truncation so 10k-line dumps don't kill the DOM.
//   - EditPreview   → renders `args.edits[]` as a minimal "old block
//                     above, new block below" pair per replacement,
//                     colour-coded red/green like a one-glance diff
//                     without pulling in a real diff library.
//
// Both run while the tool is still executing (KnowClaw used to lock
// expansion to !busy). The data is already on `tool.args` thanks to
// `useKnowClawPersist` stashing it at `tool_execution_start`; R4 adds
// `tool.partialArgs` which arrives even earlier — extracted out of
// the JSON fragments emitted by `toolcall_delta` so users see the
// content grow as the model types it.
//
// Pi-runtime tool name + arg conventions:
//   write: { path: string, content: string }
//   edit:  { path: string, edits: { oldText, newText }[] }
//          (legacy fallback: top-level oldText/newText, or `edits`
//          serialised as JSON string)

import React, { useMemo } from 'react';
import { FilePlus, FilePenLine } from 'lucide-react';

const MAX_LINES = 800;
const HEAD_LINES = 200;
const TAIL_LINES = 200;
const MAX_EDIT_TEXT_LINES = 200;

// E.2: pretty path → strip the workspace prefix if the args path is
// absolute and lives inside a typical user-data root. Keeps the
// header readable on long absolute paths without losing meaning.
function shortenPath(p) {
  if (!p) return '';
  const norm = String(p).replace(/\\/g, '/');
  // Show last 2 segments if path is very long.
  if (norm.length <= 60) return norm;
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 3) return norm;
  return `…/${parts.slice(-3).join('/')}`;
}

function countLines(s) {
  if (!s) return 0;
  const t = String(s);
  // Treat trailing newline as not adding an extra line.
  const trimmed = t.endsWith('\n') ? t.slice(0, -1) : t;
  if (trimmed === '') return 0;
  return trimmed.split(/\r?\n/).length;
}

// E.2: keep huge `write` blobs from melting the renderer. We snip
// the middle but keep first 200 / last 200 lines so the user still
// has both endpoints to inspect.
function truncateForDisplay(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  if (lines.length <= MAX_LINES) {
    return { text: lines.join('\n'), truncated: false, hidden: 0 };
  }
  const hidden = lines.length - HEAD_LINES - TAIL_LINES;
  const head = lines.slice(0, HEAD_LINES).join('\n');
  const tail = lines.slice(-TAIL_LINES).join('\n');
  return {
    text: `${head}\n\n… (省略中间 ${hidden} 行) …\n\n${tail}`,
    truncated: true,
    hidden,
  };
}

// E.2: snip individual oldText/newText so a single mega-edit doesn't
// scroll forever; full diff is still on disk and can be inspected
// via the underlying file once the tool finishes.
function truncateEditText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length <= MAX_EDIT_TEXT_LINES) return String(text ?? '');
  const half = Math.floor(MAX_EDIT_TEXT_LINES / 2);
  const hidden = lines.length - half * 2;
  return [
    lines.slice(0, half).join('\n'),
    `… (省略中间 ${hidden} 行) …`,
    lines.slice(-half).join('\n'),
  ].join('\n');
}

// E.2: pi `edit` schema is `{ path, edits: [{ oldText, newText }] }`
// but earlier turns sometimes hand the LLM legacy shapes:
//   - top-level oldText/newText (one replacement)
//   - `edits` serialised as a JSON string
// `prepareEditArguments` on the pi side already normalises these,
// but `tool_execution_start` emits the *raw* args before that step,
// so we mirror the same tolerance on the renderer side.
function normalizeEdits(args) {
  if (!args || typeof args !== 'object') return [];
  let edits = args.edits;
  if (typeof edits === 'string') {
    try { edits = JSON.parse(edits); } catch { edits = null; }
  }
  if (Array.isArray(edits)) {
    return edits
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        oldText: String(e.oldText ?? e.old_string ?? ''),
        newText: String(e.newText ?? e.new_string ?? ''),
      }));
  }
  if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
    return [{ oldText: args.oldText, newText: args.newText }];
  }
  if (typeof args.old_string === 'string' && typeof args.new_string === 'string') {
    return [{ oldText: args.old_string, newText: args.new_string }];
  }
  return [];
}

function PreviewHeader({ Icon, path, meta }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 border-b border-gray-100 bg-gray-50/60">
      <Icon size={13} className="text-gray-500 shrink-0" strokeWidth={2} />
      <span className="text-[11.5px] font-mono text-gray-700 truncate flex-1" title={path}>
        {shortenPath(path) || '(无路径)'}
      </span>
      {meta && (
        <span className="text-[10px] text-gray-400 shrink-0">{meta}</span>
      )}
    </div>
  );
}

function WritePreview({ args, isPartial }) {
  const path = String(args?.path || '');
  const content = String(args?.content ?? '');
  const { text, truncated, hidden } = useMemo(() => truncateForDisplay(content), [content]);
  const lineCount = useMemo(() => countLines(content), [content]);
  const charCount = content.length;
  // R4: while the JSON is still streaming we don't know the final
  // size yet — surface a live counter ("生成中 · N 字符") so the
  // user can see progress, and switch to the final stats only after
  // `toolcall_end` upgrades the card to full args.
  const meta = isPartial
    ? (content
        ? `生成中 · ${lineCount} 行 · ${charCount.toLocaleString()} 字符`
        : '生成中...')
    : (lineCount > 0
        ? `${lineCount} 行 · ${charCount.toLocaleString()} 字符`
        : `${charCount.toLocaleString()} 字符`);

  // R4: anchor the live view to the bottom of the buffer so newly
  // arrived deltas stay visible without the user having to scroll.
  // We only do this while content is actively growing (isPartial) —
  // once `toolcall_end` finalises args, the user keeps scroll
  // control. The ref points at the inner <pre>; effect updates
  // scrollTop on every content tick.
  const preRef = React.useRef(null);
  React.useEffect(() => {
    if (!isPartial) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isPartial, text]);

  return (
    <div className="bg-white">
      <PreviewHeader Icon={FilePlus} path={path || (isPartial ? '正在确定路径…' : '')} meta={meta} />
      <pre
        ref={preRef}
        className="text-[11px] leading-relaxed text-gray-700 font-mono whitespace-pre overflow-x-auto overflow-y-auto max-h-96 px-3.5 py-2.5 m-0"
      >
        {text}
        {/* R4: blinking caret while args stream in — Cursor / Codex-style
            "still generating" affordance. */}
        {isPartial && (
          <span
            aria-hidden
            className="inline-block w-1.5 h-3 bg-violet-400 align-middle ml-0.5 animate-pulse"
          />
        )}
      </pre>
      {truncated && (
        <div className="px-3.5 py-1.5 text-[10px] text-amber-600 bg-amber-50 border-t border-amber-100">
          内容较长，已截断中间 {hidden} 行（仅显示首 {HEAD_LINES} + 尾 {TAIL_LINES} 行）
        </div>
      )}
    </div>
  );
}

function EditChunk({ index, total, edit }) {
  const oldDisplay = useMemo(() => truncateEditText(edit.oldText), [edit.oldText]);
  const newDisplay = useMemo(() => truncateEditText(edit.newText), [edit.newText]);
  return (
    <div className="px-3.5 py-2 border-t border-gray-100 first:border-t-0">
      {total > 1 && (
        <div className="text-[10px] text-gray-400 mb-1.5">修改 {index + 1} / {total}</div>
      )}
      <pre className="text-[11px] leading-relaxed font-mono whitespace-pre overflow-x-auto max-h-48 overflow-y-auto px-2.5 py-1.5 m-0 mb-1 rounded-md bg-rose-50 border-l-2 border-rose-300 text-rose-700">
        {oldDisplay || '(空)'}
      </pre>
      <pre className="text-[11px] leading-relaxed font-mono whitespace-pre overflow-x-auto max-h-48 overflow-y-auto px-2.5 py-1.5 m-0 rounded-md bg-emerald-50 border-l-2 border-emerald-300 text-emerald-700">
        {newDisplay || '(空)'}
      </pre>
    </div>
  );
}

function EditPreview({ args, isPartial }) {
  const path = String(args?.path || '');
  const edits = useMemo(() => normalizeEdits(args), [args]);
  if (edits.length === 0) {
    // R4: during streaming the edits[] array is almost certainly
    // mid-emission — render a friendlier "generating" placeholder
    // instead of the post-hoc "无可识别的修改" warning.
    const placeholder = isPartial ? '正在生成编辑内容…' : '无可识别的修改';
    return (
      <div className="bg-white">
        <PreviewHeader
          Icon={FilePenLine}
          path={path || (isPartial ? '正在确定路径…' : '')}
          meta={placeholder}
        />
      </div>
    );
  }
  const meta = isPartial ? `生成中 · ${edits.length} 处修改…` : `${edits.length} 处修改`;
  return (
    <div className="bg-white">
      <PreviewHeader Icon={FilePenLine} path={path} meta={meta} />
      <div className="max-h-96 overflow-y-auto">
        {edits.map((e, i) => (
          <EditChunk key={i} index={i} total={edits.length} edit={e} />
        ))}
      </div>
    </div>
  );
}

export default function FileChangePreview({ tool }) {
  if (!tool) return null;
  // R4: prefer the fully-validated args from `tool_execution_start` /
  // `toolcall_end`; fall back to the streaming partial extract while
  // the model is still emitting the JSON payload.
  const fullArgs = tool.args && typeof tool.args === 'object' ? tool.args : null;
  const partialArgs = tool.partialArgs && typeof tool.partialArgs === 'object' ? tool.partialArgs : null;
  const effectiveArgs = fullArgs || partialArgs;
  if (!effectiveArgs) return null;
  const isPartial = !fullArgs && !!partialArgs;
  if (tool.name === 'write') return <WritePreview args={effectiveArgs} isPartial={isPartial} />;
  if (tool.name === 'edit') return <EditPreview args={effectiveArgs} isPartial={isPartial} />;
  return null;
}
