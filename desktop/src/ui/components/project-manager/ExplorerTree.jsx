import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { isHiddenSystemDir, folderTooltip, normalizeRelPathPosix } from './utils.js';

const ExplorerTree = ({
  name,
  relPath,
  depth,
  tree,
  selectedRelPath,
  focusedRelPath,
  ghostBadgeByDir,
  onToggle,
  onSelectDir,
  onLoad,
  onEntryContextMenu,
  onDragStartEntry,
  onDragEndAny,
  onDropOnFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  folderDecor,
}) => {
  const rp = normalizeRelPathPosix(relPath);
  const node = tree?.[rp];
  // UX: only auto-expand the root node. Deeper folders start collapsed.
  const defaultOpen = depth === 0;
  const isOpen = node?.open ?? defaultOpen;
  const isLoading = node?.loading ?? false;
  const children = node?.entries ?? null;
  const isSelected = normalizeRelPathPosix(selectedRelPath) === rp;
  const isFocused = focusedRelPath != null && normalizeRelPathPosix(focusedRelPath) === rp;
  const ghostCount = ghostBadgeByDir?.[rp] || 0;
  const isRootNode = depth === 0;

  const rowRef = useRef(null);
  useEffect(() => {
    // Reveal the currently-selected / keyboard-focused node when navigation
    // happens from the right pane / breadcrumb / AI overview / keyboard.
    if ((isSelected || isFocused) && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected, isFocused]);

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

  // Folders-only navigation pane: files appear only in the right-hand list.
  const childDirs = Array.isArray(children)
    ? children.filter((e) => e.kind === 'dir' && !isHiddenSystemDir(e))
    : null;

  // Shared interactive props for the clickable row (root header & card rows).
  const interactiveProps = {
    ref: rowRef,
    role: 'treeitem',
    'aria-selected': isSelected,
    'aria-expanded': isOpen,
    onClick: () => onSelectDir?.(rp),
    onContextMenu: (evt) => {
      if (rp) onEntryContextMenu?.(evt, { kind: 'dir', name: name || '文件夹', relPath: rp });
    },
    draggable: Boolean(rp),
    onDragStart: (evt) => {
      if (!rp) return;
      onDragStartEntry?.(evt, { kind: 'dir', name: name || '文件夹', relPath: rp });
    },
    onDragEnd: onDragEndAny,
    onDragOver: (evt) => onDragOverFolder?.(evt, { kind: 'dir', relPath: rp }),
    onDragLeave: (evt) => onDragLeaveFolder?.(evt, { kind: 'dir', relPath: rp }),
    onDrop: (evt) => onDropOnFolder?.(evt, { kind: 'dir', relPath: rp, name: name || '文件夹' }),
    title: folderTooltip(rp),
  };

  const chevronBtn = (
    <button
      type="button"
      className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0"
      onClick={(evt) => {
        evt.stopPropagation();
        onToggle?.(rp);
      }}
      title={isOpen ? '收起' : '展开'}
    >
      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  );

  const { Icon, iconClass } = safeFolderDecor(rp);

  const badge =
    ghostCount > 0 ? (
      <span
        className="shrink-0 ml-auto text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
        title={`含 ${ghostCount} 个待处理 AI 建议`}
      >
        {ghostCount}
      </span>
    ) : null;

  const loadingTag = isLoading ? (
    <span className={`text-[10px] text-slate-400 shrink-0 ${ghostCount > 0 ? 'ml-1.5' : 'ml-auto'}`}>加载中...</span>
  ) : null;

  // --- Root node: rendered as a section header above the soft card. ---
  if (isRootNode) {
    return (
      <div className="select-none px-2">
        <div
          {...interactiveProps}
          className={`flex items-center gap-2 py-1.5 px-2 mb-2 rounded-lg cursor-pointer group transition-colors ${
            isSelected ? 'text-[#3e4b9c] ring-1 ring-inset ring-[#3e4b9c]/40' : 'text-slate-800 hover:bg-slate-50'
          } ${isFocused && !isSelected ? 'ring-1 ring-inset ring-[#3e4b9c]/40' : ''}`}
        >
          {chevronBtn}
          <Icon size={18} className={iconClass} strokeWidth={1.6} />
          <span className="text-sm font-bold truncate min-w-0 flex-1">{name || '项目根目录'}</span>
          {badge}
          {loadingTag}
        </div>
        {isOpen ? (
          <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-1.5" role="group">
            {Array.isArray(childDirs) &&
              childDirs.map((e) => (
                <ExplorerTree
                  key={e.relPath}
                  name={e.name}
                  relPath={e.relPath}
                  depth={depth + 1}
                  tree={tree}
                  selectedRelPath={selectedRelPath}
                  focusedRelPath={focusedRelPath}
                  ghostBadgeByDir={ghostBadgeByDir}
                  onToggle={onToggle}
                  onSelectDir={onSelectDir}
                  onLoad={onLoad}
                  onEntryContextMenu={onEntryContextMenu}
                  onDragStartEntry={onDragStartEntry}
                  onDragEndAny={onDragEndAny}
                  onDropOnFolder={onDropOnFolder}
                  onDragOverFolder={onDragOverFolder}
                  onDragLeaveFolder={onDragLeaveFolder}
                  folderDecor={safeFolderDecor}
                />
              ))}
            {Array.isArray(childDirs) && childDirs.length === 0 ? (
              <div className="text-[11px] text-slate-300 py-2 text-center">（暂无子文件夹）</div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // --- Child nodes: card rows that "float" (white + ring + shadow) when selected. ---
  return (
    <div className="select-none">
      <div
        {...interactiveProps}
        className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-lg cursor-pointer group transition-all ${
          isSelected
            ? 'bg-white text-[#3e4b9c] shadow-sm ring-1 ring-[#d8dbed]'
            : 'hover:bg-white/70 text-slate-600'
        } ${isFocused && !isSelected ? 'ring-1 ring-inset ring-[#3e4b9c]/40' : ''}`}
        style={{ paddingLeft: `${(depth - 1) * 14 + 6}px` }}
      >
        {chevronBtn}
        <Icon size={17} className={iconClass} strokeWidth={1.5} />
        <span className={`text-sm truncate min-w-0 flex-1 ${isSelected ? 'font-semibold' : 'font-medium'}`}>
          {name || '文件夹'}
        </span>
        {badge}
        {loadingTag}
      </div>
      {isOpen ? (
        <div role="group">
          {Array.isArray(childDirs) &&
            childDirs.map((e) => (
              <ExplorerTree
                key={e.relPath}
                name={e.name}
                relPath={e.relPath}
                depth={depth + 1}
                tree={tree}
                selectedRelPath={selectedRelPath}
                focusedRelPath={focusedRelPath}
                ghostBadgeByDir={ghostBadgeByDir}
                onToggle={onToggle}
                onSelectDir={onSelectDir}
                onLoad={onLoad}
                onEntryContextMenu={onEntryContextMenu}
                onDragStartEntry={onDragStartEntry}
                onDragEndAny={onDragEndAny}
                onDropOnFolder={onDropOnFolder}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
                folderDecor={safeFolderDecor}
              />
            ))}
          {Array.isArray(childDirs) && childDirs.length === 0 ? (
            <div className="text-[11px] text-slate-300 py-1" style={{ paddingLeft: `${depth * 14 + 26}px` }}>
              （无子文件夹）
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default ExplorerTree;
