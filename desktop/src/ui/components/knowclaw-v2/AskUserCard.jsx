// desktop/src/ui/components/knowclaw-v2/AskUserCard.jsx
//
// E.5: structured-question card rendered inline in the chat transcript.
//
// Triggered by the `kind: 'ask_user'` bubble that
// useKnowClawPersist injects when main process pushes
// `knowclaw:askUser`. The message shape is:
//   {
//     kind: 'ask_user',
//     requestId: string,
//     questions: Array<{
//       id: string,
//       prompt: string,
//       options: Array<{ id: string, label: string }>,
//       allow_multiple?: boolean,
//     }>,
//     answered?: boolean,         // true once user submits
//     answers?: { [qid]: string | string[] },
//     cancelled?: boolean,
//     ts: number,
//   }
//
// Once answered (or cancelled), the card freezes in a read-only state
// so the user still sees what they replied; the actual model-facing
// answer was already shipped via IPC.

import React, { useMemo, useState } from 'react';
import { HelpCircle, CheckCircle2, XCircle, Send } from 'lucide-react';

function Option({ option, selected, onToggle, disabled, multiple }) {
  const Mark = multiple
    ? () => (
        <span
          className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm border ${
            selected
              ? 'bg-violet-500 border-violet-500 text-white'
              : 'bg-white border-gray-300'
          }`}
        >
          {selected && (
            <svg viewBox="0 0 16 16" className="w-2.5 h-2.5 fill-current">
              <path d="M6 11.2 2.8 8l-1 1L6 13.2 14.2 5l-1-1z" />
            </svg>
          )}
        </span>
      )
    : () => (
        <span
          className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border ${
            selected
              ? 'border-violet-500'
              : 'border-gray-300'
          }`}
        >
          {selected && <span className="w-2 h-2 rounded-full bg-violet-500" />}
        </span>
      );

  return (
    <button
      type="button"
      onClick={() => !disabled && onToggle?.()}
      disabled={disabled}
      className={`w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-md text-[13px] transition-colors ${
        disabled
          ? selected
            ? 'bg-violet-50/60 text-gray-700'
            : 'text-gray-400'
          : selected
            ? 'bg-violet-50 text-gray-800'
            : 'hover:bg-gray-50 text-gray-700'
      }`}
    >
      <span className="mt-0.5 shrink-0"><Mark /></span>
      <span className="flex-1 leading-snug">{option.label}</span>
    </button>
  );
}

export default function AskUserCard({ message, onReply, onCancel }) {
  const questions = Array.isArray(message?.questions) ? message.questions : [];
  const answered = Boolean(message?.answered);
  const cancelled = Boolean(message?.cancelled);

  // Selections shape mirrors the wire format:
  //   { [qid]: string | string[] }
  // Initialised from message.answers when the card is already answered
  // (rehydrate / re-render after submit), else empty.
  const [selections, setSelections] = useState(() => {
    if (answered && message?.answers && typeof message.answers === 'object') {
      return { ...message.answers };
    }
    return {};
  });

  const allAnswered = useMemo(() => {
    for (const q of questions) {
      const v = selections[q.id];
      if (q.allow_multiple) {
        if (!Array.isArray(v) || v.length === 0) return false;
      } else {
        if (!v || typeof v !== 'string') return false;
      }
    }
    return questions.length > 0;
  }, [questions, selections]);

  const toggleSingle = (qid, optId) => {
    setSelections((prev) => ({ ...prev, [qid]: optId }));
  };
  const toggleMulti = (qid, optId) => {
    setSelections((prev) => {
      const cur = Array.isArray(prev[qid]) ? prev[qid] : [];
      const next = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId];
      return { ...prev, [qid]: next };
    });
  };

  const handleSubmit = () => {
    if (!allAnswered || answered) return;
    onReply?.(message.requestId, selections);
  };

  const handleCancel = () => {
    if (answered) return;
    onCancel?.(message.requestId);
  };

  return (
    <div className="my-2 max-w-full">
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-violet-100 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-r from-violet-50/80 to-white border-b border-violet-100">
          <HelpCircle size={14} className="text-violet-500 shrink-0" />
          <span className="text-[12px] text-violet-700 font-medium">
            {answered ? (cancelled ? '已取消' : '已回复') : '请确认以下问题'}
          </span>
          <span className="flex-1" />
          <span className="text-[10px] text-gray-400 font-mono">{questions.length} 题</span>
        </div>

        <div className="px-3.5 py-3 space-y-3">
          {questions.map((q, qi) => {
            const isMulti = Boolean(q.allow_multiple);
            const sel = selections[q.id];
            return (
              <div key={q.id || qi}>
                <div className="text-[12.5px] text-gray-700 font-medium mb-1.5 leading-snug">
                  <span className="text-gray-400 mr-1">Q{qi + 1}.</span>
                  {q.prompt}
                  {isMulti && <span className="ml-1 text-[10.5px] text-gray-400">（可多选）</span>}
                </div>
                <div className="space-y-0.5">
                  {Array.isArray(q.options) && q.options.map((opt) => {
                    const selected = isMulti
                      ? Array.isArray(sel) && sel.includes(opt.id)
                      : sel === opt.id;
                    return (
                      <Option
                        key={opt.id}
                        option={opt}
                        selected={selected}
                        disabled={answered}
                        multiple={isMulti}
                        onToggle={() =>
                          isMulti ? toggleMulti(q.id, opt.id) : toggleSingle(q.id, opt.id)
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {answered ? (
          <div className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/60 flex items-center gap-1.5 text-[11px] text-gray-400">
            {cancelled ? (
              <>
                <XCircle size={11} className="text-rose-400" />
                <span>已取消本次提问</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={11} className="text-emerald-500" />
                <span>答案已发送给模型</span>
              </>
            )}
          </div>
        ) : (
          <div className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/60 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-2.5 py-1 rounded text-[11.5px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allAnswered}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded text-[11.5px] font-medium transition-colors ${
                allAnswered
                  ? 'bg-violet-500 text-white hover:bg-violet-600'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'
              }`}
            >
              <Send size={11} />
              提交回复
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
