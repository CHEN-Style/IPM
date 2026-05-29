// desktop/src/ui/components/floating-knowclaw/CapturePreviewCard.jsx
//
// FK4-4: preview card shown between FloatingHeader and FloatingInput
// after a successful `capture/fullScreen`. The card displays a small
// thumbnail of the screenshot plus its native dimensions, and offers
// three explicit actions:
//
//   - "发送给 AI 总结"  → confirmCaptureSummary()
//   - "仅 OCR"          → confirmCaptureOcrOnly()
//   - "取消"            → dismissCapturePreview()
//
// There is NO automatic countdown — the user explicitly confirmed
// (FK4 plan) that they prefer to click manually, both because
// auto-send can fire mid-conversation and because the OCR job is
// the typical bottleneck. While OCR is still running we surface a
// tiny "OCR 中…" inline hint next to the primary button so the user
// understands the slight delay if they click immediately.
//
// Visual style is lifted from `k3-floating-knowclaw-demo.html`'s
// `.capture-preview` block, expressed in Tailwind utilities so we
// stay consistent with the rest of the floating UI.

import React from 'react';

export default function CapturePreviewCard({
  visible,
  thumbUrl,
  width = 0,
  height = 0,
  ocrRunning = false,
  saving = false,
  onSendSummary,
  onOcrOnly,
  onCancel,
}) {
  if (!visible) return null;

  const dimensionLabel = width && height ? `${width} × ${height}` : '';
  const disabled = !!saving;

  return (
    <div
      className="fk-card-in mx-3 mb-2 p-2.5 rounded-[14px] bg-white"
      style={{
        border: '1px solid rgba(226, 232, 240, 0.9)',
        boxShadow: '0 6px 20px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div className="flex items-center justify-between mb-2 text-[11px] font-semibold text-slate-500">
        <span>全屏截图已准备</span>
        {dimensionLabel ? <span>{dimensionLabel}</span> : null}
      </div>

      <div
        className="overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50"
        style={{ height: 74 }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt="capture preview"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
            draggable={false}
          />
        ) : null}
      </div>

      <div className="flex gap-1.5 mt-2 items-center">
        <button
          type="button"
          onClick={onSendSummary}
          disabled={disabled}
          className="h-7 px-2.5 rounded-[9px] text-[11px] font-bold
                     border bg-slate-900 text-white border-slate-900
                     hover:bg-slate-800 disabled:bg-slate-400 disabled:border-slate-400
                     disabled:cursor-not-allowed transition-colors"
          title="把截图发送给 AI 进行 2~4 段总结"
        >
          发送给 AI 总结
        </button>
        <button
          type="button"
          onClick={onOcrOnly}
          disabled={disabled}
          className="h-7 px-2.5 rounded-[9px] text-[11px] font-bold
                     border border-slate-200 bg-white text-slate-600
                     hover:border-slate-300 hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="仅运行 OCR，不调用 AI"
        >
          仅 OCR
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="h-7 px-2.5 rounded-[9px] text-[11px] font-bold
                     border border-slate-200 bg-white text-slate-600
                     hover:border-slate-300 hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="放弃这张截图"
        >
          取消
        </button>

        {ocrRunning ? (
          <span className="ml-auto text-[10px] text-slate-400 font-medium">
            OCR 中…
          </span>
        ) : null}
      </div>
    </div>
  );
}
