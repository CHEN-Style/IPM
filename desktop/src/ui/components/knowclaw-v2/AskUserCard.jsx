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
//     answered?: boolean,         // true once user submits / skips / cancels
//     answers?: { [qid]: string | string[] },
//     cancelled?: boolean,        // user dismissed the whole ask_user
//     skipped?: boolean,          // user chose "let the model decide"
//     ts: number,
//   }
//
// Once answered (or cancelled / skipped), the card freezes in a read-only
// state so the user still sees what they replied; the actual model-facing
// answer was already shipped via IPC.
//
// "其他…" 自由文本扩展
// --------------------
// The model's `ask_user` parameters schema only accepts a fixed `options`
// array per question. Rather than asking the model to manually include an
// "Other" option in every payload (it would forget, or hallucinate
// inconsistent slugs), we ALWAYS append a synthetic option with
// `id === OTHER_OPTION_ID` to every question on the FRONTEND. When the
// user picks it, a textarea appears below; on submit, we replace the
// synthetic id with `"other:<typed text>"` in the wire payload so the
// model receives a self-describing string. Multi-choice questions can
// combine "其他…" with normal options — same substitution rule applies.
//
// "Skip" 与 "Cancel"
// ------------------
// Two distinct dismissal verbs:
//   - Skip (跳过 / Esc):  user trusts the model to proceed without their
//                         input. Backend returns `{ skipped: true }` and
//                         the tool tells the model "user skipped, decide
//                         yourself, you can re-ask later if needed".
//   - Cancel (取消):      user wants to abandon the ask_user action
//                         entirely. Backend returns `{ cancelled: true }`
//                         and the tool tells the model "user cancelled,
//                         switch to plain text or revise approach".

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, CheckCircle2, XCircle, Send, SkipForward } from 'lucide-react';

// Synthetic option id for the auto-appended "其他…" entry. Picked to be
// unlikely to ever collide with a real model-emitted slug. Anything
// starting with `__` in our schema would also fail the tool's TypeBox
// validation (it only emits ascii slugs), so collision is moot.
export const OTHER_OPTION_ID = '__other__';

const OTHER_TEXT_PREFIX = 'other:';

// Helpers to translate between FE state (synthetic `__other__` + a side
// table of free-text strings) and the BE wire format (a single
// `other:<text>` string in the answers map).
function isOtherWireValue(v) {
  return typeof v === 'string' && v.startsWith(OTHER_TEXT_PREFIX);
}
function otherWireToText(v) {
  return isOtherWireValue(v) ? v.slice(OTHER_TEXT_PREFIX.length) : '';
}

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

export default function AskUserCard({ message, onReply, onCancel, onSkip }) {
  const questions = Array.isArray(message?.questions) ? message.questions : [];
  const answered = Boolean(message?.answered);
  const cancelled = Boolean(message?.cancelled);
  const skipped = Boolean(message?.skipped);

  // Selections shape (FE-internal):
  //   { [qid]: string | string[] }
  // where each string is either a real option id (e.g. 'A') or the
  // synthetic OTHER_OPTION_ID. The actual user-typed free text for the
  // "其他…" entry lives in a parallel map (`otherText`) keyed by qid so
  // the textarea can keep its own state without polluting the radio
  // selection logic.
  //
  // Rehydrate strategy when `message.answers` already exists (we're
  // viewing a card from a previous turn or after a fork): walk every
  // wire-format value, and whenever we see an `other:<text>` string,
  // (a) replace it with OTHER_OPTION_ID in `selections` so the radio
  // light up correctly, and (b) stash the trailing text in
  // `otherText[qid]` so the textarea pre-fills with what was sent.
  const initial = useMemo(() => {
    const sel = {};
    const txt = {};
    if (answered && message?.answers && typeof message.answers === 'object') {
      for (const [qid, v] of Object.entries(message.answers)) {
        if (Array.isArray(v)) {
          sel[qid] = v.map((item) => {
            if (isOtherWireValue(item)) {
              txt[qid] = otherWireToText(item);
              return OTHER_OPTION_ID;
            }
            return item;
          });
        } else if (typeof v === 'string') {
          if (isOtherWireValue(v)) {
            sel[qid] = OTHER_OPTION_ID;
            txt[qid] = otherWireToText(v);
          } else {
            sel[qid] = v;
          }
        }
      }
    }
    return { sel, txt };
  }, [answered, message?.answers]);

  const [selections, setSelections] = useState(initial.sel);
  const [otherText, setOtherText] = useState(initial.txt);
  // Submit-lock: guards against double-clicks racing the IPC roundtrip.
  // Cleared via unmount or when the card transitions to `answered`.
  const [submitting, setSubmitting] = useState(false);

  // Per-question state helpers. Auto-appended "其他…" entries always
  // get appended after the model-emitted options, regardless of where
  // the model wanted them (it can't put them anywhere, since it can't
  // emit the synthetic id at all).
  const otherOption = useMemo(
    () => ({ id: OTHER_OPTION_ID, label: '其他…' }),
    [],
  );

  const otherSelected = useCallback(
    (qid, isMulti) => {
      const v = selections[qid];
      if (isMulti) return Array.isArray(v) && v.includes(OTHER_OPTION_ID);
      return v === OTHER_OPTION_ID;
    },
    [selections],
  );

  // A question counts as fully answered iff:
  //   1. some option (real or OTHER) is selected, AND
  //   2. if OTHER is selected, the textarea has non-whitespace content.
  const allAnswered = useMemo(() => {
    for (const q of questions) {
      const v = selections[q.id];
      const isMulti = Boolean(q.allow_multiple);
      if (isMulti) {
        if (!Array.isArray(v) || v.length === 0) return false;
        if (v.includes(OTHER_OPTION_ID)) {
          if (!String(otherText[q.id] ?? '').trim()) return false;
        }
      } else {
        if (!v || typeof v !== 'string') return false;
        if (v === OTHER_OPTION_ID) {
          if (!String(otherText[q.id] ?? '').trim()) return false;
        }
      }
    }
    return questions.length > 0;
  }, [questions, selections, otherText]);

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

  // Compose the wire payload: substitute every OTHER_OPTION_ID with
  // the corresponding `other:<text>` string so the model sees the user's
  // free-text answer inline with the picked options.
  const buildWireAnswers = useCallback(() => {
    const out = {};
    for (const q of questions) {
      const qid = q.id;
      const v = selections[qid];
      const free = String(otherText[qid] ?? '').trim();
      if (Array.isArray(v)) {
        out[qid] = v.map((item) =>
          item === OTHER_OPTION_ID ? `${OTHER_TEXT_PREFIX}${free}` : item,
        );
      } else if (typeof v === 'string') {
        out[qid] = v === OTHER_OPTION_ID ? `${OTHER_TEXT_PREFIX}${free}` : v;
      }
    }
    return out;
  }, [questions, selections, otherText]);

  const handleSubmit = useCallback(() => {
    if (!allAnswered || answered || submitting) return;
    setSubmitting(true);
    try {
      onReply?.(message.requestId, buildWireAnswers());
    } catch {
      setSubmitting(false);
    }
  }, [allAnswered, answered, submitting, onReply, message?.requestId, buildWireAnswers]);

  const handleCancel = useCallback(() => {
    if (answered || submitting) return;
    setSubmitting(true);
    try {
      onCancel?.(message.requestId);
    } catch {
      setSubmitting(false);
    }
  }, [answered, submitting, onCancel, message?.requestId]);

  const handleSkip = useCallback(() => {
    if (answered || submitting) return;
    setSubmitting(true);
    try {
      onSkip?.(message.requestId);
    } catch {
      setSubmitting(false);
    }
  }, [answered, submitting, onSkip, message?.requestId]);

  // Esc → Skip. We attach to the card root so the shortcut only fires
  // while focus is somewhere inside the card (or its descendants like
  // the textarea), not globally on the page. This avoids clobbering
  // other Esc handlers (composer cancel, modal dismiss, etc.).
  const cardRef = useRef(null);
  useEffect(() => {
    const root = cardRef.current;
    if (!root) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (answered) return;
      // Don't fight IME composition.
      if (e.isComposing) return;
      e.preventDefault();
      handleSkip();
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [answered, handleSkip]);

  // Header label tracks the resolved verb so users always see the
  // outcome explicitly: "已回复" / "已跳过" / "已取消" / pending.
  const headerLabel = !answered
    ? '请确认以下问题'
    : cancelled
      ? '已取消'
      : skipped
        ? '已跳过'
        : '已回复';

  return (
    <div
      className="my-2 max-w-full"
      ref={cardRef}
      // `tabIndex=-1` lets us focus the card programmatically and lets
      // descendant keydown bubble up here for the Esc handler.
      tabIndex={-1}
    >
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-violet-100 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-r from-violet-50/80 to-white border-b border-violet-100">
          <HelpCircle size={14} className="text-violet-500 shrink-0" />
          <span className="text-[12px] text-violet-700 font-medium">{headerLabel}</span>
          <span className="flex-1" />
          <span className="text-[10px] text-gray-400 font-mono">{questions.length} 题</span>
        </div>

        <div className="px-3.5 py-3 space-y-3">
          {questions.map((q, qi) => {
            const isMulti = Boolean(q.allow_multiple);
            const sel = selections[q.id];
            const isOtherOn = otherSelected(q.id, isMulti);

            const renderOption = (opt) => {
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
            };

            return (
              <div key={q.id || qi}>
                <div className="text-[12.5px] text-gray-700 font-medium mb-1.5 leading-snug">
                  <span className="text-gray-400 mr-1">Q{qi + 1}.</span>
                  {q.prompt}
                  {isMulti && <span className="ml-1 text-[10.5px] text-gray-400">（可多选）</span>}
                </div>
                <div className="space-y-0.5">
                  {Array.isArray(q.options) && q.options.map(renderOption)}
                  {/* Auto-appended free-text option. Always present, no
                      matter what the model emitted in `options`. */}
                  {renderOption(otherOption)}
                </div>
                {isOtherOn && (
                  <div className="mt-1.5 pl-7">
                    <textarea
                      value={otherText[q.id] ?? ''}
                      onChange={(e) =>
                        setOtherText((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        // Don't let Enter inside the textarea bubble up
                        // and accidentally submit the form; let Esc be
                        // handled by the root listener (skip).
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                      disabled={answered}
                      placeholder="请输入你的答案…（⌘+Enter 提交）"
                      rows={2}
                      spellCheck={false}
                      className={`w-full resize-y rounded-md border px-2 py-1.5 text-[12.5px] leading-snug transition-colors focus:outline-none focus:ring-1 ${
                        answered
                          ? 'border-gray-200 bg-gray-50 text-gray-500'
                          : 'border-gray-200 bg-white text-gray-800 focus:border-violet-300 focus:ring-violet-200 placeholder:text-gray-300'
                      }`}
                    />
                  </div>
                )}
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
            ) : skipped ? (
              <>
                <SkipForward size={11} className="text-amber-500" />
                <span>已跳过，由模型自行判断</span>
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
              disabled={submitting}
              className="px-2.5 py-1 rounded text-[11.5px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={submitting}
              title="跳过这次提问，由模型自行判断（Esc）"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11.5px] text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <SkipForward size={11} />
              跳过
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allAnswered || submitting}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded text-[11.5px] font-medium transition-colors ${
                allAnswered && !submitting
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
