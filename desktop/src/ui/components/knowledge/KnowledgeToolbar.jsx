import React, { useState } from 'react';
import { Search, Plus, FileText, Image, StickyNote, ChevronDown, LayoutGrid, Link2, Globe } from 'lucide-react';

const TYPE_TABS = [
  { id: '', label: '全部', icon: null },
  { id: 'snippet', label: '文本', icon: FileText },
  { id: 'screenshot', label: '截图', icon: Image },
  { id: 'note', label: '笔记', icon: StickyNote },
  { id: 'webclip', label: '网页', icon: Globe },
];

export default function KnowledgeToolbar({
  activeType,
  onTypeChange,
  searchQuery,
  onSearchChange,
  onCreateSnippet,
  onCreateNote,
  onCreateWebclip,
  showArchived,
  onToggleArchived,
  showPinned,
  onTogglePinned,
  viewMode,
  onViewModeChange,
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="px-6 py-3 border-b border-slate-200 bg-white flex items-center gap-3 flex-wrap">
      {/* View Mode Switch */}
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 mr-1">
        <button
          type="button"
          onClick={() => onViewModeChange?.('manage')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            viewMode === 'manage' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <LayoutGrid size={13} />
          管理
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange?.('linker')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            viewMode === 'linker' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Link2 size={13} />
          关联
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-slate-200" />

      {/* Type Tabs */}
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
        {TYPE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeType === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTypeChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                isActive ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {Icon && <Icon size={13} />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input
          type="text"
          placeholder="搜索碎片..."
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-200 outline-none transition-all"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Quick filters (only in manage mode) */}
      {viewMode === 'manage' && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePinned}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
              showPinned ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            已置顶
          </button>
          <button
            type="button"
            onClick={onToggleArchived}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
              showArchived ? 'bg-slate-100 border-slate-300 text-slate-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            已归档
          </button>
        </div>
      )}

      <div className="flex-1" />

      {/* Create button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setCreateOpen(!createOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
        >
          <Plus size={14} />
          新建
          <ChevronDown size={12} />
        </button>
        {createOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCreateOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
              <button
                type="button"
                onClick={() => { setCreateOpen(false); onCreateSnippet?.(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <FileText size={14} className="text-slate-400" />
                文本碎片
              </button>
              <button
                type="button"
                onClick={() => { setCreateOpen(false); onCreateNote?.(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <StickyNote size={14} className="text-slate-400" />
                富文本笔记
              </button>
              <button
                type="button"
                onClick={() => { setCreateOpen(false); onCreateWebclip?.(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Globe size={14} className="text-blue-500" />
                网页剪藏
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
