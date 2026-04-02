import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Undo2, FolderTree, Network, LayoutGrid, Trash2, ArrowLeft } from 'lucide-react';
import { FileTree } from './FileTree.jsx';
import { SnippetCard } from './SnippetCard.jsx';
import { ToastContainer } from './ToastContainer.jsx';
import { AssociationNodeList } from './AssociationNodeList.jsx';
import { ConnectorLines } from './ConnectorLines.jsx';
import { SnippetDetailPanel } from './SnippetDetailPanel.jsx';

// Helper to flatten tree for easier lookups
const flattenTree = (nodes) => {
  const map = new Map();
  const traverse = (list) => {
    list.forEach((node) => {
      map.set(node.id, node);
      if (node.children) traverse(node.children);
    });
  };
  traverse(nodes);
  return map;
};

// Helper to get a flat list of all nodes
const getFlatNodeList = (nodes) => {
  let flat = [];
  nodes.forEach((n) => {
    flat.push(n);
    if (n.children) flat = flat.concat(getFlatNodeList(n.children));
  });
  return flat;
};

export default function SnippetLinkerMockPage({ projectName, domain, onBack }) {
  const domainOpts = domain ? { domain } : {};
  const [fileTree, setFileTree] = useState([]);
  const fileNodeMap = useMemo(() => flattenTree(fileTree), [fileTree]);
  const flatNodes = useMemo(() => getFlatNodeList(fileTree), [fileTree]);

  const [snippets, setSnippets] = useState([]);
  const [selectedSnippetIds, setSelectedSnippetIds] = useState(new Set());
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [toasts, setToasts] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [snipBusy, setSnipBusy] = useState(false);

  // View Modes: 'structure' (default) or 'association'
  const [viewMode, setViewMode] = useState('structure');
  const [focusedNodeId, setFocusedNodeId] = useState(null);

  // Detail Panel State
  const [activeSnippetId, setActiveSnippetId] = useState(null);
  const activeSnippet = useMemo(() => snippets.find((s) => s.id === activeSnippetId) || null, [snippets, activeSnippetId]);
  const activeSnippetForPanel = useMemo(() => {
    if (!activeSnippet) return null;
    return { ...activeSnippet, content: activeSnippet._fullText ?? activeSnippet.content };
  }, [activeSnippet]);

  // Line drawing refs
  const fileNodeRefs = useRef(new Map());
  const snippetRefs = useRef(new Map());
  const [scrollVersion, setScrollVersion] = useState(0); // Trigger line redraw on scroll

  // History for Undo
  const [history, setHistory] = useState([]);

  // Derived State: Linked Counts per File Node
  const linkedCounts = useMemo(() => {
    const counts = {};
    snippets.forEach((s) => {
      const rp = s?.linkedTo?.relPath;
      if (rp) counts[rp] = (counts[rp] || 0) + 1;
    });
    return counts;
  }, [snippets]);

  // Derived State: Displayed Snippets
  const displayedSnippets = useMemo(() => {
    if (viewMode === 'association') {
      // Show only linked snippets
      // Sort by linkedFileId to group them visually for better lines
      return snippets
        .filter((s) => Boolean(s?.linkedTo?.relPath))
        .sort((a, b) => String(a?.linkedTo?.relPath || '').localeCompare(String(b?.linkedTo?.relPath || '')));
    }
    return snippets;
  }, [snippets, viewMode]);

  // --- Actions ---
  const addToast = (message, type = 'info', action) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type, actionLabel: action?.label, onAction: action?.onClick }]);

    // Auto dismiss
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleToggleExpand = (id) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedIds(newSet);
  };

  const handleToggleSelect = (id, multi) => {
    const newSet = new Set(multi ? selectedSnippetIds : []);
    if (newSet.has(id)) {
      if (multi) newSet.delete(id);
    } else {
      newSet.add(id);
    }
    if (!multi && !selectedSnippetIds.has(id)) {
      setSelectedSnippetIds(new Set([id]));
      return;
    }
    setSelectedSnippetIds(newSet);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setSnippets(previousState);
    setHistory((prev) => prev.slice(0, -1));
    addToast('Action undone', 'success');
  };

  const handleUnlink = (snippetId) => {
    setHistory((prev) => [...prev, snippets]); // Save state for undo
    const sn = snippets.find((s) => s.id === snippetId);
    const linkedRp = sn?.linkedTo?.relPath;
    setSnippets((prev) => prev.map((s) => (s.id === snippetId ? { ...s, linkedTo: null } : s)));
    addToast('已解除关联', 'info', { label: '撤销', onClick: handleUndo });

    const kApi = window.ipm?.knowledge?.removeLinkByItem;
    if (typeof kApi === 'function' && linkedRp) {
      kApi(projectName, snippetId, linkedRp, domainOpts).catch(() => {});
    }
  };

  const handleUpdateSnippet = (updated) => {
    setSnippets((prev) =>
      prev.map((s) => {
        if (s.id !== updated.id) return s;
        const nextFull = typeof updated.content === 'string' ? updated.content : s._fullText;
        const trimmed = String(nextFull || '').trim();
        const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
        return {
          ...s,
          title: updated.title,
          tags: updated.tags,
          _fullText: nextFull,
          content: preview,
        };
      }),
    );

    const kApi = window.ipm?.knowledge?.update;
    if (typeof kApi === 'function') {
      const patch = { title: updated.title, tags: updated.tags, importance: updated.importance };
      if (typeof updated.content === 'string') patch.content_text = updated.content;
      kApi(projectName, updated.id, patch, domainOpts).catch(() => {});
    }
  };

  const handleClearSelection = () => {
    setSelectedSnippetIds(new Set());
  };

  const ensureSnippetFullText = async (snippetId) => {
    const sn = snippets.find((s) => s.id === snippetId);
    if (!sn) return;
    if (typeof sn._fullText === 'string') return;
    const rel = sn._contentRelPath;
    if (!rel) return;
    const api = window.ipm?.explorer?.readText;
    if (typeof api !== 'function') return;
    try {
      const res = await api(projectName, rel, { maxBytes: 512 * 1024, ...domainOpts });
      const text = String(res?.text || '');
      setSnippets((prev) => prev.map((x) => (x.id === snippetId ? { ...x, _fullText: text } : x)));
    } catch {
      // ignore
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedSnippetIds.size) return;
    if (!window.confirm(`确定删除 ${selectedSnippetIds.size} 条知识碎片吗？该操作会删除对应文件（不可恢复）。`)) return;
    const ids = Array.from(selectedSnippetIds);
    setSelectedSnippetIds(new Set());
    setSnipBusy(true);
    try {
      const kApi = window.ipm?.knowledge?.delete;
      if (typeof kApi === 'function') {
        for (const id of ids) {
          // eslint-disable-next-line no-await-in-loop
          await kApi(projectName, id, domainOpts);
        }
      }
      setSnippets((prev) => prev.filter((s) => !ids.includes(s.id)));
      addToast(`已删除 ${ids.length} 条知识碎片`, 'success');
    } catch (e) {
      addToast(e?.message || String(e), 'error');
    } finally {
      setSnipBusy(false);
    }
  };

  // --- Drag & Drop Handlers (Root Level) ---
  const handleDragStart = (e) => {
    const t = e.target;
    const host = t && t.closest ? t.closest('[data-dragging-id]') : null;
    const draggedCardId = host ? host.getAttribute('data-dragging-id') : null;

    let idsToDrag = [];
    if (draggedCardId && !selectedSnippetIds.has(draggedCardId)) {
      idsToDrag = [draggedCardId];
      setSelectedSnippetIds(new Set([draggedCardId]));
    } else {
      idsToDrag = Array.from(selectedSnippetIds);
      if (idsToDrag.length === 0 && draggedCardId) idsToDrag = [draggedCardId];
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ ids: idsToDrag }));
    e.dataTransfer.effectAllowed = 'link';
  };

  const handleDropOnNode = (targetNodeId) => {
    const targetNode = fileNodeMap.get(targetNodeId);
    if (!targetNode) return;
    const idsToLink = Array.from(selectedSnippetIds);
    if (idsToLink.length === 0) return;
    if (targetNode.restricted) {
      addToast('该目录为系统目录，禁止关联', 'error');
      return;
    }

    setHistory((prev) => [...prev, snippets]);
    const kind = targetNode.type === 'FILE' ? 'file' : 'dir';
    setSnippets((prev) => prev.map((s) => (idsToLink.includes(s.id) ? { ...s, linkedTo: { relPath: targetNodeId, kind } } : s)));

    const count = idsToLink.length;
    addToast(`已关联 ${count} 条碎片到「${targetNode.name}」`, 'success', { label: '撤销', onClick: handleUndo });
    setSelectedSnippetIds(new Set());

    const kApi = window.ipm?.knowledge?.addLink;
    if (typeof kApi === 'function') {
      idsToLink.forEach((id) => {
        kApi(projectName, id, targetNodeId, kind, domainOpts).catch(() => {});
      });
    }
  };

  // --- Scroll Tracking for Lines ---
  const handleScroll = () => {
    if (viewMode === 'association') {
      setScrollVersion((prev) => prev + 1);
    }
  };

  // In association view, redraw lines on window resize
  useEffect(() => {
    if (viewMode !== 'association') return;
    const onResize = () => setScrollVersion((v) => v + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewMode]);

  // ===== Step 2: real data (initial integration) =====
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!projectName) return;
      const api = window.ipm?.explorer;
      if (!api?.list) return;
      setDataLoading(true);
      setDataError('');
      try {
        const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');

        // --- File tree ---
        const buildTree = async (relPath = '') => {
          const rp = norm(relPath);
          const res = await api.list(projectName, rp, domainOpts);
          const entries = Array.isArray(res?.entries) ? res.entries : [];

          const nodes = [];
          for (const e of entries) {
            const kind = String(e?.kind || '');
            const name = String(e?.name || '');
            const childRel = norm(e?.relPath || '');
            if (!name || !childRel) continue;

            if (kind === 'dir') {
              const isSystemRootFolder = childRel === 'snippets' || childRel === 'meta';
              const restricted = isSystemRootFolder;
              nodes.push({
                id: childRel,
                name,
                type: 'FOLDER',
                restricted,
                // For system folders in Step 2: show but do not recurse/build children (avoid clutter + cannot associate anyway)
                children: restricted ? [] : await buildTree(childRel),
              });
              continue;
            }
            if (kind === 'file') {
              nodes.push({ id: childRel, name, type: 'FILE' });
            }
          }
          return nodes;
        };

        const realTree = await buildTree('');

        // --- Snippets from knowledge API ---
        const kListApi = window.ipm?.knowledge?.list;
        let realSnips = [];
        if (typeof kListApi === 'function') {
          const kRes = await kListApi(projectName, { archived: false }, domainOpts);
          const kItems = Array.isArray(kRes?.items) ? kRes.items : [];
          realSnips = kItems
            .map((it) => {
              const tags = Array.isArray(it?.tags) ? it.tags.map((x) => String(x)).filter(Boolean) : [];
              const displayTags = tags.length ? tags : ['temp'];
              const links = Array.isArray(it?.links) ? it.links : [];
              const firstLink = links[0] || null;
              const linkedTo = firstLink ? { relPath: norm(firstLink.target_path), kind: String(firstLink.target_kind || 'dir') } : null;
              return {
                id: String(it.id || ''),
                title: String(it.title || '默认标题'),
                content: String(it?.content_text || ''),
                _contentRelPath: norm(it?.content_path || ''),
                _fullText: undefined,
                tags: displayTags,
                source: String(it?.source_kind || 'manual'),
                createdAt: String((it.created_at || '').slice(0, 10) || ''),
                importance: it?.importance ? String(it.importance) : undefined,
                linkedTo: linkedTo && linkedTo.relPath ? linkedTo : null,
                _type: String(it?.type || 'snippet'),
                _absolutePath: it?._absolutePath || null,
              };
            })
            .filter((s) => s.id);
        }

        if (cancelled) return;
        setFileTree(realTree);
        setSnippets(realSnips);
        // Reset UI selections/expansions for real data
        setSelectedSnippetIds(new Set());
        setExpandedIds(new Set());
        setFocusedNodeId(null);
        setActiveSnippetId(null);
      } catch (e) {
        if (cancelled) return;
        setDataError(e?.message || String(e));
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [projectName, domain]);

  // Subscribe to knowledge changes for realtime updates
  useEffect(() => {
    if (!projectName) return () => {};
    const sub = window.ipm?.knowledge?.subscribe;
    const kListApi = window.ipm?.knowledge?.list;
    if (typeof sub !== 'function' || typeof kListApi !== 'function') return () => {};
    const off = sub((evt) => {
      if (!evt || evt.projectName !== projectName) return;
      kListApi(projectName, { archived: false }, domainOpts)
        .then((kRes) => {
          const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
          const kItems = Array.isArray(kRes?.items) ? kRes.items : [];
          const next = kItems
            .map((it) => {
              const tags = Array.isArray(it?.tags) ? it.tags.map((x) => String(x)).filter(Boolean) : [];
              const displayTags = tags.length ? tags : ['temp'];
              const links = Array.isArray(it?.links) ? it.links : [];
              const firstLink = links[0] || null;
              const linkedTo = firstLink ? { relPath: norm(firstLink.target_path), kind: String(firstLink.target_kind || 'dir') } : null;
              return {
                id: String(it.id || ''),
                title: String(it.title || '默认标题'),
                content: String(it?.content_text || ''),
                _contentRelPath: norm(it?.content_path || ''),
                _fullText: undefined,
                tags: displayTags,
                source: String(it?.source_kind || 'manual'),
                createdAt: String((it.created_at || '').slice(0, 10) || ''),
                importance: it?.importance ? String(it.importance) : undefined,
                linkedTo: linkedTo && linkedTo.relPath ? linkedTo : null,
                _type: String(it?.type || 'snippet'),
                _absolutePath: it?._absolutePath || null,
              };
            })
            .filter((s) => s.id);
          setSnippets(next);
        })
        .catch(() => {});
    });
    return () => off?.();
  }, [projectName, domain]);

  return (
    <div className="flex-1 flex h-full w-full bg-white overflow-hidden font-sans relative min-h-0" onDragStart={handleDragStart}>
      {/* Toast Notification Layer */}
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {/* Snippet Detail Panel */}
      <SnippetDetailPanel
        isOpen={activeSnippetId !== null}
        snippet={activeSnippetForPanel}
        onClose={() => setActiveSnippetId(null)}
        onUpdate={handleUpdateSnippet}
      />

      {/* Connection Lines Layer */}
      <ConnectorLines
        viewMode={viewMode}
        snippets={displayedSnippets}
        fileNodeRefs={fileNodeRefs}
        snippetRefs={snippetRefs}
        focusedNodeId={focusedNodeId}
        scrollVersion={scrollVersion}
      />

      {/* LEFT PANEL */}
      <aside
        className={`
           w-80 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col h-full transition-all duration-300 z-30
           ${viewMode === 'association' ? 'bg-white shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]' : ''}
         `}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 mb-3 text-gray-700">
            <div className={`p-1.5 rounded-md transition-colors ${viewMode === 'association' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
              {viewMode === 'association' ? <Network size={18} /> : <FolderTree size={18} />}
            </div>
            <h2 className="font-bold text-sm tracking-tight">{viewMode === 'association' ? '关联关系' : '归档目录'}</h2>
          </div>

          {viewMode === 'structure' ? (
            <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary-500 transition-colors" size={14} />
              <input
                type="text"
                placeholder="Search folders..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-100 border border-transparent rounded-md focus:bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar" onScroll={handleScroll}>
          {viewMode === 'structure' ? (
            <div className="p-2">
              <FileTree
                nodes={fileTree}
                linkedCounts={linkedCounts}
                onDrop={handleDropOnNode}
                searchQuery={searchQuery}
                expandedIds={expandedIds}
                onToggleExpand={handleToggleExpand}
              />
            </div>
          ) : (
            <AssociationNodeList
              nodes={flatNodes}
              linkedCounts={linkedCounts}
              focusedNodeId={focusedNodeId}
              onFocusNode={setFocusedNodeId}
              registerRef={(id, el) => {
                if (el) fileNodeRefs.current.set(id, el);
                else fileNodeRefs.current.delete(id);
              }}
            />
          )}
          <div className="h-20"></div>
        </div>

        {/* Footer Stats */}
        <div className="p-3 border-t border-gray-200 bg-white text-xs text-gray-400 flex justify-between z-10 relative">
          <span>{viewMode === 'association' ? Object.keys(linkedCounts).length : fileNodeMap.size} Nodes</span>
          <span>{history.length > 0 ? `${history.length} Undos available` : 'History clean'}</span>
        </div>
      </aside>

      {/* RIGHT PANEL: Snippet Board */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-gray-50/50 z-30">
        {/* Header / Toolbar */}
        <div className="h-16 px-6 border-b border-gray-200 bg-white flex items-center justify-between shrink-0 shadow-sm z-40 relative">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-all active:scale-95 shadow-sm"
              title="返回"
            >
              <ArrowLeft size={14} /> 返回
            </button>

            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400 truncate">{projectName ? `PROJECT · ${projectName}` : 'PROJECT'}</div>
              <h1 className="text-xl font-bold text-gray-800 truncate">知识碎片</h1>
            </div>

            <div className="h-6 w-px bg-gray-200 mx-2"></div>
            <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {viewMode === 'association' ? `${displayedSnippets.length} 已关联` : `${snippets.filter((s) => !s.linkedFileId).length} 未归档`}
                </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Switcher */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1 mr-2">
              <button
                type="button"
                onClick={() => {
                  setViewMode('structure');
                  setFocusedNodeId(null);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'structure' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <LayoutGrid size={14} /> 结构视图
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('association');
                  setFocusedNodeId(null);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'association' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Network size={14} /> 关联视图
              </button>
            </div>

            {selectedSnippetIds.size > 0 ? (
              <div className="flex items-center gap-2 animate-in fade-in duration-200">
                <span className="text-sm font-medium text-primary-600 bg-primary-50 px-3 py-1 rounded-full">
                  已选 {selectedSnippetIds.size}
                </span>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={snipBusy}
                  className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors disabled:opacity-50"
                  title="删除所选"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  title="取消选择"
                >
                  取消
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleUndo}
              disabled={history.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm"
              title="Undo"
            >
              <Undo2 size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0" onScroll={handleScroll}>
          {dataLoading ? (
            <div className="mb-4 text-xs text-gray-400">正在加载项目数据…</div>
          ) : null}
          {dataError ? (
            <div className="mb-4 px-3 py-2 rounded border border-rose-200 bg-rose-50 text-rose-700 text-xs">{dataError}</div>
          ) : null}
          <div
            className={`
              grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20 transition-opacity duration-300
              ${viewMode === 'association' ? 'gap-y-12' : ''}
           `}
          >
            {displayedSnippets.map((snippet) => {
              const linkedRp = snippet?.linkedTo?.relPath || '';
              const linkedNode = linkedRp ? fileNodeMap.get(linkedRp) : undefined;
              // In Association view, dim if focus is active and this snippet is not part of the focus group
              const isDimmed = viewMode === 'association' && focusedNodeId !== null && focusedNodeId !== linkedRp;

              return (
                <SnippetCard
                  key={snippet.id}
                  ref={(el) => {
                    if (el) snippetRefs.current.set(snippet.id, el);
                    else snippetRefs.current.delete(snippet.id);
                  }}
                  snippet={snippet}
                  isSelected={selectedSnippetIds.has(snippet.id)}
                  onToggleSelect={handleToggleSelect}
                  linkedFileName={linkedNode?.name}
                  onUnlink={handleUnlink}
                  isDimmed={isDimmed}
                  showAnchor={viewMode === 'association'}
                  onDoubleClick={() => {
                    setActiveSnippetId(snippet.id);
                    ensureSnippetFullText(snippet.id).catch(() => {});
                  }}
                  isActive={activeSnippetId === snippet.id}
                />
              );
            })}
          </div>

          {displayedSnippets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <p>
                {viewMode === 'association'
                  ? '暂无已关联的知识碎片。请切换到「结构视图」进行拖拽归档。'
                  : '暂无知识碎片'}
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}


