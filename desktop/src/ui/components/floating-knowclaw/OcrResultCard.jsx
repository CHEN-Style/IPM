// desktop/src/ui/components/floating-knowclaw/OcrResultCard.jsx
//
// FK5-3: result card shown after a successful OCR run, regardless of
// whether the source image came from the clipboard cache (📋) or a
// fresh full-screen capture (📷 → "仅 OCR" path in FK4).
//
// The card surfaces three primary actions and a small preview:
//
//   - "复制全部"     → `navigator.clipboard.writeText(text)`
//   - "追问 AI"      → inject an OCR quote block into FloatingInput
//   - "保存为笔记"   → `_floating/notes/<ts>.md`
//   - "×"            → dismiss
//
// The full OCR text is intentionally NOT shown in expanded form here
// — per the FK4/FK5 plan the user prefers a quick copy/use action.
// We do show a 6-line `line-clamp` snippet so the user can sanity-
// check the recognition before copying/saving.

import React, { useState } from 'react';
import { Copy, MessageSquarePlus, Save, X } from 'lucide-react';

export default function OcrResultCard({
  visible,
  text = '',
  confidence = 0,
  charCount = 0,
  source = 'clipboard',
  onCopy,
  onAskAi,
  onSaveNote,
  onClose,
}) {
  const [copyHint, setCopyHint] = useState('');
  const [saveHint, setSaveHint] = useState('');

  if (!visible) return null;

  const confidencePercent = Math.round((confidence || 0) * 100);
  const sourceLabel = source === 'capture' ? '全屏截图' : '剪贴板';
  const previewText = text || '（未识别出文字）';

  const handleCopy = async () => {
    const ok = (await onCopy?.()) ?? false;
    setCopyHint(ok ? '已复制' : '复制失败');
    setTimeout(() => setCopyHint(''), 1500);
  };

  const handleSave = async () => {
    const res = await onSaveNote?.();
    if (res?.ok) {
      setSaveHint('已保存到 _floating/notes/');
    } else {
      setSaveHint(res?.error ? '保存失败：' + res.error : '保存失败');
    }
    setTimeout(() => setSaveHint(''), 2000);
  };

  return (
    <div
      className="fk-card-in mx-3 mb-2 p-2.5 rounded-[14px] bg-white"
      style={{
        border: '1px solid rgba(226, 232, 240, 0.9)',
        boxShadow: '0 6px 20px rgba(15, 23, 42, 0.06)',
      }}
    >
      <div className="flex items-center justify-between mb-2 text-[11px] font-semibold text-slate-500">
        <span className="flex items-center gap-2">
          <span>OCR 结果</span>
          <span className="text-slate-400 font-medium">·</span>
          <span className="text-slate-400 font-medium">{sourceLabel}</span>
          {charCount ? (
            <>
              <span className="text-slate-400 font-medium">·</span>
              <span className="text-slate-400 font-medium">{charCount} 字</span>
            </>
          ) : null}
          {confidencePercent ? (
            <>
              <span className="text-slate-400 font-medium">·</span>
              <span className="text-slate-400 font-medium">置信度 {confidencePercent}%</span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-5 h-5 grid place-items-center rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600"
          title="关闭"
          aria-label="关闭"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>

      <div
        className="text-[12px] text-slate-700 leading-[1.55] whitespace-pre-wrap break-words mb-2"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 6,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          maxHeight: 6 * 18,
        }}
        title={text}
      >
        {previewText}
      </div>

      <div className="flex gap-1.5 items-center flex-wrap">
        <button
          type="button"
          onClick={handleCopy}
          disabled={!text}
          className="h-7 px-2.5 rounded-[9px] text-[11px] font-bold inline-flex items-center gap-1
                     border border-slate-200 bg-white text-slate-700
                     hover:border-slate-300 hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Copy size={12} strokeWidth={1.8} />
          复制全部
        </button>
        <button
          type="button"
          onClick={onAskAi}
          disabled={!text}
          className="h-7 px-2.5 rounded-[9px] text-[11px] font-bold inline-flex items-center gap-1
                     border bg-slate-900 text-white border-slate-900
                     hover:bg-slate-800
                     disabled:bg-slate-400 disabled:border-slate-400
                     disabled:cursor-not-allowed transition-colors"
        >
          <MessageSquarePlus size={12} strokeWidth={1.8} />
          追问 AI
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!text}
          className="h-7 px-2.5 rounded-[9px] text-[11px] font-bold inline-flex items-center gap-1
                     border border-slate-200 bg-white text-slate-700
                     hover:border-slate-300 hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={12} strokeWidth={1.8} />
          保存为笔记
        </button>

        {copyHint || saveHint ? (
          <span className="ml-auto text-[10px] text-slate-500 font-medium">
            {copyHint || saveHint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
