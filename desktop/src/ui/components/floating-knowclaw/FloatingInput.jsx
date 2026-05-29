// desktop/src/ui/components/floating-knowclaw/FloatingInput.jsx
//
// FK1: input control of the floating-window KnowClaw panel.
//
// Visual contract (per `Agent/k3-floating-knowclaw-demo.html`):
//   - Pill-shaped textarea container: slate-50 background, slate-200
//     border, 18px corner radius, inner highlight via inset shadow.
//   - Textarea fills the entire panel body (300px+ tall in compact
//     mode, shrinks to ~78px when the panel is expanded for chat
//     list). Padding leaves room for the bottom-right send button
//     and bottom-left quick-action row so neither overlaps the text.
//   - Bottom-left: three 32x32 icon-only quick-action buttons —
//     camera (screenshot), document (OCR), plus (attach file). FK1
//     stubs all three; FK4/FK5 add the real wiring.
//   - Bottom-right: send button (dark slate, arrow icon).
//   - Custom thin scrollbar styled via injected `<style>` so the
//     gutter is stable and never overlaps the bottom buttons.
//
// Behaviour:
//   - Enter sends; Shift+Enter inserts a newline.
//   - Empty/whitespace input no-ops Enter (matches main-window
//     `ChatInput` so user expectations carry over).
//   - During streaming, Enter is repurposed to "中止" via a small
//     swap of the send button into an abort icon. FK1 keeps the
//     button visible but tooltips the change; FK3 may add the
//     full "steer/followUp" overlay.

import React, { forwardRef, useCallback, useId, useImperativeHandle, useRef, useState } from 'react';
import { ArrowRight, Camera, FileText, Plus, Square } from 'lucide-react';

// FK4-5 + FK5-5:
//   - `disabledQuickActions` lets KnowClawFloating disable the
//     camera/OCR/attach buttons while a capture preview is on screen
//     or while we're streaming, preventing duplicate triggers.
//   - The `ref` exposes `injectText(text)` / `appendText(text)` so the
//     OcrResultCard's "追问 AI" action can drop a quoted OCR block
//     into the textarea without lifting state up to the parent.
const FloatingInput = forwardRef(function FloatingInput({
  onSend,
  onAbort,
  onScreenshot,
  onOcr,
  onAttachFile,
  streaming = false,
  expanded = false,
  disabledQuickActions = false,
}, ref) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  useImperativeHandle(ref, () => ({
    injectText: (text) => {
      const str = String(text ?? '');
      setValue(str);
      // Defer focus so the value change has flushed to the DOM before
      // we move the caret to the end of the inserted block.
      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        try {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = str.length;
        } catch { /* ignore */ }
      }, 0);
    },
    appendText: (text) => {
      const str = String(text ?? '');
      setValue((v) => (v ? `${v}\n${str}` : str));
      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        try {
          ta.focus();
          const end = ta.value.length;
          ta.selectionStart = ta.selectionEnd = end;
        } catch { /* ignore */ }
      }, 0);
    },
    focus: () => {
      try { textareaRef.current?.focus(); } catch { /* ignore */ }
    },
    clear: () => setValue(''),
  }), []);
  // Unique class id per mount so the scoped <style> doesn't collide
  // with sibling Floating components (defensive — there's only ever
  // one panel mounted at a time).
  const scopeId = useId().replace(/[:]/g, '');
  const scrollbarClass = `fk-input-${scopeId}`;

  const fireSend = useCallback(async () => {
    const text = value.trim();
    if (!text) return;
    if (streaming) return; // FK3 will route to steer/followUp instead
    // Clear synchronously so the user's next keystroke goes to an
    // empty box even before the IPC ack returns.
    setValue('');
    try {
      await onSend?.(text);
    } catch {
      // Hook surfaces error via its own state; we don't restore the
      // text because the user can re-type if needed (rare path).
    }
  }, [value, streaming, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      void fireSend();
    }
  }, [fireSend]);

  const fireQuickAction = useCallback((label, handler) => {
    if (typeof handler === 'function') {
      handler();
      return;
    }
    // eslint-disable-next-line no-console
    console.info(`[KnowClawFloating] ${label} — FK4/FK5 待接线`);
  }, []);

  const handleAbort = useCallback(() => {
    if (typeof onAbort === 'function') onAbort();
  }, [onAbort]);

  return (
    <>
      {/* Scoped scrollbar styling — kept inline so this component is
          drop-in and doesn't depend on a global stylesheet. The
          gutter math (top:10 / bottom:46) mirrors the demo's
          adjusted track so the scrollbar visually starts/ends inside
          the textarea padding, never under the buttons. */}
      <style>{`
        .${scrollbarClass} textarea {
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.42) transparent;
        }
        .${scrollbarClass} textarea::-webkit-scrollbar {
          width: 9px;
        }
        .${scrollbarClass} textarea::-webkit-scrollbar-track {
          margin: 10px 0 46px;
          background: transparent;
        }
        .${scrollbarClass} textarea::-webkit-scrollbar-thumb {
          min-height: 32px;
          border: 3px solid transparent;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.45);
          background-clip: padding-box;
        }
        .${scrollbarClass} textarea::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 0.5);
          background-clip: padding-box;
        }
      `}</style>

      <div
        className={`${scrollbarClass} flex flex-1 bg-white`}
        style={{ padding: expanded ? '10px 12px 12px' : '12px 16px 16px' }}
      >
        <div
          className="relative flex flex-1 items-end gap-2 rounded-[18px] border border-slate-200 bg-slate-50"
          style={{
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.72)',
            minHeight: expanded ? 78 : undefined,
            borderRadius: expanded ? 14 : 18,
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问 KnowClaw，或描述你想从截图中获得什么..."
            className="flex-1 w-full h-full bg-transparent border-0 outline-none resize-none
                       text-slate-800 text-[13px] leading-[1.45]
                       placeholder:text-slate-400 overflow-y-auto"
            style={{
              minHeight: expanded ? 78 : 150,
              padding: expanded ? '12px 60px 48px 12px' : '18px 64px 56px 18px',
              marginRight: 3,
            }}
            // No autoFocus: the floating window blurs aggressively
            // (setAlwaysOnTop's screen-saver level) and stealing
            // focus on every mount thrashes the user's keyboard
            // focus in other apps. The user clicks/Tabs into the
            // textarea when they want to type.
          />

          {/* Quick action row — bottom-left */}
          <div
            className="absolute flex gap-1.5 z-[2]"
            style={{ left: 10, bottom: 10 }}
          >
            <button
              type="button"
              onClick={() => fireQuickAction('截屏总结', onScreenshot)}
              disabled={disabledQuickActions}
              className="w-8 h-8 grid place-items-center p-0
                         border border-slate-200 rounded-[10px] bg-white text-slate-600
                         hover:border-slate-300 hover:bg-slate-50
                         hover:-translate-y-[1px] transition-all duration-150
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              title="截屏总结"
              aria-label="截屏总结"
            >
              <Camera size={15} strokeWidth={1.75} className="text-slate-500" />
            </button>
            <button
              type="button"
              onClick={() => fireQuickAction('OCR 提取', onOcr)}
              disabled={disabledQuickActions}
              className="w-8 h-8 grid place-items-center p-0
                         border border-slate-200 rounded-[10px] bg-white text-slate-600
                         hover:border-slate-300 hover:bg-slate-50
                         hover:-translate-y-[1px] transition-all duration-150
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              title="OCR 提取"
              aria-label="OCR 提取"
            >
              <FileText size={15} strokeWidth={1.75} className="text-slate-500" />
            </button>
            <button
              type="button"
              onClick={() => fireQuickAction('添加文件', onAttachFile)}
              disabled={disabledQuickActions}
              className="w-8 h-8 grid place-items-center p-0
                         border border-slate-200 rounded-[10px] bg-white text-slate-600
                         hover:border-slate-300 hover:bg-slate-50
                         hover:-translate-y-[1px] transition-all duration-150
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              title="添加文件（FK6 接入）"
              aria-label="添加文件"
            >
              <Plus size={15} strokeWidth={1.75} className="text-slate-500" />
            </button>
          </div>

          {/* Send / Abort button — bottom-right */}
          <button
            type="button"
            onClick={streaming ? handleAbort : fireSend}
            disabled={!streaming && value.trim().length === 0}
            className="absolute w-8 h-8 grid place-items-center
                       border-0 rounded-[10px] bg-slate-900 text-white
                       hover:bg-slate-700
                       disabled:bg-slate-300 disabled:cursor-not-allowed
                       transition-colors"
            style={{ right: 10, bottom: 10 }}
            title={streaming ? '中止当前回答' : '发送 (Enter)'}
            aria-label={streaming ? '中止' : '发送'}
          >
            {streaming ? <Square size={13} fill="currentColor" /> : <ArrowRight size={15} strokeWidth={2} />}
          </button>
        </div>
      </div>
    </>
  );
});

export default FloatingInput;
