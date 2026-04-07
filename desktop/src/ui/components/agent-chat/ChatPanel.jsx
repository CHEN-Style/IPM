import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { X, RotateCcw, Sparkles } from 'lucide-react';
import MessageBubble from './MessageBubble.jsx';
import ActionPlanCard from './ActionPlanCard.jsx';
import ChatInput from './ChatInput.jsx';
import HistoryDropdown from './HistoryDropdown.jsx';
import ConversationNav from './ConversationNav.jsx';
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
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const messageRefsMap = useRef(new Map());

  useEffect(() => {
    return () => { endSession(); };
  }, [projectName]);

  /* auto-scroll to bottom on new messages */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingPlan]);

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

  const userIndices = useMemo(
    () => messages.reduce((acc, m, i) => (m.role === 'user' ? [...acc, i] : acc), []),
    [messages],
  );

  const registerRef = useCallback((idx, el) => {
    if (el) messageRefsMap.current.set(idx, el);
    else messageRefsMap.current.delete(idx);
  }, []);

  const isEmpty = messages.length === 0 && !pendingPlan;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 top-[36px] z-50 flex justify-end bg-black/20 backdrop-blur-[2px] animate-chat-backdrop"
    >
      <div
        className="w-[75%] max-w-[1100px] h-full bg-white shadow-2xl flex flex-col animate-chat-panel font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Sparkles size={16} className="text-gray-500" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-800">AI 助理</h2>
              <p className="text-[11px] text-gray-400 truncate">{projectName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="开始新对话"
            >
              <RotateCcw size={13} />
              <span>新对话</span>
            </button>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Readonly banner */}
        {isReadonly && (
          <div className="px-8 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between shrink-0">
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

        {/* ── Chat body ── */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            {/* Scrollable content */}
            <div ref={scrollRef} className="h-full overflow-y-auto">
              <div className="max-w-3xl mx-auto px-8 py-6">
                {/* Empty state */}
                {isEmpty && (
                  <div className="flex items-center justify-center h-full min-h-[50vh]">
                    <div className="text-center max-w-md">
                      <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-gray-100 flex items-center justify-center">
                        <Sparkles size={24} className="text-gray-400" strokeWidth={1.5} />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-2">
                        有什么可以帮你的？
                      </h3>
                      <p className="text-sm text-gray-400 leading-relaxed">
                        你可以问关于项目文件的任何问题，也可以让我帮你移动、重命名文件或创建文件夹。
                      </p>
                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {['项目里有多少文件？', '最近有哪些分类记录？', '搜索所有 PDF 文件'].map(
                          (hint) => (
                            <span
                              key={hint}
                              className="px-3.5 py-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full hover:bg-gray-100 transition-colors cursor-default"
                            >
                              {hint}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    ref={msg.role === 'user' ? (el) => registerRef(i, el) : undefined}
                  >
                    <MessageBubble
                      message={msg}
                      projectName={projectName}
                      domain={domain}
                    />
                    {msg.actionPlan && !pendingPlan && (
                      <div className="mb-5 max-w-2xl">
                        <ActionPlanCard plan={msg.actionPlan} executed />
                      </div>
                    )}
                  </div>
                ))}

                {/* Pending plan */}
                {pendingPlan && (
                  <div className="mb-5 max-w-2xl">
                    <ActionPlanCard
                      plan={pendingPlan}
                      onExecute={handleExecutePlan}
                      onCancel={cancelPlan}
                    />
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            {/* Conversation navigator */}
            <ConversationNav
              userIndices={userIndices}
              scrollContainerRef={scrollRef}
              messageRefs={messageRefsMap}
            />
          </div>

          {/* ── Input ── */}
          <div className="border-t border-gray-100 bg-white shrink-0">
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
