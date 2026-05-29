// desktop/src/ui/components/floating-knowclaw/BubbleView.jsx
//
// FK2-6: standalone React component for the external assistant
// bubble window. This is a "dumb renderer" — it subscribes to
// `bubble:content` IPC events and renders the received HTML.
// The window itself is a frameless transparent BrowserWindow
// positioned next to the floating window by the main process.
//
// Visual design is lifted from the demo's `.assistant-bubble` CSS.

import React, { useCallback, useEffect, useRef, useState } from 'react';

export default function BubbleView() {
  const [html, setHtml] = useState('');
  const [thinking, setThinking] = useState(false);
  const [visible, setVisible] = useState(false);
  // FK4-6: full OCR text shipped alongside the assistant turn. We
  // never render this in the bubble — it only feeds the "复制 OCR
  // 原文" button so the user can pull the recognised text into the
  // system clipboard without scrolling through a fold.
  const [ocrText, setOcrText] = useState('');
  const [copyHint, setCopyHint] = useState('');
  const contentRef = useRef(null);

  useEffect(() => {
    const off = window.ipm?.bubble?.onContent?.(({ html: h, thinking: t, ocrText: o }) => {
      setHtml(h || '');
      setThinking(!!t);
      // Replace (not append): each assistant turn ships its own
      // ocrText, and an empty string from the floating window means
      // "the next turn has no associated OCR" — we want to hide the
      // button rather than leak the previous turn's text.
      setOcrText(typeof o === 'string' ? o : '');
      setCopyHint('');
      setVisible(true);
    });
    return () => off?.();
  }, []);

  const handleCopyOcr = useCallback(async () => {
    if (!ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrText);
      setCopyHint('已复制');
    } catch {
      setCopyHint('复制失败');
    }
    setTimeout(() => setCopyHint(''), 1500);
  }, [ocrText]);

  // Auto-scroll when content updates
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [html]);

  const handleExpand = useCallback(() => {
    window.ipm?.bubble?.expandRequest?.();
  }, []);

  const handleDismiss = useCallback(() => {
    window.ipm?.bubble?.hide?.();
    setVisible(false);
  }, []);

  if (!visible && !html) return null;

  return (
    <div
      className="bubble-root"
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        overflow: 'hidden',
        padding: 10,
        boxSizing: 'border-box',
        fontFamily: "'Inter', 'SF Pro Display', -apple-system, 'Microsoft YaHei', sans-serif",
      }}
    >
      <style>{`
        .bubble-root * { box-sizing: border-box; }

        .assistant-bubble {
          position: relative;
          padding: 16px 17px;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid rgba(226, 232, 240, 0.9);
          box-shadow:
            0 18px 48px rgba(15, 23, 42, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.85);
          animation: bubble-in 180ms ease-out both;
          width: 100%;
          max-height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        @keyframes bubble-in {
          from {
            opacity: 0;
            transform: translateX(8px) translateY(4px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateX(0) translateY(0) scale(1);
          }
        }

        .bubble-label {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.4px;
        }
        .bubble-label .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #10b981;
          flex-shrink: 0;
        }
        .bubble-label .dot.thinking {
          background: #818cf8;
          animation: pulse-dot 1.2s ease-in-out infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .bubble-content {
          flex: 1;
          overflow-y: auto;
          font-size: 13px;
          line-height: 1.72;
          color: #1e293b;
          scrollbar-width: thin;
          scrollbar-color: rgba(148,163,184,0.35) transparent;
        }
        .bubble-content::-webkit-scrollbar { width: 6px; }
        .bubble-content::-webkit-scrollbar-track { background: transparent; }
        .bubble-content::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(148,163,184,0.35);
        }
        .bubble-content p { margin: 0; }
        .bubble-content p + p { margin-top: 8px; }
        .bubble-content code {
          padding: 1px 5px;
          border-radius: 5px;
          background: #f1f5f9;
          font-size: 12px;
        }
        .bubble-content pre {
          margin: 8px 0;
          padding: 10px 12px;
          border-radius: 10px;
          background: #f8fafc;
          font-size: 11px;
          overflow-x: auto;
        }
        .bubble-content ul, .bubble-content ol {
          margin: 6px 0;
          padding-left: 20px;
        }
        .bubble-content li { margin: 3px 0; }
        .bubble-content strong { font-weight: 600; color: #0f172a; }

        .streaming-cursor {
          display: inline-block;
          width: 2px;
          height: 15px;
          margin-left: 3px;
          vertical-align: -2px;
          background: #334155;
          animation: cursor-blink 900ms infinite;
        }
        @keyframes cursor-blink {
          0%, 45% { opacity: 1; }
          46%, 100% { opacity: 0; }
        }

        .bubble-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid rgba(148, 163, 184, 0.15);
        }
        .bubble-btn {
          padding: 5px 12px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: white;
          color: #475569;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 120ms ease;
          outline: none;
        }
        .bubble-btn:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          color: #1e293b;
        }
        .bubble-btn.primary {
          background: #4f46e5;
          border-color: #4f46e5;
          color: white;
        }
        .bubble-btn.primary:hover {
          background: #4338ca;
          border-color: #4338ca;
        }
      `}</style>

      <div className="assistant-bubble">
        <div className="bubble-label">
          <span className={`dot${thinking ? ' thinking' : ''}`} />
          <span>{thinking ? 'KnowClaw 正在分析' : 'KnowClaw 回复'}</span>
        </div>

        <div
          ref={contentRef}
          className="bubble-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {thinking && <span className="streaming-cursor" />}

        <div className="bubble-actions">
          <button type="button" className="bubble-btn primary" onClick={handleExpand}>
            展开到悬浮窗内
          </button>
          <button type="button" className="bubble-btn" onClick={handleDismiss}>
            收起
          </button>
          {ocrText ? (
            <button
              type="button"
              className="bubble-btn"
              onClick={handleCopyOcr}
              title={`复制 OCR 原文（${ocrText.length} 字）`}
            >
              {copyHint || '复制 OCR 原文'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
