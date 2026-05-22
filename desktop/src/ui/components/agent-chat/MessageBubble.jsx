import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown, ChevronRight, Wrench, Loader2,
  Check, X, Undo2, Sparkles, Zap, MessageSquare,
} from 'lucide-react';
import { marked } from 'marked';

import TaskCard from '../knowclaw-v2/TaskCard.jsx';

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
        <div className="mt-1.5 pl-3 border-l-2 border-slate-200 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
          {thinking}
        </div>
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
};

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
  const canExpand = !isBusy && tool.result;
  const showUndo = tool.undoActionId && tool.status === 'done' && undoState !== 'done';
  const streamingStdout = isBusy ? (tool.streamingStdout || '') : '';
  const streamLineCount = streamingStdout ? streamingStdout.split(/\r?\n/).length : 0;

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
        <span className="font-mono text-gray-500 uppercase tracking-wider text-[11px]">
          {tool.name}
        </span>
        {cfg.label && (
          <span className={`${cfg.color} text-[10px] font-medium`}>{cfg.label}</span>
        )}
        <span className="flex-1" />
        {canExpand && (
          expanded
            ? <ChevronDown size={12} className="text-gray-400" />
            : <ChevronRight size={12} className="text-gray-400" />
        )}
      </button>

      {expanded && tool.result && (
        <div className="px-3.5 py-2.5 border-t border-gray-100 bg-white">
          <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed font-mono">
            {tool.result.length > 800 ? tool.result.slice(0, 800) + '...' : tool.result}
          </pre>
        </div>
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

/* ── Message bubble ── */

const MessageBubble = ({ message, projectName, domain }) => {
  // U7: highest-priority branch — `kind:'tasks'` system bubbles are
  // rendered as a checklist card, not as a normal text/system bubble.
  // We bail out BEFORE any other branch (including the system-text
  // pill below) so an empty `message.content` doesn't render a stray
  // grey pill alongside the card.
  if (message.kind === 'tasks') {
    return (
      <div className="mb-4">
        <TaskCard tasks={message.tasks} ts={message.ts} />
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
