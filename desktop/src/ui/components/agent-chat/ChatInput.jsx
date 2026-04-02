import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';

const MAX_ROWS = 6;

const ChatInput = ({ onSend, disabled, placeholder }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineH = 22;
    const maxH = lineH * MAX_ROWS + 24;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [text, adjustHeight]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend?.(trimmed);
    setText('');
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const hasContent = text.trim().length > 0;

  return (
    <div className="px-6 py-4">
      <div className="flex items-end gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 focus-within:border-gray-400 focus-within:bg-white focus-within:shadow-sm transition-all">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (disabled ? 'AI 正在思考...' : '输入消息...')}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none leading-[22px] disabled:opacity-50"
          style={{ minHeight: '22px' }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !hasContent}
          className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-all ${
            hasContent && !disabled
              ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {disabled ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowUp size={15} strokeWidth={2.5} />
          )}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-gray-400 text-center select-none">
        Enter 发送 · Shift+Enter 换行
      </p>
    </div>
  );
};

export default ChatInput;
