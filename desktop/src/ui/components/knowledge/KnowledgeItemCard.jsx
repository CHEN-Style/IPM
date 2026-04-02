import React, { forwardRef } from 'react';
import { FileText, Image, StickyNote, Pin, Tag, Link2, GripVertical, Globe } from 'lucide-react';

const TYPE_ICON = {
  snippet: FileText,
  screenshot: Image,
  note: StickyNote,
  webclip: Globe,
};

const TYPE_LABEL = {
  snippet: '文本',
  screenshot: '截图',
  note: '笔记',
  webclip: '网页',
};

const IMPORTANCE_DOT = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
};

const KnowledgeItemCard = forwardRef(({
  item,
  isActive,
  onClick,
  screenshotSrc,
  // Linker mode props
  draggable = false,
  isSelected = false,
  onToggleSelect,
  linkedFileName,
  onUnlink,
  isDimmed = false,
  showAnchor = false,
}, ref) => {
  const Icon = TYPE_ICON[item.type] || FileText;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const linkCount = item.links?.length || 0;

  const handleDragStart = (e) => {
    if (!draggable) return;
    e.dataTransfer.effectAllowed = 'link';
    e.currentTarget.setAttribute('data-dragging-id', item.id);
  };

  const handleClick = (e) => {
    if (draggable && onToggleSelect) {
      onToggleSelect(item.id, e.metaKey || e.ctrlKey);
    } else {
      onClick?.(item);
    }
  };

  const handleDoubleClick = () => {
    if (draggable) onClick?.(item);
  };

  return (
    <div
      ref={ref}
      draggable={draggable}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group relative flex flex-col rounded-xl border transition-all duration-200 h-[210px] p-4 hover:shadow-md ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${
        isActive
          ? 'border-indigo-400 ring-2 ring-indigo-100 bg-indigo-50/30'
          : isSelected
            ? 'border-indigo-400 ring-2 ring-indigo-200/60 bg-white'
            : linkedFileName
              ? 'bg-sky-50/90 border-sky-200/60 shadow-sm hover:border-sky-200'
              : 'bg-white border-slate-200 shadow-sm hover:border-slate-300'
      } ${isDimmed ? 'opacity-20 grayscale blur-[1px] pointer-events-none' : ''}`}
    >
      {/* Association View Anchor Point */}
      {showAnchor && (
        <div className="absolute -left-1.5 top-6 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm z-10" />
      )}

      {/* Top row: type badge + importance + pin */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {draggable && <GripVertical size={14} className="text-slate-300 group-hover:text-slate-500 -ml-1 shrink-0" />}
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded ${
            item.type === 'screenshot' ? 'bg-violet-50 text-violet-600' : item.type === 'note' ? 'bg-emerald-50 text-emerald-600' : item.type === 'webclip' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
          }`}>
            <Icon size={10} />
            {TYPE_LABEL[item.type] || item.type}
          </span>
          {item.pinned && <Pin size={12} className="text-amber-500 fill-amber-500" />}
        </div>
        {item.importance && <div className={`w-2 h-2 rounded-full ${IMPORTANCE_DOT[item.importance] || ''}`} title={`优先级: ${item.importance}`} />}
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-slate-800 truncate mb-1.5">{item.title || '未命名'}</h3>

      {/* Content preview */}
      <div className="flex-1 min-h-0 mb-2">
        {item.type === 'screenshot' && (screenshotSrc || item._absolutePath) ? (
          <div className="h-full rounded-md overflow-hidden bg-slate-100 flex items-center justify-center">
            <img src={screenshotSrc || (item._absolutePath ? `ipm-file:///${item._absolutePath.replace(/\\/g, '/')}` : '')} alt={item.title} className="max-h-full max-w-full object-contain" />
          </div>
        ) : item.type === 'webclip' ? (
          <div>
            <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{item.summary || item.content_text || ''}</p>
            {item.source_url && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-blue-500">
                <Globe size={10} className="shrink-0" />
                <span className="truncate">{(() => { try { return new URL(item.source_url).hostname; } catch { return item.source_url; } })()}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">{item.content_text || item.summary || ''}</p>
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {tags.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 truncate max-w-[120px]">
              <Tag size={10} className="shrink-0 text-slate-400" />
              {tags[0]}
              {tags.length > 1 && <span className="text-slate-400 ml-0.5">+{tags.length - 1}</span>}
            </span>
          )}
        </div>
        {/* In linker mode: show linked file name */}
        {draggable && linkedFileName ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded truncate max-w-[100px]">
              <Link2 size={9} className="inline mr-0.5" />
              {linkedFileName}
            </span>
            {onUnlink && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUnlink(item.id); }}
                className="text-[9px] text-red-400 hover:text-red-600 hover:bg-red-50 px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              >
                解除
              </button>
            )}
          </div>
        ) : linkCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
            <Link2 size={10} />
            {linkCount}
          </span>
        ) : null}
      </div>
    </div>
  );
});

KnowledgeItemCard.displayName = 'KnowledgeItemCard';
export default KnowledgeItemCard;
