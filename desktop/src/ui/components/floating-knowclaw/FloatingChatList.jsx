// desktop/src/ui/components/floating-knowclaw/FloatingChatList.jsx
//
// FK3-1: lightweight message list for the expanded floating KnowClaw panel.
//
// This is intentionally NOT a reuse of the main-window MessageBubble
// (which is ~700 lines with ToolCallCard, FileChangePreview, TaskCard,
// AskUserCard, DelegateTaskResult, etc.). The floating window's chat
// list matches the demo's `.kc-messages` visual style: 12px text,
// 282px-max bubbles, 22px "K" avatar, single-line tool indicators,
// and no heavy sub-components.

import React, { useEffect, useId, useRef } from 'react';
import { marked } from 'marked';
import { summarizeToolArgs } from '../knowclaw-v2/knowclawEventReducer.js';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  try { return marked.parse(text); } catch { return text.replace(/\n/g, '<br/>'); }
}

const TOOL_STATUS_COLOR = {
  running: '#94a3b8',
  done: '#10b981',
  error: '#f43f5e',
  interrupted: '#f59e0b',
  confirmed: '#10b981',
  cancelled: '#94a3b8',
};

function ToolPill({ tool }) {
  const dot = TOOL_STATUS_COLOR[tool.status] || '#94a3b8';
  const label = tool.summary || summarizeToolArgs(tool.name, tool.args) || tool.name;
  return (
    <span
      className="inline-flex items-center gap-1.5 mt-1.5 px-[7px] py-[3px] rounded-lg
                 bg-slate-50 text-slate-400 text-[10px] leading-tight"
    >
      <span
        className="shrink-0 rounded-full"
        style={{ width: 6, height: 6, background: dot,
          animation: tool.status === 'running' ? 'pulse 1.5s infinite' : undefined }}
      />
      <span className="truncate max-w-[220px]">{label}</span>
    </span>
  );
}

function AssistantBubble({ msg }) {
  const html = renderMarkdown(msg.content);
  const isThinking = msg.streaming && !msg.content && !msg.tools?.length;

  return (
    <div className="flex gap-2 items-start">
      <div
        className="shrink-0 grid place-items-center rounded-lg bg-slate-100 text-slate-500
                   text-[11px] font-bold select-none"
        style={{ width: 22, height: 22 }}
      >
        K
      </div>
      <div className="min-w-0 max-w-[282px]">
        <div
          className="px-[11px] py-[9px] rounded-[14px] border border-slate-200/80
                     bg-white/90 text-slate-700 text-[12px] leading-[1.62]
                     shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          {isThinking ? (
            <span className="text-slate-400 text-[11px] italic">思考中...</span>
          ) : html ? (
            <div
              className="fc-prose"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : null}
          {msg.streaming && msg.content && (
            <span
              className="inline-block align-[-2px] ml-[3px]"
              style={{
                width: 2, height: 13,
                background: '#334155',
                animation: 'cursor-blink 900ms infinite',
              }}
            />
          )}
        </div>
        {msg.tools?.map((t) => (
          <ToolPill key={t.toolCallId || t.name} tool={t} />
        ))}
      </div>
    </div>
  );
}

function UserBubble({ msg }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[282px] px-[11px] py-[9px] rounded-[14px]
                   border border-indigo-500/16 bg-indigo-50
                   text-slate-800 text-[12px] leading-[1.62]"
      >
        <p className="m-0 whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    </div>
  );
}

export default function FloatingChatList({ messages = [], streaming = false }) {
  const endRef = useRef(null);
  const scopeId = useId().replace(/[:]/g, '');
  const scrollClass = `fc-scroll-${scopeId}`;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming]);

  return (
    <>
      <style>{`
        .${scrollClass} {
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: rgba(148,163,184,0.42) transparent;
        }
        .${scrollClass}::-webkit-scrollbar { width: 9px; }
        .${scrollClass}::-webkit-scrollbar-track {
          margin: 8px 0 8px;
          background: transparent;
        }
        .${scrollClass}::-webkit-scrollbar-thumb {
          min-height: 24px;
          border: 3px solid transparent;
          border-radius: 999px;
          background: rgba(148,163,184,0.45);
          background-clip: padding-box;
        }
        .${scrollClass}::-webkit-scrollbar-thumb:hover {
          background: rgba(100,116,139,0.5);
          background-clip: padding-box;
        }
        .fc-prose p { margin: 0; }
        .fc-prose p + p { margin-top: 7px; }
        .fc-prose code {
          padding: 1px 5px;
          border-radius: 5px;
          background: #f1f5f9;
          font-size: 11px;
        }
        .fc-prose pre {
          margin: 6px 0;
          padding: 8px 10px;
          border-radius: 8px;
          background: #f8fafc;
          font-size: 10px;
          overflow-x: auto;
        }
        .fc-prose ul, .fc-prose ol {
          margin: 4px 0;
          padding-left: 18px;
        }
        .fc-prose li { margin: 2px 0; }
        .fc-prose strong { font-weight: 600; color: #1e293b; }
        @keyframes cursor-blink {
          0%, 45% { opacity: 1; }
          46%, 100% { opacity: 0; }
        }
      `}</style>

      <div
        className={`${scrollClass} flex flex-col gap-2.5 overflow-y-auto`}
        style={{
          height: 260,
          padding: '14px 14px 8px',
          background:
            'linear-gradient(#ffffff, rgba(255,255,255,0.86)), ' +
            'radial-gradient(circle at 50% 0, rgba(99,102,241,0.05), transparent 18rem)',
        }}
      >
        {messages.map((msg, i) => {
          if (msg.role === 'user') return <UserBubble key={i} msg={msg} />;
          if (msg.role === 'assistant') return <AssistantBubble key={i} msg={msg} />;
          return null;
        })}
        <div ref={endRef} />
      </div>
    </>
  );
}
