import React, { useEffect, useRef } from 'react';
import { X, RotateCcw, Bot } from 'lucide-react';
import MessageList from './MessageList.jsx';
import ChatInput from './ChatInput.jsx';
import HistoryDropdown from './HistoryDropdown.jsx';
import useAgentChat from './hooks/useAgentChat.js';

const ChatPanel = ({ projectName, domain, onClose }) => {
  const {
    messages,
    streaming,
    pendingPlan,
    sessionId,
    listSessionId,
    isReadonly,
    sendMessage,
    executePlan,
    cancelPlan,
    endSession,
    loadHistorySession,
    startNewSession,
  } = useAgentChat(projectName, domain);

  const backdropRef = useRef(null);

  useEffect(() => {
    return () => { endSession(); };
  }, [projectName]);

  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose?.();
  };

  const handleExecutePlan = async (plan, selectedIndices) => {
    await executePlan(plan, selectedIndices);
  };

  const handleHistorySelect = (historySessionId) => {
    loadHistorySession(historySessionId);
  };

  const handleHistoryDelete = (deletedId) => {
    const active = listSessionId ?? sessionId;
    if (deletedId && active && deletedId === active) {
      startNewSession();
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[2px] animate-chat-backdrop"
    >
      <div
        className="w-[75%] max-w-[1100px] h-full bg-white shadow-2xl flex flex-col animate-chat-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 overflow-visible">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">AI 助理</h2>
              <p className="text-xs text-slate-400">{projectName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-visible shrink-0">
            <HistoryDropdown
              projectName={projectName}
              domain={domain}
              activeSessionId={listSessionId ?? sessionId}
              onSelect={handleHistorySelect}
              onDelete={handleHistoryDelete}
              onClearAll={startNewSession}
            />
            <button
              type="button"
              onClick={startNewSession}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="开始新对话"
            >
              <RotateCcw size={13} />
              <span>新对话</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Readonly banner */}
        {isReadonly && (
          <div className="px-8 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
            <span className="text-xs text-amber-700">正在查看历史对话（只读模式）</span>
            <button
              type="button"
              onClick={startNewSession}
              className="text-xs text-amber-700 hover:text-amber-900 underline"
            >
              返回新对话
            </button>
          </div>
        )}

        {/* Chat body */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full max-w-3xl mx-auto">
              <MessageList
                messages={messages}
                pendingPlan={pendingPlan}
                onExecutePlan={handleExecutePlan}
                onCancelPlan={cancelPlan}
                projectName={projectName}
                domain={domain}
              />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 bg-white">
            <div className="max-w-3xl mx-auto">
              <ChatInput
                onSend={sendMessage}
                disabled={streaming || isReadonly}
                placeholder={isReadonly ? '只读模式，无法发送消息' : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
