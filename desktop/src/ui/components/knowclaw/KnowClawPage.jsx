import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Brain, RotateCcw, Shield, ShieldOff, History, X, Trash2 } from 'lucide-react';
import MessageBubble from '../agent-chat/MessageBubble.jsx';
import ActionPlanCard from '../agent-chat/ActionPlanCard.jsx';
import ChatInput from '../agent-chat/ChatInput.jsx';
import useKnowClawChat from './useKnowClawChat.js';

const HINT_PROMPTS = [
  '哪个案件最近最活跃？',
  '帮我检查有没有待处理的文件',
  '所有项目的概况如何？',
  '查看案件A的文件结构',
];

const KnowClawPage = () => {
  const {
    messages,
    streaming,
    pendingPlan,
    sessionId,
    listSessionId,
    isReadonly,
    autonomousMode,
    sendMessage,
    executePlan,
    cancelPlan,
    endSession,
    loadHistorySession,
    startNewSession,
    toggleAutonomousMode,
  } = useKnowClawChat();

  const bottomRef = useRef(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingPlan]);

  useEffect(() => {
    return () => { endSession(); };
  }, []);

  const handleExecutePlan = async (plan, selectedIndices) => {
    await executePlan(plan, selectedIndices);
  };

  const handleHintClick = (hint) => {
    if (!streaming && !isReadonly) sendMessage(hint);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200">
            <Brain size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">KnowClaw</h2>
            <p className="text-xs text-slate-400">全局文件管理主管</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Autonomous mode toggle */}
          <button
            type="button"
            onClick={toggleAutonomousMode}
            className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
              autonomousMode
                ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
            title={autonomousMode ? '自治模式：委托操作自动批准' : '安全模式：委托操作需用户确认'}
          >
            {autonomousMode ? <ShieldOff size={13} /> : <Shield size={13} />}
            <span>{autonomousMode ? '自治模式' : '安全模式'}</span>
          </button>

          {/* History */}
          <HistoryPanel
            show={showHistory}
            onToggle={() => setShowHistory((v) => !v)}
            activeSessionId={listSessionId ?? sessionId}
            onSelect={(id) => { loadHistorySession(id); setShowHistory(false); }}
            onNewSession={() => { startNewSession(); setShowHistory(false); }}
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
        </div>
      </div>

      {/* Readonly banner */}
      {isReadonly && (
        <div className="px-8 py-2 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
          <span className="text-xs text-amber-700">正在查看历史对话（只读模式）</span>
          <button type="button" onClick={startNewSession} className="text-xs text-amber-700 hover:text-amber-900 underline">
            返回新对话
          </button>
        </div>
      )}

      {/* Chat body */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          <div className="max-w-3xl mx-auto">
            {messages.length === 0 && !pendingPlan && (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center max-w-lg">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center">
                    <Brain size={28} className="text-violet-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">KnowClaw</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-8">
                    我是你的全局文件管理主管，可以跨项目查看状态、检查问题、委托专员执行任务。
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
              <React.Fragment key={i}>
                <MessageBubble message={msg} projectName="KnowClaw" domain="supervisor" />
                {msg.actionPlan && !pendingPlan && (
                  <div className="mb-4 max-w-2xl">
                    <ActionPlanCard plan={msg.actionPlan} executed />
                  </div>
                )}
              </React.Fragment>
            ))}

            {pendingPlan && (
              <div className="mb-4 max-w-2xl">
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

        {/* Input */}
        <div className="border-t border-slate-100 bg-white">
          <div className="max-w-3xl mx-auto">
            <ChatInput
              onSend={sendMessage}
              disabled={streaming || isReadonly}
              placeholder={isReadonly ? '只读模式，无法发送消息' : '向 KnowClaw 提问...'}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const HistoryPanel = ({ show, onToggle, activeSessionId, onSelect, onNewSession }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!show) return;
    setLoading(true);
    window.ipm?.supervisor?.listSessions?.({ limit: 30 })
      .then((res) => {
        if (res?.ok) setSessions(res.sessions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onToggle();
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [show, onToggle]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await window.ipm?.supervisor?.deleteSession?.(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === activeSessionId) onNewSession();
    } catch { /* ignore */ }
  };

  if (!show) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        title="历史对话"
      >
        <History size={13} />
        <span>历史</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={onToggle}
        className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs bg-slate-100 text-slate-700"
      >
        <History size={13} />
        <span>历史</span>
      </button>

      <div className="absolute right-0 top-full mt-2 w-80 max-h-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">历史对话</span>
          <button type="button" onClick={onToggle} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-72">
          {loading && (
            <div className="px-4 py-6 text-center text-xs text-slate-400">加载中...</div>
          )}

          {!loading && sessions.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-400">暂无历史对话</div>
          )}

          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 group ${
                s.id === activeSessionId ? 'bg-violet-50' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700 truncate flex-1">
                  {s.title || '未命名对话'}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, s.id)}
                  className="opacity-0 group-hover:opacity-100 ml-2 p-1 text-slate-400 hover:text-red-500 transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-slate-400">
                  {new Date(s.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-[10px] text-slate-400">
                  {s.messageCount || 0} 条消息
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KnowClawPage;
