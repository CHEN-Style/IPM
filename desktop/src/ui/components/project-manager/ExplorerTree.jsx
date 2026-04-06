import React, { useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { isHiddenSystemDir, folderTooltip } from './utils.js';

const ExplorerTree = ({
  name,
  relPath,
  depth,
  tree,
  onToggle,
  onLoad,
  onEntryContextMenu,
  onOpenFile,
  onDragStartEntry,
  onDragEndAny,
  onDropOnFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  folderDecor,
  fmtBytes,
}) => {
  const rp = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  const node = tree?.[rp];
  // UX: only auto-expand the root node. Deeper folders start collapsed.
  const defaultOpen = depth === 0;
  const isOpen = node?.open ?? defaultOpen;
  const isLoading = node?.loading ?? false;
  const children = node?.entries ?? null;

  useEffect(() => {
    // Only auto-load children when the folder is open.
    if (isOpen && children === null) onLoad?.(rp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp, isOpen]);

  const safeFolderDecor =
    folderDecor ||
    (() => ({
      Icon: () => null,
      iconClass: '',
      boxClass: '',
    }));
  const safeFmtBytes = fmtBytes || (() => '-');

  return (
    <div className="select-none">
      <div
        onClick={() => onToggle?.(rp)}
        onContextMenu={(evt) => {
          // folder itself: allow delete folder via same menu
          if (rp) onEntryContextMenu?.(evt, { kind: 'dir', name: name || '文件夹', relPath: rp });
        }}
        draggable={Boolean(rp)}
        onDragStart={(evt) => {
          if (!rp) return;
          onDragStartEntry?.(evt, { kind: 'dir', name: name || '文件夹', relPath: rp });
        }}
        onDragEnd={onDragEndAny}
        onDragOver={(evt) => onDragOverFolder?.(evt, { kind: 'dir', relPath: rp })}
        onDragLeave={(evt) => onDragLeaveFolder?.(evt, { kind: 'dir', relPath: rp })}
        onDrop={(evt) => onDropOnFolder?.(evt, { kind: 'dir', relPath: rp, name: name || '文件夹' })}
        title={folderTooltip(rp)}
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-50 rounded cursor-pointer group transition-colors"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <div className="text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
        {(() => {
          const { Icon, iconClass } = safeFolderDecor(rp);
          // Explorer tree uses a smaller icon container, keep consistent tint.
          return <Icon size={18} className={iconClass} strokeWidth={1.5} />;
        })()}
        <span className="text-sm text-slate-700 font-medium">{name || '项目根目录'}</span>
        {isLoading ? <span className="text-[10px] text-slate-400 ml-2">加载中...</span> : null}
      </div>
      {isOpen ? (
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-slate-100" style={{ marginLeft: `${depth * 20 + 15}px` }} />
          {Array.isArray(children) &&
            children.filter((e) => !isHiddenSystemDir(e)).map((e) => {
              if (e.kind === 'dir') {
                return (
                  <ExplorerTree
                    key={e.relPath}
                    name={e.name}
                    relPath={e.relPath}
                    depth={depth + 1}
                    tree={tree}
                    onToggle={onToggle}
                    onLoad={onLoad}
                    onEntryContextMenu={onEntryContextMenu}
                    onDragStartEntry={onDragStartEntry}
                    onDragEndAny={onDragEndAny}
                    onDropOnFolder={onDropOnFolder}
                    onDragOverFolder={onDragOverFolder}
                    onDragLeaveFolder={onDragLeaveFolder}
                    folderDecor={safeFolderDecor}
                    fmtBytes={safeFmtBytes}
                  />
                );
              }
              return (
                <div
                  key={e.relPath}
                  onContextMenu={(evt) => onEntryContextMenu?.(evt, e)}
                  onDoubleClick={(evt) => {
                    if (e.kind !== 'file') return;
                    evt.preventDefault();
                    evt.stopPropagation();
                    onOpenFile?.(e.relPath);
                  }}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 text-slate-600 transition-all cursor-default"
                  style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
                  draggable
                  onDragStart={(evt) => onDragStartEntry?.(evt, e)}
                  onDragEnd={onDragEndAny}
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-4 h-4 flex items-center justify-center text-slate-400">•</div>
                    <span className="text-sm truncate">{e.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium shrink-0 pr-2">{safeFmtBytes(e.sizeBytes)}</div>
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
};

export default ExplorerTree;


