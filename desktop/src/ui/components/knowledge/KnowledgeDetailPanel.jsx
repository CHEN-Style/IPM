import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, Tag, Clock, Pin, PinOff, Archive, ArchiveRestore, Trash2, Link2, FileText, Image, StickyNote, ArrowRightLeft, Globe, ExternalLink, ImagePlus, Loader2, FolderInput, LayoutDashboard, Maximize2, ZoomIn, ZoomOut, RotateCcw, Download, Sparkles, Languages } from 'lucide-react';

export default function KnowledgeDetailPanel({ item, isOpen, onClose, onUpdate, onDelete, onTogglePin, onToggleArchive, screenshotSrc, onEditNote, onConvertToNote, projectName, domain, isDraft, onAssignDraft, onAddToTempBoard }) {
  const [formData, setFormData] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [deletingImage, setDeletingImage] = useState(null);
  // F3: OCR 手动触发状态
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState('');

  useEffect(() => {
    if (item) {
      setFormData({ ...item });
      setIsDirty(false);
    }
  }, [item?.id, item?.updated_at]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose?.(); };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleUploadWebclipImage = useCallback(async () => {
    if (!formData || formData.type !== 'webclip' || !projectName) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp';
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files?.length) return;
      setUploadingImage(true);
      const api = window.ipm?.knowledge;
      const domainOpts = domain ? { domain } : {};
      try {
        for (const file of input.files) {
          const arrayBuf = await file.arrayBuffer();
          const buffer = new Uint8Array(arrayBuf);
          await api.addWebclipImage(projectName, formData.id, buffer, domainOpts);
        }
      } catch { /* best-effort */ }
      setUploadingImage(false);
    };
    input.click();
  }, [formData?.id, formData?.type, projectName, domain]);

  const handleOpenExternalUrl = useCallback(() => {
    if (formData?.source_url && window.ipm?.shell?.openExternal) {
      window.ipm.shell.openExternal(formData.source_url);
    } else if (formData?.source_url) {
      window.open(formData.source_url, '_blank');
    }
  }, [formData?.source_url]);

  // F3: 手动触发 OCR — 同时支持 screenshot 与 webclip 截图
  const handleRunOcr = useCallback(async (lang = 'ch', imageIndex = 0) => {
    if (!formData?.id || !projectName || ocrRunning) return;
    setOcrRunning(true);
    setOcrError('');
    const api = window.ipm?.knowledge;
    const domainOpts = domain ? { domain } : {};
    try {
      const res = await api.runOcr(projectName, formData.id, { lang, imageIndex, ...domainOpts });
      if (!res?.ok) {
        setOcrError(res?.error || 'OCR 识别失败');
      } else if (res.recognized === false) {
        setOcrError(res.message || '未识别到文字');
      } else {
        // 拉一次最新数据，让 UI 立刻反映 content_text / content_json 更新
        const fresh = await api.get(projectName, formData.id, domainOpts);
        if (fresh?.item) setFormData(fresh.item);
      }
    } catch (err) {
      setOcrError(err?.message || String(err));
    }
    setOcrRunning(false);
  }, [formData?.id, projectName, domain, ocrRunning]);

  const handleRemoveImage = useCallback(async (imgRelPath) => {
    if (!formData?.id || !projectName) return;
    if (!window.confirm('确定删除这张截图？文件将被移到回收站。')) return;
    setDeletingImage(imgRelPath);
    const api = window.ipm?.knowledge;
    const domainOpts = domain ? { domain } : {};
    try {
      await api.removeWebclipImage(projectName, formData.id, imgRelPath, domainOpts);
      const res = await api.get(projectName, formData.id, domainOpts);
      if (res?.item) setFormData(res.item);
    } catch (err) {
      window.alert('删除失败：' + (err?.message || String(err)));
    }
    setDeletingImage(null);
  }, [formData?.id, projectName, domain]);

  if (!isOpen || !formData) return null;

  const handleChange = (field, value) => {
    const updated = { ...formData, [field]: value };
    setFormData(updated);
    setIsDirty(true);
    if (field === 'title' || field === 'importance' || field === 'tags') {
      onUpdate?.(updated);
    }
  };

  const handleBlur = () => {
    if (isDirty && formData) {
      onUpdate?.(formData);
      setIsDirty(false);
    }
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' && newTag.trim()) {
      e.preventDefault();
      const tags = Array.isArray(formData.tags) ? formData.tags : [];
      if (!tags.includes(newTag.trim())) {
        handleChange('tags', [...tags, newTag.trim()]);
      }
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    const tags = Array.isArray(formData.tags) ? formData.tags : [];
    handleChange('tags', tags.filter((t) => t !== tagToRemove));
  };

  const TypeIcon = formData.type === 'screenshot' ? Image : formData.type === 'note' ? StickyNote : formData.type === 'webclip' ? Globe : FileText;
  const tags = Array.isArray(formData.tags) ? formData.tags : [];

  const webclipMeta = formData.type === 'webclip' ? (() => { try { return JSON.parse(formData.content_json || '{}'); } catch { return {}; } })() : {};
  const webclipResolvedImages = Array.isArray(webclipMeta._resolvedImages) ? webclipMeta._resolvedImages : [];
  const webclipImages = webclipResolvedImages.length > 0 ? webclipResolvedImages : (Array.isArray(webclipMeta.images) ? webclipMeta.images : []);

  // F3: OCR 元数据（screenshot / webclip 共用）
  const ocrMeta = (formData.type === 'screenshot' || formData.type === 'webclip') ? (() => {
    if (formData.type === 'webclip') return webclipMeta;
    try { return JSON.parse(formData.content_json || '{}'); } catch { return {}; }
  })() : {};
  const hasOcrResult = Boolean(ocrMeta?.ocrText);
  const hasOcrChild = Boolean(ocrMeta?.ocrChildItemId);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />
      <div className={`fixed top-[36px] right-0 bottom-0 w-[440px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-slate-200 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between bg-white shrink-0">
          <div className="flex-1 mr-3 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${
                formData.type === 'screenshot' ? 'bg-violet-50 text-violet-600' : formData.type === 'note' ? 'bg-emerald-50 text-emerald-600' : formData.type === 'webclip' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
              }`}>
                <TypeIcon size={10} />
                {formData.type === 'screenshot' ? '截图' : formData.type === 'note' ? '笔记' : formData.type === 'webclip' ? '网页' : '文本'}
              </span>
              {isDraft && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded">
                  草稿
                </span>
              )}
            </div>
            <input
              type="text"
              value={formData.title || ''}
              onChange={(e) => handleChange('title', e.target.value)}
              onBlur={handleBlur}
              className="w-full text-lg font-bold text-slate-800 border-none outline-none p-0 bg-transparent"
              placeholder="标题"
            />
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
              <Clock size={11} />
              <span>{(formData.created_at || '').slice(0, 10)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onAddToTempBoard && (
              <button type="button" onClick={() => onAddToTempBoard?.(formData)} className="p-1.5 rounded-md hover:bg-teal-50 text-slate-400 hover:text-teal-600 transition-colors" title="加入临时看板">
                <LayoutDashboard size={16} />
              </button>
            )}
            <button type="button" onClick={() => onTogglePin?.(formData)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-amber-500 transition-colors" title={formData.pinned ? '取消置顶' : '置顶'}>
              {formData.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
            <button type="button" onClick={() => onToggleArchive?.(formData)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title={formData.archived ? '取消归档' : '归档'}>
              {formData.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </button>
            <button type="button" onClick={() => onDelete?.(formData)} className="p-1.5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors" title="删除">
              <Trash2 size={16} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Main content area */}
          {formData.type === 'screenshot' && screenshotSrc ? (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50 relative group">
                <img
                  src={screenshotSrc}
                  alt={formData.title}
                  className="w-full object-contain max-h-[300px] cursor-pointer"
                  onClick={() => setLightboxSrc(screenshotSrc)}
                />
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setLightboxSrc(screenshotSrc)}
                    className="p-1.5 bg-white/95 rounded shadow-sm text-slate-600 hover:text-blue-600 transition-colors"
                    title="查看大图"
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>
              </div>

              {/* F3: OCR 区域 */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-indigo-500" />
                    <span className="text-xs font-semibold text-slate-700">OCR 文字识别</span>
                    {hasOcrResult && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        已识别 · {(ocrMeta.ocrLang || 'ch').toUpperCase()}
                        {Number(ocrMeta.ocrConfidence) > 0 && ` · ${(ocrMeta.ocrConfidence * 100).toFixed(0)}%`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRunOcr('ch')}
                      disabled={ocrRunning}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50"
                      title="使用 PaddleOCR 中文模型识别（兼容英文与数字）"
                    >
                      {ocrRunning ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
                      {hasOcrResult ? '重新识别(中文)' : '识别(中文)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunOcr('en')}
                      disabled={ocrRunning}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                      title="使用 PaddleOCR 英文优化模型识别"
                    >
                      {ocrRunning ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
                      EN
                    </button>
                  </div>
                </div>
                {ocrError && (
                  <div className="text-[11px] text-rose-600 px-2 py-1 bg-rose-50 border border-rose-100 rounded">
                    {ocrError}
                  </div>
                )}
                {hasOcrResult ? (
                  <div className="text-xs text-slate-700 leading-relaxed max-h-[180px] overflow-y-auto whitespace-pre-wrap p-2 bg-white rounded border border-slate-200">
                    {ocrMeta.ocrText}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">点击右上按钮，使用本地 PaddleOCR PP-OCRv5 模型识别图片文字，识别完成后会自动产出一条独立的文字碎片。</p>
                )}
                {hasOcrChild && (
                  <div className="text-[10px] text-slate-500">
                    已生成关联文字碎片 <code className="px-1 py-0.5 bg-white border border-slate-200 rounded">{ocrMeta.ocrChildItemId}</code>
                  </div>
                )}
              </div>
            </div>
          ) : formData.type === 'webclip' ? (
            <section className="space-y-4">
              {/* Source URL */}
              {formData.source_url && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                  <Globe size={14} className="text-blue-500 shrink-0" />
                  <span className="text-xs text-blue-700 truncate flex-1">{formData.source_url}</span>
                  <button type="button" onClick={handleOpenExternalUrl} className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded transition-colors shrink-0" title="在浏览器中打开">
                    <ExternalLink size={13} />
                  </button>
                </div>
              )}

              {/* F2: 抓取模式标记 */}
              {(webclipMeta.renderMode || webclipMeta.fetchedAt) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {webclipMeta.renderMode === 'rendered' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200" title="使用隐藏 Chromium 渲染抓取（支持 SPA / JS）">
                      浏览器渲染
                    </span>
                  )}
                  {webclipMeta.renderMode === 'http_fallback' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200" title="纯 HTTP 抓取（轻量，但不支持 JS 渲染）">
                      HTTP 抓取
                    </span>
                  )}
                  {webclipMeta.fetchedAt && (
                    <span className="text-[10px] text-slate-400" title={webclipMeta.fetchedAt}>
                      抓取于 {new Date(webclipMeta.fetchedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}

              {/* Summary */}
              {formData.summary && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">AI 摘要</label>
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-slate-700 leading-relaxed">{formData.summary}</div>
                </div>
              )}

              {/* Full text */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">正文内容</label>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                  {formData.content_text || '未能提取到正文内容'}
                </div>
              </div>

              {/* Screenshots */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">截图附件 ({webclipImages.length})</label>
                  <button
                    type="button"
                    onClick={handleUploadWebclipImage}
                    disabled={uploadingImage}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                  >
                    {uploadingImage ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                    上传截图
                  </button>
                </div>
                {webclipImages.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {webclipImages.map((imgPath, idx) => {
                      const imgSrc = `ipm-file:///${imgPath.replace(/\\/g, '/')}`;
                      const relPath = (Array.isArray(webclipMeta.images) ? webclipMeta.images[idx] : null) || imgPath;
                      const isDeleting = deletingImage === relPath;
                      return (
                        <div key={imgPath} className="relative group rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                          <img
                            src={imgSrc}
                            alt={`截图 ${idx + 1}`}
                            className="w-full object-contain max-h-[140px] cursor-pointer"
                            onClick={() => setLightboxSrc(imgSrc)}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
                          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => setLightboxSrc(imgSrc)}
                              className="p-1 bg-white/90 rounded shadow-sm text-slate-600 hover:text-blue-600 transition-colors"
                              title="查看大图"
                            >
                              <Maximize2 size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveImage(relPath)}
                              disabled={isDeleting}
                              className="p-1 bg-white/90 rounded shadow-sm text-slate-600 hover:text-rose-600 transition-colors disabled:opacity-50"
                              title="删除截图"
                            >
                              {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                    暂无截图，可上传网页截图作为补充
                  </div>
                )}
                {/* F3: webclip 截图 OCR 状态 + 手动触发 */}
                {webclipImages.length > 0 && (
                  <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={11} className="text-indigo-500" />
                        <span className="text-[11px] font-medium text-slate-700">截图 OCR</span>
                        {ocrMeta.ocrText && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            已识别 · {(ocrMeta.ocrLang || 'ch').toUpperCase()}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRunOcr(ocrMeta.ocrLang === 'en' ? 'en' : 'ch', 0)}
                        disabled={ocrRunning}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50"
                      >
                        {ocrRunning ? <Loader2 size={10} className="animate-spin" /> : <Languages size={10} />}
                        {ocrMeta.ocrText ? '重新识别' : '识别第一张'}
                      </button>
                    </div>
                    {ocrError && (
                      <div className="text-[10px] text-rose-600 px-1.5 py-0.5 bg-rose-50 border border-rose-100 rounded">{ocrError}</div>
                    )}
                    {ocrMeta.ocrText && (
                      <div className="text-[11px] text-slate-700 leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap p-1.5 bg-white rounded border border-slate-200">
                        {ocrMeta.ocrText}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Convert to note */}
              {onConvertToNote && (
                <button
                  type="button"
                  onClick={() => { onClose?.(); onConvertToNote?.(formData.id); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  <ArrowRightLeft size={14} />
                  转为笔记（进入富文本编辑器深度整理）
                </button>
              )}
            </section>
          ) : formData.type === 'note' ? (
            <section>
              <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap min-h-[60px] p-3 bg-slate-50 rounded-lg border border-slate-200">
                {formData.content_text || '暂无内容'}
              </div>
              <button
                type="button"
                onClick={() => { onClose?.(); onEditNote?.(formData.id); }}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <StickyNote size={14} />
                打开编辑器
              </button>
            </section>
          ) : (
            <section>
              <textarea
                value={formData.content_text || ''}
                onChange={(e) => handleChange('content_text', e.target.value)}
                onBlur={handleBlur}
                className="w-full min-h-[120px] p-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-slate-400 outline-none resize-none transition-all leading-relaxed"
                placeholder="内容..."
              />
              {formData.type === 'snippet' && onConvertToNote && (
                <button
                  type="button"
                  onClick={() => { onClose?.(); onConvertToNote?.(formData.id); }}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  <ArrowRightLeft size={14} />
                  转为笔记（进入富文本编辑器）
                </button>
              )}
            </section>
          )}

          {/* Importance */}
          <section>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">优先级</label>
            <div className="flex gap-2">
              {['low', 'medium', 'high'].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleChange('importance', formData.importance === level ? null : level)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    formData.importance === level
                      ? level === 'high' ? 'bg-red-50 border-red-200 text-red-700' : level === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {level === 'high' ? '高' : level === 'medium' ? '中' : '低'}
                </button>
              ))}
            </div>
          </section>

          {/* Tags */}
          <section>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">标签</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs border border-slate-200">
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)} className="text-slate-400 hover:text-slate-600 ml-0.5">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <div className="relative flex items-center">
                <Tag size={11} className="absolute left-2 text-slate-400" />
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={handleAddTag}
                  className="pl-6 pr-3 py-1 w-28 text-xs bg-white border border-slate-200 rounded-md focus:border-slate-400 outline-none transition-all"
                  placeholder="添加标签..."
                />
              </div>
            </div>
          </section>

          {/* Links */}
          {Array.isArray(formData.links) && formData.links.length > 0 && (
            <section>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">关联文件</label>
              <div className="space-y-1.5">
                {formData.links.map((link) => (
                  <div key={link.id} className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 rounded-md border border-slate-100 text-xs text-slate-600">
                    <span className="flex items-center gap-1.5 truncate">
                      <Link2 size={12} className="text-indigo-400 shrink-0" />
                      {link.target_path}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Draft assign button */}
          {isDraft && onAssignDraft && (
            <section>
              <button
                type="button"
                onClick={onAssignDraft}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-indigo-700 bg-indigo-50 border-2 border-dashed border-indigo-200 rounded-xl hover:bg-indigo-100 hover:border-indigo-300 transition-all"
              >
                <FolderInput size={16} />
                归属到项目
              </button>
              <p className="text-[10px] text-slate-400 text-center mt-1.5">选择目标项目后，此草稿将转为正式知识碎片</p>
            </section>
          )}

          {/* Source */}
          <section className="pt-4 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">来源</label>
            <div className="text-xs text-slate-500">{isDraft ? '草稿' : (formData.source_kind || 'manual')}</div>
          </section>
        </div>
      </div>

      {/* Lightbox 大图预览（支持缩放 + 另存为） */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => { setLightboxSrc(null); setLightboxZoom(1); }}
          onWheel={(e) => {
            e.preventDefault();
            setLightboxZoom((z) => Math.min(5, Math.max(0.2, z + (e.deltaY < 0 ? 0.15 : -0.15))));
          }}
        >
          {/* 工具栏 */}
          <div
            className="flex items-center gap-1 mb-3 px-3 py-1.5 bg-white/95 rounded-full shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxZoom((z) => Math.min(5, z + 0.25))}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors"
              title="放大"
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              onClick={() => setLightboxZoom((z) => Math.max(0.2, z - 0.25))}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors"
              title="缩小"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              onClick={() => setLightboxZoom(1)}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors"
              title="重置缩放"
            >
              <RotateCcw size={16} />
            </button>
            <span className="text-xs text-slate-500 px-2 min-w-[44px] text-center select-none">{Math.round(lightboxZoom * 100)}%</span>
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={async () => {
                try {
                  const src = lightboxSrc;
                  const resp = await fetch(src);
                  const blob = await resp.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `webclip-screenshot-${Date.now()}.png`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch { /* ignore */ }
              }}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors"
              title="另存为图片"
            >
              <Download size={16} />
            </button>
            <div className="w-px h-4 bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={() => { setLightboxSrc(null); setLightboxZoom(1); }}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 transition-colors"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>

          {/* 图片区域 */}
          <div
            className="overflow-auto max-w-[92vw] max-h-[82vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxSrc}
              alt="截图大图预览"
              className="rounded shadow-2xl transition-transform duration-150"
              style={{ transform: `scale(${lightboxZoom})`, transformOrigin: 'center center' }}
              draggable={false}
            />
          </div>
        </div>
      )}
    </>
  );
}
