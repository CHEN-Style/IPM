import React, { forwardRef } from 'react';
import { FolderOpen, FileText, Link2 } from 'lucide-react';
import { NodeType } from './constants';

export const AssociationNodeList = ({ nodes, linkedCounts, focusedNodeId, onFocusNode, registerRef }) => {
  // Only show nodes that actually have links
  const activeNodes = nodes.filter((node) => (linkedCounts[node.id] || 0) > 0);

  if (activeNodes.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400 text-sm">
        <Link2 size={24} className="mx-auto mb-2 opacity-50" />
        <p>暂无关联关系。</p>
        <p className="text-xs mt-1">请在「结构视图」中将知识碎片拖拽到左侧目录以建立关联。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {activeNodes.map((node) => (
        <AssociationNodeItem
          key={node.id}
          node={node}
          count={linkedCounts[node.id]}
          isFocused={focusedNodeId === node.id}
          isDimmed={focusedNodeId !== null && focusedNodeId !== node.id}
          onClick={() => onFocusNode(focusedNodeId === node.id ? null : node.id)}
          ref={(el) => registerRef(node.id, el)}
        />
      ))}
    </div>
  );
};

const AssociationNodeItem = forwardRef(({ node, count, isFocused, isDimmed, onClick }, ref) => {
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`
        relative flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-300
        ${isFocused ? 'bg-white border-red-400 shadow-md scale-[1.02] z-10' : 'bg-white border-gray-200 hover:border-red-200 hover:bg-red-50/30'}
        ${isDimmed ? 'opacity-40 grayscale blur-[0.5px]' : 'opacity-100'}
      `}
    >
      <div className={`p-2 rounded-md ${isFocused ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
        {node.type === NodeType.FOLDER ? <FolderOpen size={18} /> : <FileText size={18} />}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className={`text-sm font-medium truncate ${isFocused ? 'text-gray-900' : 'text-gray-700'}`}>{node.name}</h4>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Link2 size={10} />
          <span>
            {count} fragment{count !== 1 ? 's' : ''} connected
          </span>
        </div>
      </div>

      {/* Anchor Point (Right Side) */}
      <div
        className={`
          absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white transition-colors
          ${isFocused ? 'bg-red-500 shadow-sm' : 'bg-gray-300'}
        `}
      />
    </div>
  );
});

AssociationNodeItem.displayName = 'AssociationNodeItem';


