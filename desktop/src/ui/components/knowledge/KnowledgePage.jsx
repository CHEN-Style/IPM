import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Loader2, Search, Undo2, FolderTree, Network, Trash2, Globe, AlertCircle, CheckCircle2 } from 'lucide-react';
import KnowledgeToolbar from './KnowledgeToolbar.jsx';
import KnowledgeItemCard from './KnowledgeItemCard.jsx';
import KnowledgeDetailPanel from './KnowledgeDetailPanel.jsx';
import NoteEditorPage from './NoteEditorPage.jsx';
import useKnowledgeLinker from './useKnowledgeLinker.js';
import { FileTree } from '../snippetlinker/FileTree.jsx';
import { AssociationNodeList } from '../snippetlinker/AssociationNodeList.jsx';
import { ConnectorLines } from '../snippetlinker/ConnectorLines.jsx';
import { ToastContainer } from '../snippetlinker/ToastContainer.jsx';

export default function KnowledgePage({ projectName, domain, onBack }) {
  const domainOpts = domain ? { domain } : {};
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  // Top-level view: 'manage' or 'linker'
  const [viewMode, setViewMode] = useState('manage');

  // Filters (shared between modes)
  const [activeType, setActiveType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPinned, setShowPinned] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Detail panel
  const [activeItemId, setActiveItemId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);

  // Note editor page
  const [noteEditId, setNoteEditId] = useState(null);

  // Create modals
  const [createSnippetOpen, setCreateSnippetOpen] = useState(false);
  const [createSnippetText, setCreateSnippetText] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [createNoteTitle, setCreateNoteTitle] = useState('');

  // Webclip creation
  const [createWebclipOpen, setCreateWebclipOpen] = useState(false);
  const [webclipUrl, setWebclipUrl] = useState('');
  const [webclipLoading, setWebclipLoading] = useState(false);
  const [webclipResult, setWebclipResult] = useState(null);

  const api = window.ipm?.knowledge;

  // ============ Data loading ============
  const loadItems = useCallback(async () => {
    if (!api?.list) return;
    setLoading(true);
    setError('');
    try {
      const filters = { ...domainOpts };
      if (activeType) filters.type = activeType;
      if (searchQuery.trim()) filters.search = searchQuery.trim();
      if (showPinned) filters.pinned = true;
      if (showArchived) filters.archived = true;
      else filters.archived = false;
      const res = await api.list(projectName, filters);
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [projectName, domain, activeType, searchQuery, showPinned, showArchived]);

  const loadStats = useCallback(async () => {
    if (!api?.stats) return;
    try {
      const res = await api.stats(projectName, domainOpts);
      setStats(res?.stats || null);
    } catch { /* ignore */ }
  }, [projectName, domain]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    if (!api?.subscribe) return () => {};
    const off = api.subscribe((evt) => {
      if (evt?.projectName !== projectName) return;
      loadItems();
      loadStats();
      if (activeItemId && evt?.id === activeItemId && api?.get) {
        api.get(projectName, activeItemId, domainOpts).then((res) => {
          if (res?.item) setDetailItem(res.item);
        }).catch(() => {});
      }
    });
    return () => off?.();
  }, [projectName, domain, activeItemId, loadItems, loadStats]);

  // ============ Linker hook ============
  const linker = useKnowledgeLinker({
    projectName,
    domain,
    items,
    onItemsChange: setItems,
  });

  // ============ Item actions ============
  const handleClickItem = useCallback(async (item) => {
    if (item.type === 'note') {
      setNoteEditId(item.id);
      return;
    }
    setActiveItemId(item.id);
    if (api?.get) {
      try {
        const res = await api.get(projectName, item.id, domainOpts);
        setDetailItem(res?.item || item);
      } catch {
        setDetailItem(item);
      }
    } else {
      setDetailItem(item);
    }
  }, [projectName, domain]);

  const handleUpdateItem = useCallback(async (updated) => {
    if (!api?.update) return;
    const patch = {};
    if (updated.title !== undefined) patch.title = updated.title;
    if (updated.content_text !== undefined) patch.content_text = updated.content_text;
    if (updated.content_json !== undefined) patch.content_json = updated.content_json;
    if (updated.importance !== undefined) patch.importance = updated.importance;
    if (updated.tags !== undefined) patch.tags = updated.tags;
    try {
      await api.update(projectName, updated.id, patch, domainOpts);
    } catch { /* best-effort */ }
  }, [projectName, domain]);

  const handleDeleteItem = useCallback(async (item) => {
    if (!window.confirm(`确定删除「${item.title || '未命名'}」吗？`)) return;
    if (!api?.delete) return;
    try {
      await api.delete(projectName, item.id, domainOpts);
      setActiveItemId(null);
      setDetailItem(null);
    } catch { /* ignore */ }
  }, [projectName, domain]);

  const handleTogglePin = useCallback(async (item) => {
    if (!api?.update) return;
    try { await api.update(projectName, item.id, { pinned: !item.pinned }, domainOpts); } catch { /* ignore */ }
  }, [projectName, domain]);

  const handleToggleArchive = useCallback(async (item) => {
    if (!api?.update) return;
    try { await api.update(projectName, item.id, { archived: !item.archived }, domainOpts); } catch { /* ignore */ }
  }, [projectName, domain]);

  const handleCreateSnippet = async () => {
    if (!createSnippetText.trim() || !api?.create) return;
    setCreateBusy(true);
    try {
      await api.create(projectName, { type: 'snippet', text: createSnippetText, source_kind: 'manual', ...domainOpts });
      setCreateSnippetText('');
      setCreateSnippetOpen(false);
    } catch { /* ignore */ }
    setCreateBusy(false);
  };

  const handleCreateNote = async () => {
    if (!createNoteTitle.trim() || !api?.create) return;
    setCreateBusy(true);
    try {
      const res = await api.create(projectName, { type: 'note', title: createNoteTitle, content_text: '', source_kind: 'manual', ...domainOpts });
      setCreateNoteTitle('');
      setCreateNoteOpen(false);
      if (res?.item?.id) {
        setNoteEditId(res.item.id);
      }
    } catch { /* ignore */ }
    setCreateBusy(false);
  };

  const handleCreateWebclip = async () => {
    const url = webclipUrl.trim();
    if (!url || !api?.createWebclip) return;
    setWebclipLoading(true);
    setWebclipResult(null);
    try {
      const res = await api.createWebclip(projectName, url, domainOpts);
      if (res?.ok) {
        setWebclipResult({ success: true, title: res.item?.title || url, fetchError: res.fetchError });
        setTimeout(() => {
          setCreateWebclipOpen(false);
          setWebclipUrl('');
          setWebclipResult(null);
        }, 1500);
      } else {
        setWebclipResult({ success: false, error: res?.error || '抓取失败' });
      }
    } catch (e) {
      setWebclipResult({ success: false, error: e?.message || '未知错误' });
    }
    setWebclipLoading(false);
  };

  const handleDeleteSelected = async () => {
    if (!linker.selectedIds.size) return;
    if (!window.confirm(`确定删除 ${linker.selectedIds.size} 条知识碎片吗？`)) return;
    const ids = Array.from(linker.selectedIds);
    linker.handleClearSelection();
    try {
      const kDel = api?.delete;
      if (typeof kDel === 'function') {
        for (const id of ids) await kDel(projectName, id, domainOpts);
      }
    } catch { /* ignore */ }
  };

  const getScreenshotSrc = useCallback((item) => {
    if (item.type !== 'screenshot' || !item._absolutePath) return null;
    try { return `ipm-file:///${item._absolutePath.replace(/\\/g, '/')}`; } catch { return null; }
  }, []);

  // ============ Render ============
  const isLinkerMode = viewMode === 'linker';

  if (noteEditId) {
    return (
      <NoteEditorPage
        projectName={projectName}
        domain={domain}
        itemId={noteEditId}
        onBack={() => { setNoteEditId(null); loadItems(); loadStats(); }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-all shadow-sm">
            <ArrowLeft size={14} /> 返回
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-md">
              <BookOpen size={16} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{projectName || '项目'}</div>
              <h1 className="text-base font-bold text-slate-800 leading-tight">知识碎片</h1>
            </div>
          </div>
        </div>

        {/* Linker mode toolbar extras */}
        {isLinkerMode && (
          <div className="flex items-center gap-3">
            {/* Linker sub-view switcher */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => { linker.setLinkerSubView('structure'); linker.setFocusedNodeId(null); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  linker.linkerSubView === 'structure' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <FolderTree size={12} /> 结构
              </button>
              <button
                type="button"
                onClick={() => { linker.setLinkerSubView('association'); linker.setFocusedNodeId(null); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  linker.linkerSubView === 'association' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Network size={12} /> 关联
              </button>
            </div>

            {linker.selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">已选 {linker.selectedIds.size}</span>
                <button type="button" onClick={handleDeleteSelected} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors" title="删除所选">
                  <Trash2 size={14} />
                </button>
                <button type="button" onClick={linker.handleClearSelection} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors">取消</button>
              </div>
            )}

            <button
              type="button"
              onClick={linker.handleUndo}
              disabled={linker.history.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
              title="撤销"
            >
              <Undo2 size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <KnowledgeToolbar
        activeType={activeType}
        onTypeChange={setActiveType}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCreateSnippet={() => setCreateSnippetOpen(true)}
        onCreateNote={() => setCreateNoteOpen(true)}
        onCreateWebclip={() => { setCreateWebclipOpen(true); setWebclipUrl(''); setWebclipResult(null); }}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(!showArchived)}
        showPinned={showPinned}
        onTogglePinned={() => setShowPinned(!showPinned)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* ======= Content: manage vs linker ======= */}
      {isLinkerMode ? (
        <div className="flex-1 flex h-full min-h-0 relative" onDragStart={linker.handleDragStart}>
          {/* Toasts */}
          <ToastContainer toasts={linker.toasts} onDismiss={linker.dismissToast} />

          {/* Connector lines */}
          <ConnectorLines
            viewMode={linker.linkerSubView}
            snippets={linker.displayedItems}
            fileNodeRefs={linker.fileNodeRefs}
            snippetRefs={linker.snippetRefs}
            focusedNodeId={linker.focusedNodeId}
            scrollVersion={linker.scrollVersion}
          />

          {/* Left: File tree */}
          <aside className={`w-72 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col h-full z-30 ${
            linker.linkerSubView === 'association' ? 'bg-white shadow-[4px_0_24px_-12px_rgba(0,0,0,0.08)]' : ''
          }`}>
            <div className="p-3 border-b border-slate-200 bg-white">
              <div className="flex items-center gap-2 mb-2 text-slate-700">
                <div className={`p-1 rounded-md ${linker.linkerSubView === 'association' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                  {linker.linkerSubView === 'association' ? <Network size={15} /> : <FolderTree size={15} />}
                </div>
                <h2 className="font-bold text-xs tracking-tight">{linker.linkerSubView === 'association' ? '关联关系' : '归档目录'}</h2>
              </div>
              {linker.linkerSubView === 'structure' && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                  <input
                    type="text"
                    placeholder="搜索目录..."
                    className="w-full pl-7 pr-3 py-1.5 text-xs bg-slate-100 border border-transparent rounded-md focus:bg-white focus:border-slate-300 outline-none transition-all"
                    value={linker.treeSearch}
                    onChange={(e) => linker.setTreeSearch(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto" onScroll={linker.handleScroll}>
              {linker.treeLoading ? (
                <div className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 加载目录...</div>
              ) : linker.linkerSubView === 'structure' ? (
                <div className="p-2">
                  <FileTree
                    nodes={linker.fileTree}
                    linkedCounts={linker.linkedCounts}
                    onDrop={linker.handleDropOnNode}
                    searchQuery={linker.treeSearch}
                    expandedIds={linker.expandedIds}
                    onToggleExpand={linker.handleToggleExpand}
                  />
                </div>
              ) : (
                <AssociationNodeList
                  nodes={linker.flatNodes}
                  linkedCounts={linker.linkedCounts}
                  focusedNodeId={linker.focusedNodeId}
                  onFocusNode={linker.setFocusedNodeId}
                  registerRef={(id, el) => {
                    if (el) linker.fileNodeRefs.current.set(id, el);
                    else linker.fileNodeRefs.current.delete(id);
                  }}
                />
              )}
              <div className="h-16" />
            </div>

            <div className="p-2.5 border-t border-slate-200 bg-white text-[10px] text-slate-400 flex justify-between">
              <span>{linker.linkerSubView === 'association' ? Object.keys(linker.linkedCounts).length : linker.fileNodeMap.size} 节点</span>
              <span>{linker.history.length > 0 ? `${linker.history.length} 可撤销` : ''}</span>
            </div>
          </aside>

          {/* Right: Cards grid */}
          <main className="flex-1 flex flex-col h-full min-w-0 bg-white z-30">
            <div className="flex-1 overflow-y-auto p-5 min-h-0" onScroll={linker.handleScroll}>
              {error && <div className="mb-3 px-3 py-2 rounded border border-rose-200 bg-rose-50 text-rose-700 text-xs">{error}</div>}
              <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-16 ${linker.linkerSubView === 'association' ? 'gap-y-10' : ''}`}>
                {linker.displayedItems.map((item) => {
                  const linkedRp = item?.linkedTo?.relPath || '';
                  const linkedNode = linkedRp ? linker.fileNodeMap.get(linkedRp) : undefined;
                  const isDimmed = linker.linkerSubView === 'association' && linker.focusedNodeId !== null && linker.focusedNodeId !== linkedRp;
                  return (
                    <KnowledgeItemCard
                      key={item.id}
                      ref={(el) => {
                        if (el) linker.snippetRefs.current.set(item.id, el);
                        else linker.snippetRefs.current.delete(item.id);
                      }}
                      item={item}
                      isActive={activeItemId === item.id}
                      onClick={handleClickItem}
                      screenshotSrc={getScreenshotSrc(item)}
                      draggable
                      isSelected={linker.selectedIds.has(item.id)}
                      onToggleSelect={linker.handleToggleSelect}
                      linkedFileName={linkedNode?.name}
                      onUnlink={linker.handleUnlink}
                      isDimmed={isDimmed}
                      showAnchor={linker.linkerSubView === 'association'}
                    />
                  );
                })}
              </div>
              {linker.displayedItems.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <p className="text-sm">{linker.linkerSubView === 'association' ? '暂无已关联的碎片，切换到「结构」视图拖拽关联' : '暂无知识碎片'}</p>
                </div>
              )}
            </div>
          </main>
        </div>
      ) : (
        /* ======= Manage mode ======= */
        <div className="flex-1 overflow-y-auto p-6">
          {error && <div className="mb-4 px-3 py-2 rounded border border-rose-200 bg-rose-50 text-rose-700 text-xs">{error}</div>}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" />
              加载中...
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((item) => (
              <KnowledgeItemCard
                key={item.id}
                item={item}
                isActive={activeItemId === item.id}
                onClick={handleClickItem}
                screenshotSrc={getScreenshotSrc(item)}
              />
            ))}
          </div>

          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <BookOpen size={40} className="mb-3 text-slate-300" />
              <p className="text-sm">{searchQuery ? '没有找到匹配的碎片' : '暂无知识碎片'}</p>
              <p className="text-xs mt-1">通过悬浮窗捕获剪贴板内容，或点击「新建」手动创建</p>
            </div>
          )}
        </div>
      )}

      {/* Stats footer */}
      {stats && (
        <div className="h-8 px-6 border-t border-slate-200 bg-white flex items-center gap-4 text-[11px] text-slate-400 shrink-0">
          <span>共 {stats.total} 条</span>
          <span>文本 {stats.snippets}</span>
          <span>截图 {stats.screenshots}</span>
          <span>笔记 {stats.notes}</span>
          {stats.webclips > 0 && <span>网页 {stats.webclips}</span>}
          <span>已关联 {stats.linked}</span>
        </div>
      )}

      {/* Detail panel (shared by both modes) */}
      <KnowledgeDetailPanel
        item={detailItem}
        isOpen={activeItemId !== null}
        onClose={() => { setActiveItemId(null); setDetailItem(null); }}
        onUpdate={handleUpdateItem}
        onDelete={handleDeleteItem}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        screenshotSrc={detailItem ? getScreenshotSrc(detailItem) : null}
        onEditNote={(id) => { setActiveItemId(null); setDetailItem(null); setNoteEditId(id); }}
        projectName={projectName}
        domain={domain}
        onConvertToNote={async (id) => {
          if (!api?.update) return;
          try {
            await api.update(projectName, id, { type: 'note' }, domainOpts);
            setActiveItemId(null);
            setDetailItem(null);
            setNoteEditId(id);
          } catch { /* ignore */ }
        }}
      />

      {/* Create Snippet Modal */}
      {createSnippetOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setCreateSnippetOpen(false)}>
          <div className="w-[480px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-3">新建文本碎片</div>
            <textarea
              value={createSnippetText}
              onChange={(e) => setCreateSnippetText(e.target.value)}
              placeholder="输入文本内容..."
              className="w-full min-h-[120px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-400 resize-none"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded" onClick={() => setCreateSnippetOpen(false)}>取消</button>
              <button type="button" disabled={createBusy || !createSnippetText.trim()} className="px-3 py-2 text-sm bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50" onClick={handleCreateSnippet}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Note Modal */}
      {createNoteOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setCreateNoteOpen(false)}>
          <div className="w-[420px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-3">新建富文本笔记</div>
            <input
              value={createNoteTitle}
              onChange={(e) => setCreateNoteTitle(e.target.value)}
              placeholder="笔记标题..."
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNote(); }}
            />
            <p className="text-xs text-slate-400 mt-2">创建后可在详情面板中使用富文本编辑器编写内容</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded" onClick={() => setCreateNoteOpen(false)}>取消</button>
              <button type="button" disabled={createBusy || !createNoteTitle.trim()} className="px-3 py-2 text-sm bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50" onClick={handleCreateNote}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Webclip Modal */}
      {createWebclipOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => { if (!webclipLoading) { setCreateWebclipOpen(false); setWebclipResult(null); } }}>
          <div className="w-[500px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 bg-blue-100 text-blue-600 rounded-md">
                <Globe size={16} />
              </div>
              <div className="text-sm font-semibold text-slate-800">网页剪藏</div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">网页地址</label>
              <input
                value={webclipUrl}
                onChange={(e) => setWebclipUrl(e.target.value)}
                placeholder="https://example.com/article..."
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                autoFocus
                disabled={webclipLoading}
                onKeyDown={(e) => { if (e.key === 'Enter' && !webclipLoading) handleCreateWebclip(); }}
              />
            </div>
            <p className="text-xs text-slate-400 mb-3">系统将自动抓取网页正文并使用 AI 生成摘要，同时可在详情页中手动上传截图作为补充</p>

            {webclipLoading && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg mb-3">
                <Loader2 size={14} className="animate-spin text-blue-600" />
                <span className="text-xs text-blue-700">正在抓取网页内容并生成摘要，请稍候...</span>
              </div>
            )}

            {webclipResult && !webclipLoading && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg mb-3 ${
                webclipResult.success ? 'bg-emerald-50 border border-emerald-100' : 'bg-rose-50 border border-rose-100'
              }`}>
                {webclipResult.success ? (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs text-emerald-700 font-medium">剪藏成功：{webclipResult.title}</div>
                      {webclipResult.fetchError && <div className="text-[10px] text-amber-600 mt-0.5">部分内容提取受限：{webclipResult.fetchError}</div>}
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-rose-700">{webclipResult.error}</div>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded" disabled={webclipLoading} onClick={() => { setCreateWebclipOpen(false); setWebclipResult(null); }}>取消</button>
              <button
                type="button"
                disabled={webclipLoading || !webclipUrl.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                onClick={handleCreateWebclip}
              >
                {webclipLoading ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                {webclipLoading ? '抓取中...' : '抓取网页'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
