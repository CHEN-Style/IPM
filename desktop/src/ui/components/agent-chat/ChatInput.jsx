import React, { useState, useRef, useCallback, useEffect, useId } from 'react';
import { ArrowUp, Loader2, ImagePlus, X, FileUp } from 'lucide-react';
import {
  resizeImageToBase64,
  makePreviewUrl,
  isSupportedImageFile,
} from './imageResize.js';

const MAX_ROWS = 6;
const MAX_ATTACHMENTS = 8;

// E.7: custom MIME type written by WorkspaceFileTree when a file row is
// dragged. Kept inline (not imported) so ChatInput doesn't reach across
// the agent-chat / knowclaw-v2 module boundary.
const TREE_DRAG_MIME = 'text/knowclaw-file-path';

let attachmentIdSeq = 0;
function nextAttachmentId() {
  attachmentIdSeq += 1;
  return `att-${attachmentIdSeq}`;
}

/**
 * U8b-5/9: KnowClaw composer with optional image attachments.
 *
 * E.7 additions: accepts both intra-app file-tree drags (`text/knowclaw-file-path`)
 * and native OS file drops. Tree drags insert `@relPath` references at the
 * caret. System file drops route through `onUploadFiles(filePaths, '')` (which
 * copies them into the workspace root) and then insert `@relPath` for each
 * successful upload. Image drops still go through the existing image-attachment
 * pipeline.
 *
 * @param {object} props
 * @param {(text: string, images?: Array<{ mimeType: string, data: string }>) => void} props.onSend
 * @param {boolean} [props.disabled]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.supportsImages] When false, hides the attach
 *   button and ignores paste/drop image events.
 * @param {(filePaths: string[], destRelDir: string) => Promise<{ ok: boolean, uploaded?: Array<{ relPath: string, name: string }>, skipped?: any[], error?: string }>} [props.onUploadFiles]
 *   E.7. Async upload to current workspace. When omitted, system file drops
 *   that aren't images are ignored.
 */
const ChatInput = ({ onSend, disabled, placeholder, supportsImages = false, onUploadFiles }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [modelNotice, setModelNotice] = useState('');
  // E.7: visual state while a drag is hovering. 'image' for image
  // drags, 'file' for tree-drag or non-image system drag, null otherwise.
  const [dragKind, setDragKind] = useState(null);
  // E.7: pending upload state — true while system files are being
  // copied into the workspace. Blocks duplicate drops on the same
  // batch and lets us show a spinner.
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef(attachments);
  const textRef = useRef(text);
  const inputId = useId();

  textRef.current = text;

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

  // E.7: insert `@relPath ` reference(s) at the textarea caret. Falls
  // back to appending when the textarea isn't focused. Uses a ref to
  // read the *latest* text (handlers' `text` closure may be stale
  // mid-batch).
  const insertReferences = useCallback((relPaths) => {
    if (!Array.isArray(relPaths) || relPaths.length === 0) return;
    const fragment = relPaths.map((p) => `@${p}`).join(' ') + ' ';
    const el = textareaRef.current;
    const current = textRef.current || '';
    if (!el || document.activeElement !== el) {
      // Not focused — append at end. Prepend a space if needed so we
      // don't glue onto existing text.
      const sep = current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : '';
      setText(current + sep + fragment);
      setTimeout(() => {
        textareaRef.current?.focus();
        const next = textareaRef.current;
        if (next) next.selectionStart = next.selectionEnd = next.value.length;
      }, 0);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const endSel = el.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(endSel);
    // Pad with a leading space if previous char isn't whitespace, so
    // the @ ref isn't accidentally glued to a prior word.
    const needsLeftPad = before.length > 0 && !/\s$/.test(before);
    const composed = `${before}${needsLeftPad ? ' ' : ''}${fragment}${after}`;
    setText(composed);
    const newCaret = (before + (needsLeftPad ? ' ' : '') + fragment).length;
    setTimeout(() => {
      const e2 = textareaRef.current;
      if (!e2) return;
      e2.focus();
      e2.selectionStart = e2.selectionEnd = newCaret;
    }, 0);
  }, []);

  // E.7: a single dragover handler accepts both image and non-image
  // drags, and both tree drags + system file drags. We classify the
  // drag to set the right visual state.
  const handleDragOver = useCallback((e) => {
    const types = e.dataTransfer?.types;
    if (!types) return;
    const list = Array.from(types);
    const isTreeDrag = list.includes(TREE_DRAG_MIME);
    const isFileDrag = list.includes('Files');
    if (!isTreeDrag && !isFileDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (isTreeDrag) {
      setDragKind('file');
    } else if (isFileDrag) {
      // We don't know yet if these are images or other files without
      // sniffing `files` (which is unavailable during dragover for
      // privacy). Default to 'file' when an upload handler exists,
      // else 'image' if image support is on, else still 'file' for
      // the visual cue (the drop will be ignored anyway).
      setDragKind(onUploadFiles ? 'file' : (supportsImages ? 'image' : 'file'));
    }
  }, [onUploadFiles, supportsImages]);

  const handleDragLeave = useCallback((e) => {
    // Only clear when the cursor leaves the composer entirely.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragKind(null);
  }, []);

  const handleDrop = useCallback(async (e) => {
    setDragKind(null);
    const dt = e.dataTransfer;
    if (!dt) return;
    // 1) Tree drag wins outright — even if a File somehow also rode
    //    along, the explicit reference intent supersedes upload.
    const treePath = dt.getData(TREE_DRAG_MIME);
    if (treePath) {
      e.preventDefault();
      insertReferences([treePath]);
      return;
    }
    const files = dt.files;
    if (!files || files.length === 0) return;

    const fileArr = Array.from(files);
    const imageFiles = supportsImages ? fileArr.filter(isSupportedImageFile) : [];
    const nonImageFiles = fileArr.filter((f) => !isSupportedImageFile(f));

    // 2) Images go through the existing attachment pipeline. We only
    //    preventDefault here so the browser doesn't navigate away on
    //    unhandled drops; the actual handler is addFiles.
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }

    // 3) Non-image files → upload IPC, then insert `@relPath` for each.
    if (nonImageFiles.length === 0) return;
    if (!onUploadFiles) {
      if (imageFiles.length === 0) {
        // Don't let the browser navigate to the dropped file.
        e.preventDefault();
      }
      return;
    }
    e.preventDefault();
    const filePaths = [];
    for (const f of nonImageFiles) {
      let p = '';
      try { p = window.ipm?.files?.getPathForFile?.(f) || ''; } catch { /* ignore */ }
      if (!p && typeof f.path === 'string') p = f.path;
      if (p) filePaths.push(p);
    }
    if (filePaths.length === 0) return;
    setUploading(true);
    try {
      const res = await onUploadFiles(filePaths, '');
      const uploaded = Array.isArray(res?.uploaded) ? res.uploaded : [];
      if (uploaded.length > 0) {
        insertReferences(uploaded.map((u) => u.relPath));
      }
    } finally {
      setUploading(false);
    }
  }, [supportsImages, addFiles, onUploadFiles, insertReferences]);

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
        className={`relative flex items-end gap-2 bg-gray-50 border rounded-2xl px-3 py-3 focus-within:bg-white focus-within:shadow-sm transition-all ${
          dragKind
            ? 'border-blue-400 ring-2 ring-blue-100 bg-blue-50/40'
            : 'border-gray-200 focus-within:border-gray-400'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* E.7: drag-over indicator. Sits as a centered pill so it
            doesn't reflow the composer, and uses pointer-events-none
            so it can't swallow the drop. */}
        {dragKind && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="px-3 py-1.5 rounded-full bg-blue-500/90 text-white text-[11px] flex items-center gap-1.5 shadow">
              <FileUp size={12} />
              <span>
                {dragKind === 'image'
                  ? '放开以添加图片附件'
                  : '放开以添加文件引用'}
              </span>
            </div>
          </div>
        )}
        {uploading && (
          <div
            className="pointer-events-none absolute right-3 top-1 text-[10px] text-blue-600 flex items-center gap-1"
            aria-live="polite"
          >
            <Loader2 size={10} className="animate-spin" />
            <span>正在上传...</span>
          </div>
        )}
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
        {onUploadFiles ? ' · 可从文件树或本机拖入文件引用' : ''}
      </p>
    </div>
  );
};

export default ChatInput;
