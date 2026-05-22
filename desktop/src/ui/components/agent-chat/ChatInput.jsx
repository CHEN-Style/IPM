import React, { useState, useRef, useCallback, useEffect, useId } from 'react';
import { ArrowUp, Loader2, ImagePlus, X } from 'lucide-react';
import {
  resizeImageToBase64,
  makePreviewUrl,
  isSupportedImageFile,
} from './imageResize.js';

const MAX_ROWS = 6;
const MAX_ATTACHMENTS = 8;

let attachmentIdSeq = 0;
function nextAttachmentId() {
  attachmentIdSeq += 1;
  return `att-${attachmentIdSeq}`;
}

/**
 * U8b-5/9: KnowClaw composer with optional image attachments.
 *
 * @param {object} props
 * @param {(text: string, images?: Array<{ mimeType: string, data: string }>) => void} props.onSend
 * @param {boolean} [props.disabled]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.supportsImages] When false, hides the attach
 *   button and ignores paste/drop image events.
 */
const ChatInput = ({ onSend, disabled, placeholder, supportsImages = false }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [modelNotice, setModelNotice] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef(attachments);
  const inputId = useId();

  attachmentsRef.current = attachments;

  const resizing = attachments.some((a) => a.resizing);
  const readyCount = attachments.filter((a) => a.data && !a.resizing && !a.error).length;
  const hasContent = text.trim().length > 0 || readyCount > 0;
  const canSubmit = hasContent && !disabled && !resizing;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineH = 22;
    const maxH = lineH * MAX_ROWS + 24;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [text, adjustHeight]);

  const prevSupportsRef = useRef(supportsImages);
  useEffect(() => {
    if (prevSupportsRef.current && !supportsImages && attachmentsRef.current.length > 0) {
      setAttachments((prev) => {
        prev.forEach((a) => {
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        });
        return [];
      });
      setModelNotice('当前模型不支持图片，已清除待发送的图片');
    }
    prevSupportsRef.current = supportsImages;
  }, [supportsImages]);

  useEffect(() => {
    if (!modelNotice) return undefined;
    const t = setTimeout(() => setModelNotice(''), 4000);
    return () => clearTimeout(t);
  }, [modelNotice]);

  const revokePreview = useCallback((att) => {
    if (att?.previewUrl) {
      try { URL.revokeObjectURL(att.previewUrl); } catch { /* ignore */ }
    }
  }, []);

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) revokePreview(target);
      return prev.filter((a) => a.id !== id);
    });
  }, [revokePreview]);

  const addFiles = useCallback(async (files) => {
    if (!supportsImages || !files?.length) return;
    const incoming = Array.from(files).filter(isSupportedImageFile);
    if (incoming.length === 0) return;

    const stubs = [];
    setAttachments((prev) => {
      const slotsLeft = MAX_ATTACHMENTS - prev.length;
      if (slotsLeft <= 0) return prev;
      for (const file of incoming.slice(0, slotsLeft)) {
        stubs.push({
          id: nextAttachmentId(),
          file,
          previewUrl: makePreviewUrl(file),
          mimeType: null,
          data: null,
          resizing: true,
          error: null,
        });
      }
      return stubs.length ? [...prev, ...stubs] : prev;
    });

    for (const stub of stubs) {
      try {
        const result = await resizeImageToBase64(stub.file);
        setAttachments((prev) => prev.map((item) => (
          item.id === stub.id
            ? {
              ...item,
              resizing: false,
              mimeType: result.mimeType,
              data: result.data,
              error: null,
            }
            : item
        )));
      } catch (err) {
        setAttachments((prev) => prev.map((item) => (
          item.id === stub.id
            ? { ...item, resizing: false, error: err?.message || '图片处理失败' }
            : item
        )));
      }
    }
  }, [supportsImages]);

  const handleFileInputChange = useCallback((e) => {
    const { files } = e.target;
    if (files?.length) addFiles(files);
    e.target.value = '';
  }, [addFiles]);

  const handlePaste = useCallback((e) => {
    if (!supportsImages) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f && isSupportedImageFile(f)) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }, [supportsImages, addFiles]);

  const handleDragOver = useCallback((e) => {
    if (!supportsImages) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [supportsImages]);

  const handleDrop = useCallback((e) => {
    if (!supportsImages) return;
    const { files } = e.dataTransfer || {};
    if (!files?.length) return;
    const imageFiles = Array.from(files).filter(isSupportedImageFile);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    addFiles(imageFiles);
  }, [supportsImages, addFiles]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    const images = attachments
      .filter((a) => a.data && a.mimeType && !a.resizing && !a.error)
      .map((a) => ({ mimeType: a.mimeType, data: a.data }));
    if ((!trimmed && images.length === 0) || disabled || resizing) return;
    onSend?.(trimmed, images.length > 0 ? images : undefined);
    setText('');
    setAttachments((prev) => {
      prev.forEach(revokePreview);
      return [];
    });
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [text, disabled, resizing, attachments, onSend, revokePreview]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  useEffect(() => () => {
    attachmentsRef.current.forEach(revokePreview);
  }, [revokePreview]);

  return (
    <div className="px-6 py-4">
      {modelNotice && (
        <p className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
          {modelNotice}
        </p>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 shrink-0"
            >
              {att.previewUrl && !att.error && (
                <img
                  src={att.previewUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
              {att.resizing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2 size={16} className="text-white animate-spin" />
                </div>
              )}
              {att.error && (
                <div className="absolute inset-0 flex items-center justify-center p-1 text-[9px] text-red-600 text-center bg-red-50">
                  失败
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                title="移除图片"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-3 focus-within:border-gray-400 focus-within:bg-white focus-within:shadow-sm transition-all"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {supportsImages && (
          <>
            <input
              id={inputId}
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <button
              type="button"
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              title={attachments.length >= MAX_ATTACHMENTS ? `最多 ${MAX_ATTACHMENTS} 张` : '添加图片'}
            >
              <ImagePlus size={18} strokeWidth={1.75} />
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder || (disabled ? 'AI 正在思考...' : '输入消息...')}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none leading-[22px] disabled:opacity-50 min-w-0"
          style={{ minHeight: '22px' }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-all ${
            canSubmit
              ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {disabled || resizing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowUp size={15} strokeWidth={2.5} />
          )}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-gray-400 text-center select-none">
        Enter 发送 · Shift+Enter 换行
        {supportsImages ? ' · 可粘贴或拖拽图片' : ''}
      </p>
    </div>
  );
};

export default ChatInput;
