import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown, ChevronRight, Wrench, Loader2,
  Check, X, Undo2, Sparkles, Zap, MessageSquare,
  Brain, PenLine, Cog, Clock, AlertCircle,
} from 'lucide-react';
import { marked } from 'marked';

import TaskCard, { TaskCardSummary } from '../knowclaw-v2/TaskCard.jsx';
import AskUserCard from '../knowclaw-v2/AskUserCard.jsx';
import FileChangePreview from '../knowclaw-v2/FileChangePreview.jsx';
import DelegateTaskResult from '../knowclaw-v2/DelegateTaskResult.jsx';
import { summarizeToolArgs } from '../knowclaw-v2/useKnowClawV2Chat.js';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  try { return marked.parse(text); } catch { return text.replace(/\n/g, '<br/>'); }
}

/* ── Thinking indicator with rotating phrases ── */

const THINKING_PHRASES = [
  '思考中',
  '脑子转起来了',
  '翻箱倒柜找资料中',
  '正在憋大招',
  '神经元疯狂放电中',
  '让我想想...',
  '灵感快来了',
  '在知识海洋里冲浪中',
  '组织语言中',
  '认真分析中',
  '推理推理再推理',
  '大脑超频运转中',
  '答案正在路上',
  '整理思路中',
  '快想到了别催',
  '深度思考中',
  '检索记忆中',
  '马上就好',
  '构思精妙回答中',
  '全力运算中',
];

function ThinkingIndicator() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * THINKING_PHRASES.length));

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx((prev) => {
        let next;
        do { next = Math.floor(Math.random() * THINKING_PHRASES.length); } while (next === prev);
        return next;
      });
    }, 2400);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2.5 py-1">
      <Loader2 size={14} className="text-gray-400 animate-spin shrink-0" />
      <span
        key={idx}
        className="text-sm text-gray-400 font-medium"
        style={{ animation: 'thinkFade 2.4s ease-in-out infinite' }}
      >
        {THINKING_PHRASES[idx]}...
      </span>
      <style>{`
        @keyframes thinkFade {
          0%   { opacity: 0; transform: translateY(4px); }
          12%  { opacity: 1; transform: translateY(0); }
          88%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}

/* ── Thinking block (U0: extended-thinking stream) ── */

function ThinkingBlock({ thinking, isStreaming }) {
  // While the model is still emitting thinking, force the block open so
  // the user can watch the reasoning live. Once the turn ends we let the
  // user collapse it back via the toggle (default collapsed).
  const [userExpanded, setUserExpanded] = useState(false);
  if (!thinking) return null;
  const expanded = isStreaming || userExpanded;
  const label = isStreaming ? '思考中...' : `思考过程 (${thinking.length} 字)`;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => !isStreaming && setUserExpanded((v) => !v)}
        disabled={isStreaming}
        className={`flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors ${
          isStreaming ? 'cursor-default' : 'cursor-pointer'
        }`}
        title={isStreaming ? '正在思考' : (expanded ? '收起思考过程' : '展开思考过程')}
      >
        {isStreaming ? (
          <Loader2 size={12} className="animate-spin" />
        ) : expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
        <span className="italic">{label}</span>
      </button>
      {expanded && (
        isStreaming ? (
          <div className="mt-1.5 flex">
            <div
              className="shrink-0 w-0.5 rounded-full"
              style={{
                background:
                  'linear-gradient(180deg, #cbd5e1 0%, #f1f5f9 50%, #cbd5e1 100%)',
                backgroundSize: '100% 200%',
                animation: 'thinkShimmer 1.8s linear infinite',
              }}
            />
            <div className="pl-3 flex-1 min-w-0 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
              {thinking}
              <span className="inline-block w-px h-3.5 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
            </div>
            <style>{`
              @keyframes thinkShimmer {
                0%   { background-position: 0% 0%; }
                100% { background-position: 0% 200%; }
              }
            `}</style>
          </div>
        ) : (
          <div className="mt-1.5 pl-3 border-l-2 border-slate-200 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
            {thinking}
          </div>
        )
      )}
    </div>
  );
}

/* ── Tool status config ── */

const STATUS_CONFIG = {
  running:     { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  interrupted: { icon: Loader2, spin: false, color: 'text-amber-500', label: '等待确认' },
  confirmed:   { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  cancelled:   { icon: X,       spin: false, color: 'text-gray-400',  label: '已取消' },
  done:        { icon: Check,   spin: false, color: 'text-emerald-500', label: null },
  error:       { icon: AlertCircle, spin: false, color: 'text-rose-500', label: '执行失败' },
};

// K2: render a tool's elapsed wall-clock time. `start` is set when
// `tool_execution_start` arrives; `end` lands with the matching
// `tool_execution_end`. We display whole seconds for anything under a
// minute and `m:ss` above.
function formatElapsedMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/* ── Tool call card ── */

// U3: tail the last N lines of a long stdout snapshot so the inline
// "live output" stripe stays compact. The full snapshot is still
// available behind the "展开全部" toggle.
function tailLines(text, n) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  if (lines.length <= n) return lines.join('\n');
  return lines.slice(-n).join('\n');
}

const ToolCallCard = ({ tool, projectName, domain }) => {
  const [expanded, setExpanded] = useState(false);
  const [undoState, setUndoState] = useState('idle');
  const undoTimer = useRef(null);
  // U3: when the live stream of stdout/stderr is long, default to a
  // collapsed (tail-only) view and let the user expand to read the
  // full buffer. Independent from the "result" expand state above
  // because the live stream disappears the moment the tool finishes.
  const [streamExpanded, setStreamExpanded] = useState(false);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const cfg = STATUS_CONFIG[tool.status] || STATUS_CONFIG.done;
  const Icon = cfg.icon || Wrench;
  const isBusy = tool.status === 'running' || tool.status === 'interrupted' || tool.status === 'confirmed';
  // E.2: file-mutator tools (write / edit) get a live preview panel
  // that's rendered straight from `tool.args` — no need to wait for
  // `tool.result`. This bypasses the "wait until done to expand"
  // rule that gates regular tools and lets users watch the LLM
  // commit content in real-ish time.
  const isFileMutator = tool.name === 'write' || tool.name === 'edit';
  const hasPreviewableArgs = isFileMutator && tool.args && typeof tool.args === 'object';
  const isDelegateTask = tool.name === 'delegate_task';
  const canExpand = hasPreviewableArgs || (!isBusy && !!tool.result);
  const showUndo = tool.undoActionId && tool.status === 'done' && undoState !== 'done';
  const streamingStdout = isBusy ? (tool.streamingStdout || '') : '';
  const streamLineCount = streamingStdout ? streamingStdout.split(/\r?\n/).length : 0;

  // E.2: auto-expand the moment a write/edit tool starts so users
  // see the content/diff without having to hunt for a toggle. We
  // only fire when `hasPreviewableArgs` first becomes true and the
  // card is still collapsed; once the user has interacted with it,
  // their preference is respected (including collapsing it back).
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (hasPreviewableArgs && !autoExpandedRef.current) {
      autoExpandedRef.current = true;
      setExpanded(true);
    }
  }, [hasPreviewableArgs]);

  // K2: friendly parameter summary. Prefer the value stashed by the
  // hook (`tool.summary` — written at `tool_execution_start`) but
  // fall back to re-deriving it from args so historic bubbles loaded
  // from JSONL still get a nice label.
  const summary = useMemo(() => {
    if (tool.summary) return tool.summary;
    if (tool.args && typeof tool.args === 'object') {
      try { return summarizeToolArgs(tool.name, tool.args); } catch { /* ignore */ }
    }
    return '';
  }, [tool.summary, tool.name, tool.args]);

  const elapsed = useMemo(() => {
    if (tool.startTime && tool.endTime && tool.endTime >= tool.startTime) {
      return formatElapsedMs(tool.endTime - tool.startTime);
    }
    return '';
  }, [tool.startTime, tool.endTime]);

  const handleUndo = async (e) => {
    e.stopPropagation();
    if (undoState === 'loading') return;
    setUndoState('loading');
    try {
      const res = await window.ipm?.agent?.undoAction?.(projectName, domain, String(tool.undoActionId));
      if (res?.ok) {
        setUndoState('done');
      } else {
        setUndoState('error');
        undoTimer.current = setTimeout(() => setUndoState('idle'), 3000);
      }
    } catch {
      setUndoState('error');
      undoTimer.current = setTimeout(() => setUndoState('idle'), 3000);
    }
  };

  return (
    <div className="my-1.5 bg-gray-50/80 border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs transition-colors ${
          canExpand ? 'hover:bg-gray-100/60 cursor-pointer' : 'cursor-default'
        }`}
      >
        <Icon
          size={13}
          className={`${cfg.color}${cfg.spin ? ' animate-spin' : ''} shrink-0`}
        />
        <span className="font-mono text-gray-500 uppercase tracking-wider text-[11px] shrink-0">
          {tool.name}
        </span>
        {/* K2: friendly parameter summary. We render it as a regular
            (non-mono) span so it visually separates from the tool
            name and stays readable when paths are long. */}
        {summary && (
          <span
            className="text-gray-600 truncate min-w-0"
            title={summary}
          >
            {summary}
          </span>
        )}
        {cfg.label && (
          <span className={`${cfg.color} text-[10px] font-medium shrink-0`}>{cfg.label}</span>
        )}
        <span className="flex-1" />
        {/* K2: elapsed wall-clock time once the tool finishes. */}
        {elapsed && !isBusy && (
          <span className="text-[10px] text-gray-400 font-mono shrink-0">
            {elapsed}
          </span>
        )}
        {canExpand && (
          expanded
            ? <ChevronDown size={12} className="text-gray-400" />
            : <ChevronRight size={12} className="text-gray-400" />
        )}
      </button>

      {/* E.2: file-mutator preview takes priority over the generic
          result panel. We render the args-driven view (write content
          / edit diff) on top, and tuck the SDK's terse confirmation
          string (e.g. "Successfully wrote 1234 bytes to ...") into a
          single muted footer line so users still know the call
          finished and what it returned. For non-file tools we fall
          back to the historic result <pre>. */}
      {expanded && hasPreviewableArgs && (
        <div className="border-t border-gray-100">
          <FileChangePreview tool={tool} />
          {!isBusy && tool.result && (
            <div className="px-3.5 py-1.5 text-[10.5px] text-gray-400 border-t border-gray-100 bg-gray-50/60 font-mono truncate" title={tool.result}>
              {tool.result.length > 200 ? tool.result.slice(0, 200) + '…' : tool.result}
            </div>
          )}
        </div>
      )}

      {expanded && !hasPreviewableArgs && tool.result && (
        isDelegateTask ? (
          <div className="border-t border-gray-100">
            <DelegateTaskResult result={tool.result} args={tool.args} />
          </div>
        ) : (
          <div className="px-3.5 py-2.5 border-t border-gray-100 bg-white">
            <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed font-mono">
              {tool.result.length > 800 ? tool.result.slice(0, 800) + '...' : tool.result}
            </pre>
          </div>
        )
      )}

      {/* U3: live stdout/stderr while bash (and similar long-running
          tools) execute. Shown only while the tool is still busy —
          the moment `tool_execution_end` arrives the streaming
          snapshot is cleared in favour of `tool.result`. */}
      {streamingStdout && (
        <div className="border-t border-gray-100">
          <pre
            className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words overflow-y-auto"
            style={{
              background: '#0f172a',
              color: '#e2e8f0',
              padding: '8px 12px',
              maxHeight: streamExpanded ? '20rem' : '8rem',
            }}
          >
            {streamExpanded ? streamingStdout : tailLines(streamingStdout, 8)}
          </pre>
          {streamLineCount > 8 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setStreamExpanded((v) => !v); }}
              className="w-full px-3 py-1 text-[10px] text-slate-400 hover:text-slate-200 bg-slate-900/90 hover:bg-slate-900 transition-colors border-t border-slate-800"
            >
              {streamExpanded ? `收起 · ${streamLineCount} 行` : `展开全部 · ${streamLineCount} 行`}
            </button>
          )}
        </div>
      )}

      {showUndo && (
        <div className="px-3.5 py-2 border-t border-gray-100 bg-white flex justify-end">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoState === 'loading'}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-50"
          >
            {undoState === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            <span>{undoState === 'error' ? '撤销失败' : '撤销'}</span>
          </button>
        </div>
      )}

      {undoState === 'done' && (
        <div className="px-3.5 py-2 border-t border-gray-100 bg-white flex justify-end">
          <span className="flex items-center gap-1 text-[11px] text-gray-400">
            <Check size={11} /> 已撤销
          </span>
        </div>
      )}
    </div>
  );
};

/* ── U8b-8: user image attachments + lightbox ── */

function attachmentDataUrl(att) {
  if (!att?.data || !att?.mimeType) return '';
  const data = String(att.data);
  if (data.startsWith('data:')) return data;
  return `data:${att.mimeType};base64,${data}`;
}

function UserAttachments({ attachments }) {
  const [lightboxSrc, setLightboxSrc] = useState(null);
  if (!attachments?.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-2 justify-end">
        {attachments.map((att, i) => {
          const src = attachmentDataUrl(att);
          if (!src) return null;
          return (
            <button
              key={`${att.mimeType}-${i}`}
              type="button"
              onClick={() => setLightboxSrc(src)}
              className="block w-16 h-16 rounded-lg overflow-hidden border border-gray-200 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              title="点击查看大图"
            >
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          );
        })}
      </div>
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxSrc(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLightboxSrc(null); }}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setLightboxSrc(null)}
            title="关闭"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/* ── K2: heartbeat strip + idle countdown ── */
//
// Rendered at the top of the *active* assistant bubble while pi is
// streaming. Two responsibilities:
//   1. Surface a coarse-grain status (`thinking` / `writing` / `tool`)
//      so users see *something is happening* even when text/thinking
//      deltas come in burst-y or a long tool is mid-execution.
//   2. After 30s of silence (no events at all) flip the strip to an
//      "等待模型响应中…（已 N秒）" warning so users understand the
//      app isn't frozen — usually means the upstream provider is slow
//      or the network path stalled.

const PHASE_META = {
  thinking: {
    Icon: Brain,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    label: '思考中…',
  },
  writing: {
    Icon: PenLine,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    label: '正在回复…',
  },
  tool: {
    Icon: Cog,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    border: 'border-sky-100',
    label: '正在调用工具…',
  },
  idle: {
    Icon: Clock,
    color: 'text-slate-500',
    bg: 'bg-slate-50',
    border: 'border-slate-100',
    label: '等待中…',
  },
};

function HeartbeatStrip({ phase, activeToolName, idleSeconds }) {
  // After 30s of dead air we switch to the explicit "等待响应中"
  // warning regardless of the current phase — that's a much more
  // useful signal than the stale phase label at that point.
  const STALE_THRESHOLD = 30;
  const isStale = typeof idleSeconds === 'number' && idleSeconds >= STALE_THRESHOLD;

  if (isStale) {
    return (
      <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border border-amber-200 bg-amber-50 text-amber-700">
        <Loader2 size={11} className="animate-spin" />
        <span>等待模型响应中… (已 {idleSeconds}s)</span>
      </div>
    );
  }

  const meta = PHASE_META[phase] || PHASE_META.idle;
  const { Icon } = meta;
  const label = phase === 'tool' && activeToolName
    ? `正在执行 ${activeToolName}…`
    : meta.label;

  return (
    <div
      className={`mb-2 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border ${meta.bg} ${meta.border} ${meta.color}`}
    >
      <Icon size={11} className={phase === 'tool' || phase === 'thinking' ? 'animate-pulse' : ''} />
      <span>{label}</span>
    </div>
  );
}

/* ── Message bubble ── */

const MessageBubble = ({ message, projectName, domain, streamingPhase, activeToolName, idleSeconds, isLatestTasksBubble, onAskUserReply, onAskUserCancel }) => {
  // U7: highest-priority branch — `kind:'tasks'` system bubbles are
  // rendered as a checklist card, not as a normal text/system bubble.
  // We bail out BEFORE any other branch (including the system-text
  // pill below) so an empty `message.content` doesn't render a stray
  // grey pill alongside the card.
  // D.5: only the LATEST tasks bubble renders the full TaskCard; older
  // snapshots collapse into a single summary line so stale `in_progress`
  // rows no longer keep spinning after a newer snapshot supersedes them.
  if (message.kind === 'tasks') {
    if (isLatestTasksBubble) {
      return (
        <div className="mb-4">
          <TaskCard tasks={message.tasks} ts={message.ts} />
        </div>
      );
    }
    return (
      <div className="mb-2">
        <TaskCardSummary tasks={message.tasks} ts={message.ts} />
      </div>
    );
  }

  // E.5: structured ask_user prompt bubble. Routed before the system
  // branch because ask_user bubbles have no `role` field — they're
  // identified solely by `kind`. The card handles its own answered /
  // cancelled state.
  if (message.kind === 'ask_user') {
    return (
      <div className="mb-3">
        <AskUserCard
          message={message}
          onReply={onAskUserReply}
          onCancel={onAskUserCancel}
        />
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-4">
        <div className="px-4 py-1.5 bg-gray-100 rounded-full text-xs text-gray-500">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const renderedHtml = useMemo(() => renderMarkdown(message.content), [message.content]);

  if (isUser) {
    // U4: when the user injected this message via the steer/followUp
    // queue (KnowClawV2 only — legacy chats never set `message.kind`),
    // hang a small badge above the bubble so the transcript clearly
    // marks "this was an interrupt" vs "this was queued" vs "this
    // was a fresh turn". The badge is purely informational; the
    // bubble itself keeps the same styling so existing screenshots
    // / visual regression baselines stay stable.
    const kind = message.kind;
    const showBadge = kind === 'steer' || kind === 'followUp';
    return (
      <div className="flex justify-end mb-6">
        <div className="max-w-[75%] flex flex-col items-end">
          {showBadge && (
            <div
              className={`mb-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                kind === 'steer'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
              title={
                kind === 'steer'
                  ? '打断 - 在下一个工具间隙立即送达 agent'
                  : '追问 - agent 处理完当前任务后再处理'
              }
            >
              {kind === 'steer' ? <Zap size={10} /> : <MessageSquare size={10} />}
              <span>{kind === 'steer' ? '打断' : '追问'}</span>
            </div>
          )}
          {message.attachments?.length > 0 && (
            <UserAttachments attachments={message.attachments} />
          )}
          {message.content ? (
            <div className="px-4 py-3 rounded-2xl rounded-br-sm bg-gray-100 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles size={14} className="text-gray-500" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          {/* K2: heartbeat strip — only rendered while this bubble is
              actively streaming AND the page handed down a phase. The
              KnowClawV2Page only passes phase data to the last
              streaming assistant bubble, so older bubbles never see
              this strip. */}
          {message.streaming && streamingPhase && (
            <HeartbeatStrip
              phase={streamingPhase}
              activeToolName={activeToolName}
              idleSeconds={idleSeconds}
            />
          )}
          {/* U0: thinking stream sits above the final answer so the
              user can watch reasoning unfold before content arrives. */}
          {message.thinking && (
            <ThinkingBlock
              thinking={message.thinking}
              isStreaming={Boolean(message.streaming && !message.content)}
            />
          )}

          {message.content ? (
            <>
              <div
                className="prose-chat"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
              {message.streaming && (
                <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse rounded-sm ml-0.5 align-text-bottom" />
              )}
            </>
          ) : message.streaming && !message.thinking ? (
            // Only show the generic "thinking..." spinner when we have
            // neither real thinking_delta nor text yet — otherwise the
            // ThinkingBlock above already conveys progress.
            <ThinkingIndicator />
          ) : null}

          {message.tools?.length > 0 && (
            <div className="mt-2.5 space-y-1">
              {message.tools.map((tool, i) => (
                <ToolCallCard
                  key={`${tool.name}-${i}`}
                  tool={tool}
                  projectName={projectName}
                  domain={domain}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
