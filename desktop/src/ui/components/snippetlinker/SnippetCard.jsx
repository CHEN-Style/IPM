import React, { forwardRef } from 'react';
import { GripVertical, Tag, FileText, Image, StickyNote } from 'lucide-react';

export const SnippetCard = forwardRef(
  (
    {
      snippet,
      isSelected,
      onToggleSelect,
      linkedFileName,
      onUnlink,
      isDimmed = false,
      showAnchor = false,
      onDoubleClick,
      isActive = false,
    },
    ref,
  ) => {
    const handleDragStart = (e) => {
      e.dataTransfer.effectAllowed = 'link';
      e.currentTarget.setAttribute('data-dragging-id', snippet.id);
    };

    const getImportanceColor = (imp) => {
      switch (imp) {
        case 'high':
          return 'bg-red-500';
        case 'medium':
          return 'bg-amber-400';
        case 'low':
          return 'bg-blue-400';
        default:
          return 'hidden';
      }
    };

    return (
      <div
        ref={ref}
        draggable
        onDragStart={handleDragStart}
        onClick={(e) => onToggleSelect(snippet.id, e.metaKey || e.ctrlKey)}
        onDoubleClick={onDoubleClick}
        className={`
          group relative flex flex-col rounded-xl border transition-all duration-300 cursor-grab active:cursor-grabbing
          h-[208px] p-4
          hover:shadow-md
          ${
            isActive
              ? 'border-primary-500 ring-2 ring-primary-100 bg-primary-50/30'
              : linkedFileName
                ? 'bg-sky-50/90 border-sky-200/60 shadow-sm hover:border-sky-200'
                : 'bg-white border-gray-200 shadow-sm hover:border-primary-200'
          }
          ${
            // Selection (single click): only change border/ring, keep background as-is
            !isActive && isSelected ? 'border-primary-400 ring-2 ring-primary-200/60' : ''
          }
          ${isDimmed ? 'opacity-20 grayscale filter blur-[1px] pointer-events-none' : 'opacity-100'}
        `}
      >
        {/* Association View Anchor Point (Left Side) */}
        {showAnchor && (
          <div className="absolute -left-1.5 top-6 w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm z-10 transition-transform hover:scale-125" />
        )}

        {/* Importance Indicator */}
        {snippet.importance ? (
          <div
            className={`absolute top-4 right-4 w-2 h-2 rounded-full ${getImportanceColor(snippet.importance)}`}
            title={`Priority: ${snippet.importance}`}
          />
        ) : null}

        {/* Top */}
        <div className="grid grid-cols-[16px_1fr] gap-x-2 items-start">
          <div className="mt-[1px] cursor-grab text-gray-400 hover:text-gray-600">
            <GripVertical size={16} />
          </div>
          <h3 className="font-semibold text-gray-800 text-sm truncate">{snippet.title}</h3>
        </div>

        {/* Type badge */}
        {snippet._type && snippet._type !== 'snippet' && (
          <div className="ml-[24px] -mt-0.5 mb-1">
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${
              snippet._type === 'screenshot' ? 'bg-violet-50 text-violet-600' : snippet._type === 'note' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
            }`}>
              {snippet._type === 'screenshot' ? <Image size={10} /> : <StickyNote size={10} />}
              {snippet._type === 'screenshot' ? '截图' : '笔记'}
            </span>
          </div>
        )}

        {/* Middle */}
        <div className="mt-2.5 flex-1 min-h-0">
          {snippet._type === 'screenshot' && snippet._absolutePath ? (
            <div className="h-full rounded overflow-hidden bg-gray-100 flex items-center justify-center">
              <img src={`ipm-file:///${snippet._absolutePath.replace(/\\/g, '/')}`} alt={snippet.title} className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <p className="text-xs text-gray-500 line-clamp-3 leading-relaxed">{snippet.content}</p>
          )}
        </div>

        {/* Bottom */}
        <div className="pt-2.5 border-t border-gray-100 space-y-2">
          {/* Tags */}
          {snippet.tags.length > 0 ? (
            <div className="flex items-center">
              <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-md max-w-full border border-gray-100">
                <Tag size={12} className="shrink-0 text-gray-400" />
                <span className="truncate font-medium">{snippet.tags[0]}</span>
                {snippet.tags.length > 1 ? (
                  <span className="shrink-0 text-gray-400 ml-1 text-[10px] font-bold">+{snippet.tags.length - 1}</span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-gray-300">&nbsp;</div>
          )}

          {/* Bound (always visible) */}
          <div className="bg-gray-100 rounded px-2 py-1.5 flex justify-between items-center">
            <div className="flex items-center gap-1.5 text-xs text-gray-600 truncate min-w-0">
              <FileText size={12} className="shrink-0" />
              <span className="truncate">
                绑定到：<span className="font-medium">{linkedFileName || '/'}</span>
              </span>
            </div>
            {linkedFileName && onUnlink ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnlink(snippet.id);
                }}
                className="text-[10px] text-red-500 hover:bg-red-50 px-1.5 py-0.5 rounded transition-colors opacity-0 group-hover:opacity-100"
              >
                Unlink
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);

SnippetCard.displayName = 'SnippetCard';


