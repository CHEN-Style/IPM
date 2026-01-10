import React, { useEffect, useMemo, useRef, useState } from 'react';

const THEME = {
  info: {
    dot: 'bg-sky-400',
    ring: 'ring-sky-400/30',
    bg: 'bg-slate-900/90 backdrop-blur',
    border: 'border-slate-700/80',
    text: 'text-slate-100',
  },
  success: {
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-500/30',
    bg: 'bg-slate-900/90 backdrop-blur',
    border: 'border-emerald-500/30',
    text: 'text-slate-100',
  },
  error: {
    dot: 'bg-rose-500',
    ring: 'ring-rose-500/30',
    bg: 'bg-slate-900/90 backdrop-blur',
    border: 'border-rose-500/30',
    text: 'text-slate-100',
  },
  warn: {
    dot: 'bg-amber-500',
    ring: 'ring-amber-500/30',
    bg: 'bg-slate-900/90 backdrop-blur',
    border: 'border-amber-500/30',
    text: 'text-slate-100',
  },
};

/**
 * 右下角动态气泡：
 * - idle：小圆动态
 * - show：向左展开显示提示
 * - 4s 自动收回 / 点击任意区域收回
 */
const ToastBubble = ({ notice, onClear, autoCloseMs = 4000 }) => {
  const hasNotice = Boolean(notice?.message);
  const variant = notice?.variant || 'info';
  const theme = THEME[variant] || THEME.info;

  // expanded controls animation; when closing we shrink first then clear content
  const [expanded, setExpanded] = useState(false);
  const closeTimer = useRef(null);
  const clearTimer = useRef(null);

  const message = useMemo(() => String(notice?.message || ''), [notice?.message]);

  useEffect(() => {
    if (!hasNotice) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setExpanded(false);
    }, autoCloseMs);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [hasNotice, autoCloseMs, message]);

  useEffect(() => {
    // When collapsed and we still have notice content, clear after transition.
    if (!hasNotice) return;
    if (expanded) return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => onClear?.(), 260);
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [expanded, hasNotice, onClear]);

  const handleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setExpanded(false);
  };

  return (
    <div className="absolute bottom-4 right-4 z-[95] select-none">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClose();
        }}
        className={[
          'h-11',
          'flex items-center',
          'shadow-lg',
          'border',
          'transition-all duration-300 ease-out',
          'overflow-hidden',
          expanded ? 'w-[360px] rounded-2xl' : 'w-11 rounded-full',
          theme.bg,
          theme.border,
          theme.text,
        ].join(' ')}
        title={expanded ? '点击收回' : '通知'}
      >
        <div className="w-11 h-11 flex items-center justify-center flex-shrink-0">
          <div className={`relative w-3 h-3 rounded-full ${theme.dot}`}>
            {!expanded ? (
              <>
                <div className={`absolute inset-0 rounded-full ${theme.dot} opacity-50 animate-ping`} />
                <div className={`absolute -inset-2 rounded-full ring-2 ${theme.ring} opacity-40`} />
              </>
            ) : null}
          </div>
        </div>

        <div className={`min-w-0 pr-4 transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
          <div className="text-[11px] font-bold uppercase tracking-widest opacity-70">通知</div>
          <div className="text-sm leading-snug truncate">{message}</div>
        </div>
      </div>
    </div>
  );
};

export default ToastBubble;


