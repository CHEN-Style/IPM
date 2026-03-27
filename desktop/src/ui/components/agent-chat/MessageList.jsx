import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';
import ActionPlanCard from './ActionPlanCard.jsx';

const MessageList = ({ messages, pendingPlan, onExecutePlan, onCancelPlan, projectName, domain }) => {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingPlan]);

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      {messages.length === 0 && !pendingPlan && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-slate-100 flex items-center justify-center">
              <span className="text-2xl">✨</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">有什么可以帮你的？</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              你可以问关于项目文件的任何问题，也可以让我帮你移动、重命名文件或创建文件夹。
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {['项目里有多少文件？', '最近有哪些分类记录？', '搜索所有 PDF 文件'].map((hint) => (
                <span
                  key={hint}
                  className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-full"
                >
                  {hint}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {messages.map((msg, i) => (
        <React.Fragment key={i}>
          <MessageBubble message={msg} projectName={projectName} domain={domain} />
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
            onExecute={onExecutePlan}
            onCancel={onCancelPlan}
          />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

export default MessageList;
