import React, { useState, useRef, useCallback, useEffect, useId } from 'react';
import { ArrowUp, Loader2, Paperclip, X, FileUp, AtSign, Puzzle } from 'lucide-react';
import {
  resizeImageToBase64,
  makePreviewUrl,
  isSupportedImageFile,
} from './imageResize.js';
import { renderHighlightOverlay, parseFileRefs, findChipForDeletion } from './fileRefRender.jsx';

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
 * KnowClaw composer.
 *
 * Layout (post UI revamp):
 *   ┌─ pinned skill chip strip (if any) ─────────────────────────────────┐
 *   ┌─ attachment thumbnails (if any) ───────────────────────────────────┐
 *   ┌─ composer card ────────────────────────────────────────────────────┐
 *   │  top action row  : @-insert  ·  📎 add file                        │
 *   │  textarea        : auto-grow up to MAX_ROWS                        │
 *   │  bottom toolbar  : [bottomLeftActions]   [bottomRightActions] send │
 *   └────────────────────────────────────────────────────────────────────┘
 *   bottom helper text
 *
 * Migration notes (UI revamp):
 *   - The single attach-image button became a single "add file" button.
 *     When `supportsImages` is true and an image is picked, it still
 *     flows through the existing image-attachment pipeline (base64
 *     resize). Non-image files always route through `onUploadFiles`
 *     (workspace copy + `@relPath` insertion).
 *   - Plan/Agent toggle, Model selector, SkillSelector and the
 *     workspace selector previously rendered in the page header have
 *     moved into the bottom toolbar via the `bottomLeftActions` /
 *     `bottomRightActions` slots. ChatInput is intentionally
 *     KnowClaw-agnostic — it just renders whatever React nodes are
 *     passed in.
 *
 * @param {object} props
 * @param {(text: string, images?: Array<{ mimeType: string, data: string }>, pinnedSkills?: string[]) => void} props.onSend
 * @param {boolean} [props.disabled]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.supportsImages] When true, attach button also
 *   accepts images and pasted images. Non-image attachments are still
 *   handled by `onUploadFiles` regardless of this flag.
 * @param {(filePaths: string[], destRelDir: string) => Promise<{ ok: boolean, uploaded?: Array<{ relPath: string, name: string }>, skipped?: any[], error?: string }>} [props.onUploadFiles]
 *   Async upload to the current workspace. Files come either from
 *   native drag-drop, OS file picker, or the attach button. When
 *   omitted, non-image attachments and tree drags are ignored.
 * @param {React.ReactNode} [props.bottomLeftActions] Rendered on the
 *   left side of the composer's bottom toolbar (Plan/Agent toggle,
 *   model selector, skill selector, etc.).
 * @param {React.ReactNode} [props.bottomRightActions] Rendered between
 *   the right side of the bottom toolbar and the send button (workspace
 *   selector, future mic/voice, etc.).
 * @param {Array<string>} [props.pinnedSkills] Names of skills currently
 *   pinned for this turn. Rendered as removable chips above the
 *   composer card and forwarded back through `onSend`.
 * @param {(name: string) => void} [props.onSkillRemove] Remove a single
 *   pinned skill (called when the user clicks the X on a chip).
 * @param {string} [props.hint] Optional helper text rendered below the
 *   composer. Defaults to the canonical Enter/Shift+Enter hint plus
 *   feature-gated suffixes.
 */
const ChatInput = ({
  onSend,
  disabled,
  placeholder,
  supportsImages = false,
  onUploadFiles,
  bottomLeftActions = null,
  bottomRightActions = null,
  pinnedSkills = null,
  onSkillRemove = null,
  hint = '',
}) => {
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
  // Highlight overlay refs: the outer div is the clipping window
  // (matches the textarea's visible rect), the inner div holds the
  // actual rendered chip backgrounds and gets translated up/down
  // in sync with the textarea's `scrollTop`.
  const overlayInnerRef = useRef(null);

  textRef.current = text;

  attachmentsRef.current = attachments;

  const resizing = attachments.some((a) => a.resizing);
  const readyCount = attachments.filter((a) => a.data && !a.resizing && !a.error).length;
  const hasContent = text.trim().length > 0 || readyCount > 0;
  const canSubmit = hasContent && !disabled && !resizing;
  const attachAvailable = Boolean(onUploadFiles) || supportsImages;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineH = 22;
    const maxH = lineH * MAX_ROWS + 24;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => { adjustHeight(); }, [text, adjustHeight]);

  // Keep the highlight overlay aligned with the textarea's scroll
  // position. When `text` exceeds MAX_ROWS the textarea scrolls
  // internally; the overlay sits behind it and would otherwise stay
  // pinned at line 0, drifting visually away from the textarea
  // glyphs. We translate the inner overlay by -scrollTop so the
  // backgrounds track the characters they belong to.
  const syncOverlayScroll = useCallback(() => {
    const ta = textareaRef.current;
    const inner = overlayInnerRef.current;
    if (!ta || !inner) return;
    inner.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, []);

  // After text change or height adjust, recompute scroll alignment
  // even if the textarea didn't fire `scroll` — e.g. when the caret
  // jumps to a position that's offscreen, browsers may adjust
  // scrollTop without firing a `scroll` event in the same tick.
  useEffect(() => { syncOverlayScroll(); }, [text, syncOverlayScroll]);

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

  // UI revamp: helper that pushes a batch of non-image files into the
  // workspace via `onUploadFiles` and inserts `@relPath` references
  // for everything that landed. Returns silently when no handler is
  // available — the attach button is gated on `attachAvailable` so
  // this branch only runs when we actually have an uploader.
  const uploadNonImages = useCallback(async (files) => {
    if (!onUploadFiles || !Array.isArray(files) || files.length === 0) return;
    const filePaths = [];
    for (const f of files) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUploadFiles]);

  // UI revamp: single attach button handles both images and non-image
  // files. The hidden `input[type=file]` is now `accept="*"`; we split
  // the selection at change time so each kind takes its native
  // pipeline. Images go through the base64 resize path (Anthropic
  // expects inline `image` parts), everything else copies into the
  // workspace and produces an `@relPath` reference.
  const handleFileInputChange = useCallback(async (e) => {
    const { files } = e.target;
    if (!files?.length) {
      e.target.value = '';
      return;
    }
    const fileArr = Array.from(files);
    const imageFiles = supportsImages ? fileArr.filter(isSupportedImageFile) : [];
    const nonImageFiles = fileArr.filter((f) => !isSupportedImageFile(f));
    if (imageFiles.length > 0) await addFiles(imageFiles);
    if (nonImageFiles.length > 0 && onUploadFiles) {
      await uploadNonImages(nonImageFiles);
    }
    e.target.value = '';
  }, [supportsImages, addFiles, uploadNonImages, onUploadFiles]);

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

  // UI revamp: lightweight helper for the top-row "@" button — drops
  // a bare `@` at the caret so users have a discoverable hint about
  // the file-reference syntax even if they never drag a file in.
  const insertAtSymbol = useCallback(() => {
    const el = textareaRef.current;
    const current = textRef.current || '';
    if (!el || document.activeElement !== el) {
      const sep = current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : '';
      const composed = current + sep + '@';
      setText(composed);
      setTimeout(() => {
        const next = textareaRef.current;
        if (!next) return;
        next.focus();
        next.selectionStart = next.selectionEnd = composed.length;
      }, 0);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const endSel = el.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(endSel);
    const needsLeftPad = before.length > 0 && !/\s$/.test(before);
    const composed = `${before}${needsLeftPad ? ' ' : ''}@${after}`;
    setText(composed);
    const newCaret = (before + (needsLeftPad ? ' ' : '') + '@').length;
    setTimeout(() => {
      const e2 = textareaRef.current;
      if (!e2) return;
      e2.focus();
      e2.selectionStart = e2.selectionEnd = newCaret;
    }, 0);
  }, []);

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
      setDragKind(onUploadFiles ? 'file' : (supportsImages ? 'image' : 'file'));
    }
  }, [onUploadFiles, supportsImages]);

  const handleDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragKind(null);
  }, []);

  const handleDrop = useCallback(async (e) => {
    setDragKind(null);
    const dt = e.dataTransfer;
    if (!dt) return;
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

    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }

    if (nonImageFiles.length === 0) return;
    if (!onUploadFiles) {
      if (imageFiles.length === 0) e.preventDefault();
      return;
    }
    e.preventDefault();
    await uploadNonImages(nonImageFiles);
  }, [supportsImages, addFiles, onUploadFiles, insertReferences, uploadNonImages]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    const images = attachments
      .filter((a) => a.data && a.mimeType && !a.resizing && !a.error)
      .map((a) => ({ mimeType: a.mimeType, data: a.data }));
    if ((!trimmed && images.length === 0) || disabled || resizing) return;
    const skillsSnapshot = Array.isArray(pinnedSkills) && pinnedSkills.length > 0
      ? [...pinnedSkills]
      : undefined;
    onSend?.(trimmed, images.length > 0 ? images : undefined, skillsSnapshot);
    setText('');
    setAttachments((prev) => {
      prev.forEach(revokePreview);
      return [];
    });
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [text, disabled, resizing, attachments, onSend, revokePreview, pinnedSkills]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    // Atomic chip deletion. The textarea otherwise treats `@path` as
    // a string of regular characters, so pressing Backspace once
    // shaves off only the trailing space / one path char, which
    // users found unintuitive — they expect the whole chip to
    // disappear in one keystroke since the chip is rendered as a
    // single visual unit. We intercept Backspace / Delete only when
    // the caret is unambiguously paired with a chip (no selection +
    // caret inside or at the matching edge of a chip range); every
    // other case falls through to native textarea handling so
    // ordinary text editing is unaffected.
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const ta = textareaRef.current;
      if (!ta) return;
      const { selectionStart, selectionEnd } = ta;
      // If the user already has a non-empty selection, let the
      // textarea handle the deletion natively — they explicitly
      // chose what to remove.
      if (selectionStart !== selectionEnd) return;
      // Ignore when modifier keys are held (Ctrl/Alt+Backspace =
      // word-delete is a separate UX contract; we don't want to
      // hijack it).
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const direction = e.key === 'Backspace' ? 'backward' : 'forward';
      const segments = parseFileRefs(textRef.current);
      const chip = findChipForDeletion(segments, selectionStart, direction);
      if (!chip) return;
      e.preventDefault();
      const cur = textRef.current;
      const next = cur.slice(0, chip.start) + cur.slice(chip.end);
      setText(next);
      // Restore caret at the position the chip used to occupy.
      setTimeout(() => {
        const ta2 = textareaRef.current;
        if (!ta2) return;
        ta2.focus();
        ta2.selectionStart = ta2.selectionEnd = chip.start;
      }, 0);
    }
  }, [handleSubmit]);

  useEffect(() => () => {
    attachmentsRef.current.forEach(revokePreview);
  }, [revokePreview]);

  const pinnedSkillsList = Array.isArray(pinnedSkills) ? pinnedSkills : [];

  const fileInputAccept = (() => {
    if (onUploadFiles) return undefined; // all files
    if (supportsImages) return 'image/png,image/jpeg,image/gif,image/webp';
    return undefined;
  })();

  return (
    <div className="px-6 py-4">
      {modelNotice && (
        <p className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
          {modelNotice}
        </p>
      )}
      {pinnedSkillsList.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider mr-0.5">技能</span>
          {pinnedSkillsList.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200"
              title={`已选技能：${name} — 发送时将附带 SKILL.md 内容`}
            >
              <Puzzle size={10} strokeWidth={2.2} />
              <span className="truncate max-w-[160px]">{name}</span>
              {onSkillRemove && (
                <button
                  type="button"
                  onClick={() => onSkillRemove(name)}
                  className="w-4 h-4 flex items-center justify-center rounded-full text-indigo-500 hover:text-indigo-800 hover:bg-indigo-100 transition-colors"
                  title={`移除技能 ${name}`}
                  aria-label={`移除技能 ${name}`}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
            </span>
          ))}
        </div>
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
                title="移除附件"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={`relative flex flex-col gap-1.5 bg-white border rounded-2xl px-4 pt-2.5 pb-2 shadow-sm transition-all ${
          dragKind
            ? 'border-blue-400 ring-2 ring-blue-100 bg-blue-50/40'
            : 'border-gray-200 focus-within:border-gray-400 focus-within:shadow-md'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragKind && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center z-10"
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
            className="pointer-events-none absolute right-3 top-1 text-[10px] text-blue-600 flex items-center gap-1 z-10"
            aria-live="polite"
          >
            <Loader2 size={10} className="animate-spin" />
            <span>正在上传...</span>
          </div>
        )}

        {/* Top action row: discoverable shortcuts that target the
            textarea (insert "@") or the OS file picker (attach
            file). Sits above the textarea so they don't compete with
            the typing area for vertical space. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={insertAtSymbol}
            disabled={disabled}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="在光标位置插入 @ ，随后可输入工作空间内的相对路径以引用文件"
            aria-label="插入 @"
          >
            <AtSign size={15} strokeWidth={1.8} />
          </button>
          {attachAvailable && (
            <>
              <input
                id={inputId}
                ref={fileInputRef}
                type="file"
                accept={fileInputAccept}
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <button
                type="button"
                disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
                className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                title={attachments.length >= MAX_ATTACHMENTS ? `已达图片附件上限 ${MAX_ATTACHMENTS} 张` : '添加文件（图片/文档均可）'}
                aria-label="添加文件"
              >
                <Paperclip size={15} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>

        {/* Textarea + highlight overlay.
            The wrapper is `relative` so we can stack a transparent-
            text mirror div behind the textarea. The mirror renders the
            SAME content with `@relPath` tokens wrapped in a coloured
            background span — because the textarea text on top is
            normal `text-gray-800`, the visible result is "textarea
            glyphs sitting on a chip-shaped pill background", which
            visually mirrors the chip used in the sent message bubble.

            All font / padding / line-height / wrap behaviour MUST
            stay identical between the mirror and the textarea or
            backgrounds will drift away from the glyphs they decorate. */}
        <div className="relative w-full">
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none select-none"
            aria-hidden="true"
          >
            <div
              ref={overlayInnerRef}
              className="text-sm leading-[22px] px-1 whitespace-pre-wrap break-words text-transparent"
              style={{ minHeight: '22px' }}
            >
              {renderHighlightOverlay(text)}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onScroll={syncOverlayScroll}
            placeholder={placeholder || (disabled ? 'AI 正在思考...' : '输入消息...')}
            disabled={disabled}
            rows={1}
            // Per user request: kill all browser-side spell / grammar /
            // autocorrect underlines inside the composer. `@`-prefixed
            // file paths in particular always tripped the spellchecker
            // because they look like misspelled words, leaving red
            // squiggles all over the chip backgrounds.
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            className="relative w-full resize-none bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none leading-[22px] disabled:opacity-50 px-1 break-words"
            style={{ minHeight: '22px' }}
          />
        </div>

        {/* Bottom toolbar — the left cluster carries Plan/Agent,
            Model, Skill selector etc. The right cluster carries the
            workspace selector and any future audio/voice control. The
            send button is always rendered last so its position is
            stable regardless of what the page passes in.

            IMPORTANT: do NOT add `overflow-x-auto` / `overflow-hidden`
            on these inner clusters. The selectors inside (Plan / Model
            / Skill / Workspace) render their popovers as
            `position: absolute` children. An overflow scroll container
            clips them to the toolbar's own row height, which manifests
            as "popover opens but is invisible / sliced". If you ever
            need narrow-width handling, prefer flex-wrap on the outer
            row instead. */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            {bottomLeftActions}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {bottomRightActions}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-all ${
                canSubmit
                  ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
              title="发送"
              aria-label="发送"
            >
              {disabled || resizing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUp size={15} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-gray-400 text-center select-none">
        {hint || (
          <>
            Enter 发送 · Shift+Enter 换行
            {supportsImages ? ' · 可粘贴或拖拽图片' : ''}
            {onUploadFiles ? ' · 可从文件树或本机拖入文件引用' : ''}
          </>
        )}
      </p>
    </div>
  );
};

export default ChatInput;
