import React, { useEffect, useState, useCallback } from 'react';
import { X, Tag, Clock, Pin, PinOff, Archive, ArchiveRestore, Trash2, Link2, FileText, Image, StickyNote, ArrowRightLeft, Globe, ExternalLink, ImagePlus, Loader2, FolderInput, LayoutDashboard } from 'lucide-react';

export default function KnowledgeDetailPanel({ item, isOpen, onClose, onUpdate, onDelete, onTogglePin, onToggleArchive, screenshotSrc, onEditNote, onConvertToNote, projectName, domain, isDraft, onAssignDraft, onAddToTempBoard }) {
  const [formData, setFormData] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />
      <div className={`fixed top-0 right-0 h-full w-[440px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-slate-200 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
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
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <img src={screenshotSrc} alt={formData.title} className="w-full object-contain max-h-[300px]" />
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
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">截图附件</label>
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
                    {webclipImages.map((imgPath, idx) => (
                      <div key={imgPath} className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                        <img
                          src={`ipm-file:///${imgPath.replace(/\\/g, '/')}`}
                          alt={`截图 ${idx + 1}`}
                          className="w-full object-contain max-h-[140px]"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                    暂无截图，可上传网页截图作为补充
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-1.5">截图内容将在 OCR 功能上线后自动识别</p>
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
    </>
  );
}
