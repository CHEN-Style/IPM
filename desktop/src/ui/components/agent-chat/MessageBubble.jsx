import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown, ChevronRight, Wrench, Loader2,
  Check, X, Undo2, Sparkles,
} from 'lucide-react';
import { marked } from 'marked';

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

/* ── Tool status config ── */

const STATUS_CONFIG = {
  running:     { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  interrupted: { icon: Loader2, spin: false, color: 'text-amber-500', label: '等待确认' },
  confirmed:   { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  cancelled:   { icon: X,       spin: false, color: 'text-gray-400',  label: '已取消' },
  done:        { icon: Check,   spin: false, color: 'text-emerald-500', label: null },
};

/* ── Tool call card ── */

const ToolCallCard = ({ tool, projectName, domain }) => {
  const [expanded, setExpanded] = useState(false);
  const [undoState, setUndoState] = useState('idle');
  const undoTimer = useRef(null);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const cfg = STATUS_CONFIG[tool.status] || STATUS_CONFIG.done;
  const Icon = cfg.icon || Wrench;
  const isBusy = tool.status === 'running' || tool.status === 'interrupted' || tool.status === 'confirmed';
  const canExpand = !isBusy && tool.result;
  const showUndo = tool.undoActionId && tool.status === 'done' && undoState !== 'done';

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

/* ── Message bubble ── */

const MessageBubble = ({ message, projectName, domain }) => {
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
    return (
      <div className="flex justify-end mb-6">
        <div className="max-w-[75%]">
          <div className="px-4 py-3 rounded-2xl rounded-br-sm bg-gray-100 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
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
          ) : message.streaming ? (
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
