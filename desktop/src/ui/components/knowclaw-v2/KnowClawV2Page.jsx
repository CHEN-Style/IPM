// desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx
//
// Phase-4 minimal Chat UI for the new pi-coding-agent runtime. This panel
// runs alongside (does NOT replace) the legacy KnowClaw page so the two
// stacks can be compared during the migration.

import React, { useEffect, useRef, useState } from 'react';
import { Zap, RotateCcw, Square, ChevronDown, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import MessageBubble from '../agent-chat/MessageBubble.jsx';
import ChatInput from '../agent-chat/ChatInput.jsx';
import useKnowClawV2Chat from './useKnowClawV2Chat.js';
import SessionPanel from './SessionPanel.jsx';

const HINT_PROMPTS = [
  '你好，用一句话告诉我 1+1 等于几',
  '列出 D 盘 IPM 项目根目录的内容',
  '读取 desktop/package.json 并告诉我 React 版本',
  '当前工作目录是什么？',
];

const KnowClawV2Page = () => {
  const {
    messages,
    streaming,
    sessionId,
    models,
    currentModel,
    sessions,
    sessionsLoading,
    showSessionPanel,
    currentSessionFile,
    sendMessage,
    abort,
    newSession,
    setModel,
    setShowSessionPanel,
    refreshSessions,
    openSession,
    deleteSession,
    forkSession,
  } = useKnowClawV2Chat();

  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleHintClick = (hint) => {
    if (!streaming) sendMessage(hint);
  };

  return (
    <div className="h-full flex bg-white">
      {/* Phase 10: history session side panel (relative for the
          delete-confirmation overlay to anchor inside it). */}
      {showSessionPanel && (
        <div className="relative h-full">
          <SessionPanel
            sessions={sessions}
            loading={sessionsLoading}
            currentSessionFile={currentSessionFile}
            onOpen={openSession}
            onFork={forkSession}
            onDelete={deleteSession}
            onRefresh={refreshSessions}
            onNewSession={newSession}
          />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSessionPanel(!showSessionPanel)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title={showSessionPanel ? '隐藏会话列表' : '显示会话列表'}
            >
              {showSessionPanel ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-200">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">KnowClaw v2</h2>
              <p className="text-xs text-slate-400">
                pi-coding-agent runtime{sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector
              models={models}
              currentModel={currentModel}
              onChange={(provider, id) => setModel(provider, id)}
              disabled={streaming}
            />
            <button
              type="button"
              onClick={newSession}
              disabled={streaming}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="开始新对话"
            >
              <RotateCcw size={13} />
              <span>新对话</span>
            </button>
          </div>
        </div>

        {/* Chat body */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto">
              {messages.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center max-w-lg">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                    <Zap size={28} className="text-amber-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">KnowClaw v2</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-8">
                    全新的 pi-coding-agent 运行时。具备真实代码代理能力——文件读写、命令执行、工具调用。
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {HINT_PROMPTS.map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        onClick={() => handleHintClick(hint)}
                        className="px-4 py-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble
                key={i}
                message={msg}
                projectName="KnowClawV2"
                domain="knowclaw"
              />
            ))}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Abort bar (only while streaming) */}
        {streaming && (
          <div className="px-6 py-2 flex justify-center">
            <button
              type="button"
              onClick={abort}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
              title="中止当前回答"
            >
              <Square size={11} fill="currentColor" />
              <span>中止</span>
            </button>
          </div>
        )}

          {/* Input */}
          <div className="border-t border-slate-100 bg-white">
            <div className="max-w-3xl mx-auto">
              <ChatInput
                onSend={sendMessage}
                disabled={streaming}
                placeholder="向 KnowClaw v2 提问..."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ModelSelector = ({ models, currentModel, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!models || models.length === 0) {
    return (
      <span className="h-8 px-3 flex items-center text-xs text-slate-400">
        模型加载中...
      </span>
    );
  }

  const displayLabel = currentModel ? currentModel.split('/').slice(-1)[0] : '选择模型';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
          disabled
            ? 'text-slate-300 cursor-not-allowed'
            : open
              ? 'bg-slate-100 text-slate-700'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title="选择模型"
      >
        <span className="font-mono">{displayLabel}</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
          {models.map((m) => {
            const key = `${m.provider}/${m.id}`;
            const active = key === currentModel;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { onChange(m.provider, m.id); setOpen(false); }}
                className={`w-full px-3 py-2 flex items-center justify-between text-left text-xs transition-colors ${
                  active ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="font-mono truncate">{m.id}</span>
                {m.isDefault && (
                  <span className="ml-2 px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded uppercase tracking-wider">
                    default
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KnowClawV2Page;
