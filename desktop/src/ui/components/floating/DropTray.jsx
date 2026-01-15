import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, CheckCircle2, Loader2, Sparkles, Star } from 'lucide-react';

export const TrayState = Object.freeze({
  IDLE: 'IDLE',
  DRAGGING: 'DRAGGING',
  FILE_STAGED: 'FILE_STAGED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
});

// Particle Helper for the explosion
const generateParticles = (count) => {
  return Array.from({ length: count }).map((_, i) => ({
    id: i,
    tx: `${(Math.random() - 0.5) * 200}px`,
    ty: `${(Math.random() - 0.5) * 200}px`,
    rot: `${Math.random() * 360}deg`,
    color: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'][Math.floor(Math.random() * 4)],
    delay: `${Math.random() * 0.2}s`,
    shape: Math.random() > 0.5 ? '50%' : '0%', // Circle or Square
  }));
};

const DropTray = ({
  state,
  fileName,
  onFileDrop,
  onFilesDrop,
  onDragEnter,
  onDragLeave,
  isCompact = false,
  heightClass,
  hideIdleText = false,
  disabled = false,
  disabledText = '',
}) => {
  const inputRef = useRef(null);
  const [justDropped, setJustDropped] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [particles, setParticles] = useState([]);

  // Trigger "Land" animation reset
  useEffect(() => {
    if (state === TrayState.FILE_STAGED) {
      setJustDropped(true);
      const timer = setTimeout(() => setJustDropped(false), 300);
      return () => clearTimeout(timer);
    }

    // Trigger Confetti on Completion
    if (state === TrayState.COMPLETED) {
      triggerConfetti();
    } else {
      setShowConfetti(false);
    }
  }, [state]);

  const triggerConfetti = () => {
    setParticles(generateParticles(25));
    setShowConfetti(true);
    // Reset confetti after animation to allow re-trigger
    setTimeout(() => setShowConfetti(false), 1000);
  };

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const arr = Array.from(files);
        if (onFilesDrop) {
          onFilesDrop(arr);
        } else {
          onFileDrop?.(arr[0]);
        }
      }
    },
    [onFileDrop, onFilesDrop, disabled],
  );

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClick = () => {
    if (disabled) return;
    if (state === TrayState.IDLE) {
      inputRef.current?.click();
    }
    // Easter Egg: Re-trigger confetti when clicking completed state
    if (state === TrayState.COMPLETED) {
      triggerConfetti();
    }
  };

  const handleInputChange = (e) => {
    if (disabled) return;
    if (e.target.files && e.target.files.length > 0) {
      const arr = Array.from(e.target.files);
      if (onFilesDrop) {
        onFilesDrop(arr);
      } else {
        onFileDrop?.(arr[0]);
      }
    }
  };

  // Visual Styles based on state
  const getContainerStyle = () => {
    if (disabled) {
      return 'border-slate-200 bg-slate-50/40 opacity-70 cursor-not-allowed';
    }
    switch (state) {
      case TrayState.DRAGGING:
        return 'border-blue-500 bg-blue-50/80 scale-[0.98] ring-4 ring-blue-100 shadow-inner';
      case TrayState.FILE_STAGED:
        return `border-slate-300 bg-white shadow-sm ${justDropped ? 'animate-land' : ''}`;
      case TrayState.PROCESSING:
        return 'border-indigo-300 bg-indigo-50/30 overflow-hidden';
      case TrayState.COMPLETED:
        return 'border-emerald-400 bg-emerald-50/40 animate-success-pulse cursor-pointer';
      default: // IDLE
        return 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-100/50 hover:shadow-sm';
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragEnter={disabled ? undefined : onDragEnter}
      onDragLeave={disabled ? undefined : onDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`
        relative flex flex-col items-center justify-center w-full rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer
        ${getContainerStyle()}
        ${heightClass || (isCompact ? 'h-20' : 'h-32')}
      `}
    >
      <input type="file" ref={inputRef} onChange={handleInputChange} className="hidden" disabled={disabled} multiple />

      {/* Shimmer overlay for processing state */}
      {state === TrayState.PROCESSING && (
        <div className="absolute inset-0 pointer-events-none animate-shimmer opacity-50 z-0"></div>
      )}

      {/* Confetti Layer */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-visible flex items-center justify-center z-20">
          {particles.map((p) => (
            <div
              key={p.id}
              className="particle"
              style={{
                '--tx': p.tx,
                '--ty': p.ty,
                '--rot': p.rot,
                backgroundColor: p.color,
                borderRadius: p.shape,
                animationDelay: p.delay,
              }}
            />
          ))}
        </div>
      )}

      {/* Content Layer */}
      <div className={`z-10 flex flex-col items-center text-center transition-all duration-300 ${isCompact ? 'p-2' : 'p-4'}`}>
        {disabled ? (
          <div className="flex flex-col items-center">
            <div
              className={`rounded-full bg-slate-200/80 flex items-center justify-center text-slate-500 ${
                isCompact ? 'w-8 h-8 mb-0' : 'w-10 h-10 mb-2'
              }`}
            >
              <UploadCloud size={isCompact ? 16 : 20} />
            </div>
            {!isCompact && (
              <>
                <p className="text-sm font-semibold text-slate-500">已禁用</p>
                <p className="text-xs text-slate-400 mt-1">{disabledText || '该分类暂无可用目标'}</p>
              </>
            )}
          </div>
        ) : null}
        {state === TrayState.IDLE && (
          <div className="animate-slide-up flex flex-col items-center">
            <div
              className={`rounded-full bg-slate-200/80 flex items-center justify-center text-slate-500 transition-transform group-hover:scale-110 ${
                isCompact ? 'w-8 h-8 mb-0' : 'w-10 h-10 mb-2'
              }`}
            >
              <UploadCloud size={isCompact ? 16 : 20} />
            </div>
            {!isCompact && !hideIdleText && !disabled && (
              <>
                <p className="text-sm font-medium text-slate-600 mt-1">拖拽文件到这里</p>
                <p className="text-xs text-slate-400">或点击选择文件</p>
              </>
            )}
          </div>
        )}

        {state === TrayState.DRAGGING && (
          <div className="scale-110 transition-transform duration-200 flex flex-col items-center">
            <div
              className={`rounded-full bg-blue-100 flex items-center justify-center text-blue-600 ${
                isCompact ? 'w-8 h-8 mb-1' : 'w-10 h-10 mb-2'
              }`}
            >
              <UploadCloud size={isCompact ? 16 : 20} />
            </div>
            {!isCompact && <p className="text-sm font-bold text-blue-600 drop-shadow-sm">松开即可放入</p>}
          </div>
        )}

        {state === TrayState.FILE_STAGED && (
          <div className="animate-pop-in flex flex-col items-center">
            <div
              className={`rounded-full bg-orange-100 shadow-sm flex items-center justify-center text-orange-600 ${
                isCompact ? 'w-8 h-8 mb-1' : 'w-10 h-10 mb-2'
              }`}
            >
              <FileText size={isCompact ? 16 : 20} />
            </div>
            <p
              className={`font-semibold text-slate-800 line-clamp-1 break-all ${
                isCompact ? 'text-xs max-w-[150px]' : 'text-sm max-w-[200px]'
              }`}
            >
              {fileName}
            </p>
            {!isCompact && <p className="text-xs text-orange-600 mt-1 font-bold tracking-wide uppercase">已就绪</p>}
          </div>
        )}

        {state === TrayState.PROCESSING && (
          <div className="flex flex-col items-center">
            <div className={`flex items-center justify-center text-indigo-600 relative ${isCompact ? 'w-8 h-8 mb-0' : 'w-10 h-10 mb-2'}`}>
              <Loader2 size={isCompact ? 20 : 24} className="animate-spin relative z-10" />
              <div className="absolute inset-0 bg-indigo-200 rounded-full blur-md opacity-40 animate-pulse"></div>
            </div>
            {!isCompact && <p className="text-sm font-semibold text-indigo-800 animate-pulse">处理中...</p>}
          </div>
        )}

        {state === TrayState.COMPLETED && (
          <div className="animate-pop-in flex flex-col items-center relative">
            {/* Decorative Floating Stars */}
            <div className="absolute -top-6 -right-6 text-yellow-400 animate-float" style={{ animationDelay: '0s' }}>
              <Star size={12} fill="currentColor" />
            </div>
            <div className="absolute -bottom-2 -left-6 text-blue-400 animate-float" style={{ animationDelay: '1.5s' }}>
              <Star size={8} fill="currentColor" />
            </div>

            <div
              className={`relative rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm ${
                isCompact ? 'w-8 h-8 mb-1' : 'w-10 h-10 mb-2'
              }`}
            >
              <CheckCircle2 size={isCompact ? 20 : 24} strokeWidth={3} />
              <div className="absolute -top-1 -right-1 text-emerald-400 animate-bounce delay-100">
                <Sparkles size={12} fill="currentColor" />
              </div>
            </div>
            {!isCompact && <p className="text-sm font-bold text-emerald-800">保存成功</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default DropTray;


