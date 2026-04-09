import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, SkipForward } from 'lucide-react';
import { useTour } from './TourProvider.jsx';

const PADDING = 8;
const TOOLTIP_GAP = 12;
const DEFAULT_TOOLTIP_WIDTH = 320;
const EDGE_MARGIN = 12;

function getTargetRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getBoundingClientRect();
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}

function calcTooltipPos(targetRect, placement, tooltipHeight, tooltipWidth) {
  const tw = tooltipWidth || DEFAULT_TOOLTIP_WIDTH;
  if (!targetRect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', arrowSide: null };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const th = tooltipHeight || 200;
  const cx = targetRect.left + targetRect.width / 2;
  const cy = targetRect.top + targetRect.height / 2;

  const preferred = placement ? [placement] : [];
  const allDirs = ['right', 'bottom', 'left', 'top'];
  const tryOrder = [...preferred, ...allDirs.filter((d) => !preferred.includes(d))];

  function tryPlace(dir) {
    let top, left;
    switch (dir) {
      case 'bottom':
        top = targetRect.bottom + PADDING + TOOLTIP_GAP;
        left = clamp(cx - tw / 2, EDGE_MARGIN, vw - tw - EDGE_MARGIN);
        if (top + th <= vh - EDGE_MARGIN) return { top, left, arrowSide: 'top' };
        return null;
      case 'top':
        top = targetRect.top - PADDING - TOOLTIP_GAP - th;
        left = clamp(cx - tw / 2, EDGE_MARGIN, vw - tw - EDGE_MARGIN);
        if (top >= EDGE_MARGIN) return { top, left, arrowSide: 'bottom' };
        return null;
      case 'right':
        left = targetRect.right + PADDING + TOOLTIP_GAP;
        top = clamp(cy - th / 2, EDGE_MARGIN, vh - th - EDGE_MARGIN);
        if (left + tw <= vw - EDGE_MARGIN) return { top, left, arrowSide: 'left' };
        return null;
      case 'left':
        left = targetRect.left - PADDING - TOOLTIP_GAP - tw;
        top = clamp(cy - th / 2, EDGE_MARGIN, vh - th - EDGE_MARGIN);
        if (left >= EDGE_MARGIN) return { top, left, arrowSide: 'right' };
        return null;
      default:
        return null;
    }
  }

  for (const dir of tryOrder) {
    const result = tryPlace(dir);
    if (result) return result;
  }

  return {
    top: clamp(cy - th / 2, EDGE_MARGIN, vh - th - EDGE_MARGIN),
    left: clamp(targetRect.right + PADDING + TOOLTIP_GAP, EDGE_MARGIN, vw - tw - EDGE_MARGIN),
    arrowSide: 'left',
  };
}

export default function TourOverlay() {
  const { isActive, currentStep, stepIndex, totalSteps, nextStep, prevStep, endTour } = useTour();
  const [targetRect, setTargetRect] = useState(null);
  const [tooltipHeight, setTooltipHeight] = useState(200);
  const tooltipRef = useRef(null);
  const rafRef = useRef(null);

  const updateRect = useCallback(() => {
    if (!isActive || !currentStep?.target) {
      setTargetRect(null);
      return;
    }
    const rect = getTargetRect(currentStep.target);
    setTargetRect(rect);
    rafRef.current = requestAnimationFrame(updateRect);
  }, [isActive, currentStep]);

  useEffect(() => {
    if (isActive) {
      rafRef.current = requestAnimationFrame(updateRect);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, updateRect]);

  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight);
    }
  }, [currentStep, targetRect]);

  // Scroll target into view
  useEffect(() => {
    if (!isActive || !currentStep?.target) return;
    const el = document.querySelector(currentStep.target);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive, currentStep]);

  // ESC to end tour
  useEffect(() => {
    if (!isActive) return;
    const handler = (e) => { if (e.key === 'Escape') endTour(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, endTour]);

  if (!isActive || !currentStep) return null;

  const tooltipWidth = currentStep.tooltipWidth || DEFAULT_TOOLTIP_WIDTH;
  const tooltipPos = calcTooltipPos(targetRect, currentStep.placement, tooltipHeight, tooltipWidth);

  // Spotlight clip-path: full-screen with a rectangular hole
  const spotlightStyle = targetRect
    ? {
        clipPath: `polygon(
          0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
          ${targetRect.left - PADDING}px ${targetRect.top - PADDING}px,
          ${targetRect.left - PADDING}px ${targetRect.bottom + PADDING}px,
          ${targetRect.right + PADDING}px ${targetRect.bottom + PADDING}px,
          ${targetRect.right + PADDING}px ${targetRect.top - PADDING}px,
          ${targetRect.left - PADDING}px ${targetRect.top - PADDING}px
        )`,
      }
    : {};

  // Highlight ring around target
  const ringStyle = targetRect
    ? {
        position: 'fixed',
        left: targetRect.left - PADDING,
        top: targetRect.top - PADDING,
        width: targetRect.width + PADDING * 2,
        height: targetRect.height + PADDING * 2,
        borderRadius: 8,
        border: '2px solid rgba(74, 158, 142, 0.6)',
        boxShadow: '0 0 0 4px rgba(74, 158, 142, 0.15), 0 0 20px rgba(74, 158, 142, 0.1)',
        pointerEvents: 'none',
        zIndex: 10000,
        transition: 'all 0.3s ease',
      }
    : null;

  const isLastStep = stepIndex === totalSteps - 1;
  const isFirstStep = stepIndex === 0;

  return (
    <>
      {/* Backdrop overlay with spotlight hole */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          zIndex: 9998,
          transition: 'clip-path 0.3s ease',
          ...spotlightStyle,
        }}
        onClick={endTour}
      />

      {/* Highlight ring */}
      {ringStyle && <div style={ringStyle} />}

      {/* Click-through zone over the target */}
      {targetRect && (
        <div
          style={{
            position: 'fixed',
            left: targetRect.left - PADDING,
            top: targetRect.top - PADDING,
            width: targetRect.width + PADDING * 2,
            height: targetRect.height + PADDING * 2,
            zIndex: 9999,
            cursor: 'pointer',
          }}
          onClick={(e) => {
            // Let the click pass through to the actual element
            const target = document.querySelector(currentStep.target);
            if (target) {
              e.stopPropagation();
              target.click();
              // Focus for inputs
              if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                target.focus();
              }
            }
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: tooltipWidth,
          zIndex: 10001,
          transition: 'top 0.3s ease, left 0.3s ease',
        }}
      >
        <div
          style={{
            background: 'white',
            borderRadius: 14,
            boxShadow: '0 20px 40px -8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
            overflow: 'hidden',
          }}
        >
          {/* Progress bar */}
          <div style={{ height: 3, background: '#F1F5F9' }}>
            <div
              style={{
                height: '100%',
                width: `${((stepIndex + 1) / totalSteps) * 100}%`,
                background: '#4a9e8e',
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div style={{ padding: '16px 20px' }}>
            {/* Step counter + close */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#4a9e8e', letterSpacing: '0.05em' }}>
                步骤 {stepIndex + 1} / {totalSteps}
              </span>
              <button
                onClick={endTour}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF',
                  padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#374151'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9CA3AF'; }}
                title="结束引导"
              >
                <X size={14} />
              </button>
            </div>

            {/* Title */}
            <h4 style={{ fontSize: 14, fontWeight: 600, color: '#1F2937', marginBottom: 6, lineHeight: 1.4 }}>
              {currentStep.title}
            </h4>

            {/* Content */}
            <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.7, marginBottom: 16 }}>
              {currentStep.content}
            </p>

            {/* Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                onClick={endTour}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: '#9CA3AF', padding: '4px 0',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#6B7280'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9CA3AF'; }}
              >
                <SkipForward size={12} />
                跳过教程
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!isFirstStep && (
                  <button
                    onClick={prevStep}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: 8,
                      border: '1px solid #E5E7EB', background: 'white',
                      fontSize: 12, color: '#6B7280', cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                  >
                    <ChevronLeft size={13} />
                    上一步
                  </button>
                )}

                {currentStep.advanceOn !== 'click' && (
                  <button
                    onClick={isLastStep ? endTour : nextStep}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '6px 14px', borderRadius: 8,
                      border: 'none', background: '#4a9e8e',
                      fontSize: 12, color: 'white', cursor: 'pointer',
                      fontWeight: 500, transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    {isLastStep ? '完成' : '下一步'}
                    {!isLastStep && <ChevronRight size={13} />}
                  </button>
                )}

                {currentStep.advanceOn === 'click' && (
                  <span style={{
                    fontSize: 11, color: '#4a9e8e', fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '6px 12px', borderRadius: 8,
                    background: 'rgba(74,158,142,0.06)',
                    border: '1px solid rgba(74,158,142,0.15)',
                  }}>
                    👆 请点击高亮区域
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
