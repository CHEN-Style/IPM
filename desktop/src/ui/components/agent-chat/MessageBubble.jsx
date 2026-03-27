import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Wrench, Loader2, Bot, Pause, Check, X, Undo2 } from 'lucide-react';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch {
    return text.replace(/\n/g, '<br/>');
  }
}

const STATUS_CONFIG = {
  running:     { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  interrupted: { icon: Pause,   spin: false, color: 'text-amber-500', label: '等待确认' },
  confirmed:   { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  cancelled:   { icon: X,       spin: false, color: 'text-slate-400', label: '已取消' },
  done:        { icon: Check,   spin: false, color: 'text-green-500', label: null },
};

const ToolCallCard = ({ tool, projectName, domain }) => {
  const [expanded, setExpanded] = useState(false);
  const [undoState, setUndoState] = useState('idle');
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
        setTimeout(() => setUndoState('idle'), 3000);
      }
    } catch {
      setUndoState('error');
      setTimeout(() => setUndoState('idle'), 3000);
    }
  };

  return (
    <div className="my-1 border border-slate-150 rounded-lg overflow-hidden bg-slate-50/60">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100/80 transition-colors"
      >
        <Icon size={12} className={`${cfg.color}${cfg.spin ? ' animate-spin' : ''}`} />
        <span className="font-medium">{tool.name}</span>
        {cfg.label && <span className={`${cfg.color} text-[10px]`}>{cfg.label}</span>}
        {canExpand && (
          expanded
            ? <ChevronDown size={12} className="ml-auto text-slate-400" />
            : <ChevronRight size={12} className="ml-auto text-slate-400" />
        )}
      </button>
      {expanded && tool.result && (
        <div className="px-3 py-2 border-t border-slate-200 bg-white">
          <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed">
            {tool.result.length > 800 ? tool.result.slice(0, 800) + '...' : tool.result}
          </pre>
        </div>
      )}
      {showUndo && (
        <div className="px-3 py-1.5 border-t border-slate-100 bg-white flex justify-end">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoState === 'loading'}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-600 transition-colors disabled:opacity-50"
          >
            {undoState === 'loading' ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Undo2 size={10} />
            )}
            <span>{undoState === 'error' ? '撤销失败' : '撤销'}</span>
          </button>
        </div>
      )}
      {undoState === 'done' && (
        <div className="px-3 py-1.5 border-t border-slate-100 bg-white flex justify-end">
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <Check size={10} />
            <span>已撤销</span>
          </span>
        </div>
      )}
    </div>
  );
};

const MessageBubble = ({ message, projectName, domain }) => {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-3">
        <div className="px-4 py-1.5 bg-slate-100 rounded-full text-xs text-slate-500">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  const renderedHtml = useMemo(() => renderMarkdown(message.content), [message.content]);

  if (isUser) {
    return (
      <div className="flex justify-end mb-5">
        <div className="max-w-[75%]">
          <div className="px-4 py-3 rounded-2xl rounded-br-md bg-slate-800 text-white text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot size={14} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {message.content ? (
            <div
              className="prose-chat"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : message.streaming ? (
            <span className="inline-block w-1.5 h-5 bg-slate-400 animate-pulse rounded-sm" />
          ) : null}

          {message.streaming && message.content && (
            <span className="inline-block w-1.5 h-4 bg-slate-400 animate-pulse rounded-sm ml-0.5 align-text-bottom" />
          )}

          {message.tools?.length > 0 && (
            <div className="mt-2">
              {message.tools.map((tool, i) => (
                <ToolCallCard key={`${tool.name}-${i}`} tool={tool} projectName={projectName} domain={domain} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
