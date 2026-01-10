import React, { useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, File, ChevronRight, ChevronDown, Lock } from 'lucide-react';
import { NodeType } from './constants';

export const FileTree = ({ nodes, linkedCounts, onDrop, searchQuery, expandedIds, onToggleExpand, level = 0 }) => {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.id}
          node={node}
          linkedCounts={linkedCounts}
          onDrop={onDrop}
          searchQuery={searchQuery}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          level={level}
        />
      ))}
    </ul>
  );
};

const FileTreeNode = ({ node, linkedCounts, onDrop, searchQuery, expandedIds, onToggleExpand, level }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const expandTimerRef = useRef(null);

  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const matchSearch = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());
  const linkedCount = linkedCounts[node.id] || 0;

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    };
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (node.restricted) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'link';
    setIsDragOver(true);

    // Auto-expand folder on hover if not already expanded
    if (node.type === NodeType.FOLDER && !isExpanded && !expandTimerRef.current) {
      expandTimerRef.current = setTimeout(() => {
        onToggleExpand(node.id);
      }, 800); // 800ms delay for auto-expand
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);

    if (node.restricted) return;

    onDrop(node.id);
  };

  // If searching, always expand valid parents (simplified logic: just show matching nodes)
  const shouldRenderChildren = isExpanded || (searchQuery.length > 0);

  return (
    <li className="select-none">
      <div
        className={`
          relative flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors cursor-pointer border border-transparent
          ${isDragOver && !node.restricted ? 'bg-primary-100 border-primary-400 shadow-inner' : ''}
          ${isDragOver && node.restricted ? 'bg-red-50 border-red-200 cursor-not-allowed' : ''}
          ${matchSearch ? 'bg-yellow-100 text-yellow-900' : 'hover:bg-gray-100'}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (node.type === NodeType.FOLDER) onToggleExpand(node.id);
        }}
      >
        {/* Toggle Icon */}
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {node.type === NodeType.FOLDER ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.id);
              }}
              className="text-gray-400 hover:text-gray-600 transition-transform"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : null}
        </div>

        {/* Node Icon */}
        <div className={`shrink-0 ${isDragOver ? 'scale-110 transition-transform' : ''}`}>
          {node.restricted ? (
            <Lock size={16} className="text-gray-400" />
          ) : node.type === NodeType.FOLDER ? (
            isExpanded ? (
              <FolderOpen size={16} className="text-amber-500" />
            ) : (
              <Folder size={16} className="text-amber-500" />
            )
          ) : (
            <File size={16} className="text-blue-400" />
          )}
        </div>

        {/* Node Name */}
        <span className={`text-sm truncate flex-1 ${matchSearch ? 'font-bold' : 'text-gray-700'}`}>{node.name}</span>

        {/* Drop Badge / Count Badge */}
        {isDragOver ? (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${node.restricted ? 'bg-red-200 text-red-700' : 'bg-primary-500 text-white'}`}>
            {node.restricted ? 'LOCKED' : 'DROP HERE'}
          </span>
        ) : linkedCount > 0 ? (
          <span className="text-[10px] font-medium bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {linkedCount}
          </span>
        ) : null}
      </div>

      {/* Recursive Children */}
      {hasChildren && shouldRenderChildren ? (
        <FileTree
          nodes={node.children}
          linkedCounts={linkedCounts}
          onDrop={onDrop}
          searchQuery={searchQuery}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          level={level + 1}
        />
      ) : null}
    </li>
  );
};


