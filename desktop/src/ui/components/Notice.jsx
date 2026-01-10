import React, { useEffect } from 'react';

const STYLES = {
  info: {
    wrap: 'border-slate-200 bg-slate-50 text-slate-700',
    dot: 'bg-slate-400',
    title: '提示',
  },
  success: {
    wrap: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-500',
    title: '成功',
  },
  error: {
    wrap: 'border-rose-200 bg-rose-50 text-rose-800',
    dot: 'bg-rose-500',
    title: '失败',
  },
  warn: {
    wrap: 'border-amber-200 bg-amber-50 text-amber-900',
    dot: 'bg-amber-500',
    title: '注意',
  },
};

const Notice = ({ variant = 'info', message, onClose, autoCloseMs = 0, floating = false }) => {
  const s = STYLES[variant] || STYLES.info;
  if (!message) return null;

  useEffect(() => {
    if (!autoCloseMs || !onClose) return;
    const t = setTimeout(() => onClose(), autoCloseMs);
    return () => clearTimeout(t);
  }, [autoCloseMs, onClose, message]);

  const content = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClose?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose?.();
      }}
      className={`w-full border rounded-lg px-4 py-3 flex items-start gap-3 ${s.wrap} cursor-pointer shadow-sm`}
      title="点击关闭"
    >
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.dot}`} />
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-widest opacity-80">{s.title}</div>
        <div className="text-sm leading-relaxed break-words">{message}</div>
      </div>
    </div>
  );

  if (floating) {
    return (
      <div className="fixed top-3 left-0 right-0 z-[80] flex justify-center px-4 pointer-events-none">
        <div className="w-full max-w-[760px] pointer-events-auto">{content}</div>
      </div>
    );
  }

  return (
    content
  );
};

export default Notice;


