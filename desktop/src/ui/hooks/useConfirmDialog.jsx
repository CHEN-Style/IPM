import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

const ConfirmCtx = createContext(null);

/**
 * Options:
 *   title        - heading
 *   message      - body text
 *   confirmLabel - confirm button text (default "确定")
 *   cancelLabel  - cancel button text (default "取消")
 *   danger       - boolean, red-styled confirm button
 *   requireInput - string | null, if set the user must type this exact string to enable confirm
 *   inputHint    - placeholder for the input
 */
export function ConfirmDialogProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ ...opts, inputValue: '' });
    });
  }, []);

  const handleClose = useCallback((result) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialogUI
          {...state}
          onInputChange={(v) => setState((s) => s ? { ...s, inputValue: v } : s)}
          onConfirm={() => handleClose(true)}
          onCancel={() => handleClose(false)}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirmDialog() {
  const fn = useContext(ConfirmCtx);
  if (!fn) throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  return fn;
}

function ConfirmDialogUI({
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  requireInput,
  inputHint,
  inputValue = '',
  onInputChange,
  onConfirm,
  onCancel,
}) {
  const needsInput = typeof requireInput === 'string' && requireInput.length > 0;
  const inputMatch = !needsInput || inputValue === requireInput;

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="w-[400px] rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: '#fff',
          border: '1px solid #e2e4ea',
          animation: 'confirmIn 150ms ease-out',
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-1">
          <h3 className="text-[15px] font-semibold text-slate-900">{title || '确认操作'}</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-3">
          {message && (
            <p className="text-[13px] text-slate-500 leading-relaxed whitespace-pre-line">{message}</p>
          )}

          {needsInput && (
            <div className="mt-3">
              <p className="text-[12px] text-slate-400 mb-1.5">
                请输入 <span className="font-semibold text-slate-600">「{requireInput}」</span> 以确认
              </p>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder={inputHint || requireInput}
                className="w-full h-9 px-3 rounded-lg border text-[13px] focus:outline-none transition-colors"
                style={{
                  borderColor: inputValue && !inputMatch ? '#fca5a5' : inputMatch && inputValue ? '#86efac' : '#e2e4ea',
                  color: '#334155',
                  background: '#fafbfc',
                }}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && inputMatch) onConfirm(); if (e.key === 'Escape') onCancel(); }}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 pt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors"
            style={{ color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!inputMatch}
            className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors shadow-sm"
            style={{
              background: !inputMatch ? '#e2e8f0' : danger ? '#ef4444' : '#3e4b9c',
              color: !inputMatch ? '#94a3b8' : '#fff',
              cursor: inputMatch ? 'pointer' : 'not-allowed',
              border: 'none',
            }}
            onMouseEnter={(e) => { if (inputMatch) e.currentTarget.style.background = danger ? '#dc2626' : '#4e5bab'; }}
            onMouseLeave={(e) => { if (inputMatch) e.currentTarget.style.background = danger ? '#ef4444' : '#3e4b9c'; }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirmIn {
          from { opacity: 0; transform: scale(0.96) translateY(-6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
