import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../hooks/useToast.js';

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');

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

const getFlatNodeList = (nodes) => {
  let flat = [];
  nodes.forEach((n) => {
    flat.push(n);
    if (n.children) flat = flat.concat(getFlatNodeList(n.children));
  });
  return flat;
};

export default function useKnowledgeLinker({ projectName, domain, items, onItemsChange }) {
  const domainOpts = domain ? { domain } : {};

  const [fileTree, setFileTree] = useState([]);
  const fileNodeMap = useMemo(() => flattenTree(fileTree), [fileTree]);
  const flatNodes = useMemo(() => getFlatNodeList(fileTree), [fileTree]);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [treeSearch, setTreeSearch] = useState('');
  const [treeLoading, setTreeLoading] = useState(false);

  const [linkerSubView, setLinkerSubView] = useState('structure'); // structure | association
  const [focusedNodeId, setFocusedNodeId] = useState(null);

  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState([]);

  const fileNodeRefs = useRef(new Map());
  const snippetRefs = useRef(new Map());
  const [scrollVersion, setScrollVersion] = useState(0);

  // Map items to linker-compatible shape (with linkedTo)
  const linkerItems = useMemo(() => {
    return items.map((it) => {
      const links = Array.isArray(it.links) ? it.links : [];
      const firstLink = links[0] || null;
      const linkedTo = firstLink ? { relPath: norm(firstLink.target_path), kind: String(firstLink.target_kind || 'dir') } : null;
      return { ...it, linkedTo: linkedTo && linkedTo.relPath ? linkedTo : null };
    });
  }, [items]);

  const linkedCounts = useMemo(() => {
    const counts = {};
    linkerItems.forEach((s) => {
      const rp = s?.linkedTo?.relPath;
      if (rp) counts[rp] = (counts[rp] || 0) + 1;
    });
    return counts;
  }, [linkerItems]);

  const displayedItems = useMemo(() => {
    if (linkerSubView === 'association') {
      return linkerItems
        .filter((s) => Boolean(s?.linkedTo?.relPath))
        .sort((a, b) => String(a?.linkedTo?.relPath || '').localeCompare(String(b?.linkedTo?.relPath || '')));
    }
    return linkerItems;
  }, [linkerItems, linkerSubView]);

  const { showToast: globalToast } = useToast();

  const addToast = useCallback((message, type = 'info', action) => {
    if (!action) {
      globalToast(message, type);
      return;
    }
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type, actionLabel: action?.label, onAction: action?.onClick }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, [globalToast]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Tree actions
  const handleToggleExpand = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Selection
  const handleToggleSelect = useCallback((id, multi) => {
    setSelectedIds((prev) => {
      if (!multi) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Undo
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previousItems = history[history.length - 1];
    if (typeof onItemsChange === 'function') onItemsChange(previousItems);
    setHistory((prev) => prev.slice(0, -1));
    addToast('已撤销', 'success');
  }, [history, onItemsChange, addToast]);

  // Unlink
  const handleUnlink = useCallback((itemId) => {
    const item = linkerItems.find((s) => s.id === itemId);
    const linkedRp = item?.linkedTo?.relPath;
    setHistory((prev) => [...prev, items]);
    addToast('已解除关联', 'info', { label: '撤销', onClick: handleUndo });

    const kApi = window.ipm?.knowledge?.removeLinkByItem;
    if (typeof kApi === 'function' && linkedRp) {
      kApi(projectName, itemId, linkedRp, domainOpts).catch(() => {});
    }
  }, [linkerItems, items, projectName, domainOpts, addToast, handleUndo]);

  // Drag start
  const handleDragStart = useCallback((e) => {
    const host = e.target?.closest?.('[data-dragging-id]');
    const draggedId = host?.getAttribute?.('data-dragging-id');

    let ids = [];
    if (draggedId && !selectedIds.has(draggedId)) {
      ids = [draggedId];
      setSelectedIds(new Set([draggedId]));
    } else {
      ids = Array.from(selectedIds);
      if (ids.length === 0 && draggedId) ids = [draggedId];
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ ids }));
    e.dataTransfer.effectAllowed = 'link';
  }, [selectedIds]);

  // Drop on file node
  const handleDropOnNode = useCallback((targetNodeId) => {
    const targetNode = fileNodeMap.get(targetNodeId);
    if (!targetNode) return;
    const idsToLink = Array.from(selectedIds);
    if (idsToLink.length === 0) return;
    if (targetNode.restricted) {
      addToast('该目录为系统目录，禁止关联', 'error');
      return;
    }

    setHistory((prev) => [...prev, items]);
    const kind = targetNode.type === 'FILE' ? 'file' : 'dir';
    addToast(`已关联 ${idsToLink.length} 条碎片到「${targetNode.name}」`, 'success', { label: '撤销', onClick: handleUndo });
    setSelectedIds(new Set());

    const kApi = window.ipm?.knowledge?.addLink;
    if (typeof kApi === 'function') {
      idsToLink.forEach((id) => {
        kApi(projectName, id, targetNodeId, kind, domainOpts).catch(() => {});
      });
    }
  }, [fileNodeMap, selectedIds, items, projectName, domainOpts, addToast, handleUndo]);

  // Scroll handler for connector lines
  const handleScroll = useCallback(() => {
    if (linkerSubView === 'association') {
      setScrollVersion((v) => v + 1);
    }
  }, [linkerSubView]);

  // Resize listener for connector lines
  useEffect(() => {
    if (linkerSubView !== 'association') return;
    const onResize = () => setScrollVersion((v) => v + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [linkerSubView]);

  // Load file tree
  useEffect(() => {
    if (!projectName) return;
    let cancelled = false;
    const run = async () => {
      const api = window.ipm?.explorer;
      if (!api?.list) return;
      setTreeLoading(true);
      try {
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
              const restricted = childRel === 'snippets' || childRel === 'meta';
              nodes.push({
                id: childRel,
                name,
                type: 'FOLDER',
                restricted,
                children: restricted ? [] : await buildTree(childRel),
              });
            } else if (kind === 'file') {
              nodes.push({ id: childRel, name, type: 'FILE' });
            }
          }
          return nodes;
        };
        const tree = await buildTree('');
        if (!cancelled) setFileTree(tree);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [projectName, domain]);

  return {
    fileTree,
    fileNodeMap,
    flatNodes,
    selectedIds,
    expandedIds,
    treeSearch,
    setTreeSearch,
    treeLoading,
    linkerSubView,
    setLinkerSubView,
    focusedNodeId,
    setFocusedNodeId,
    toasts,
    dismissToast,
    history,
    linkedCounts,
    displayedItems,
    fileNodeRefs,
    snippetRefs,
    scrollVersion,
    handleToggleExpand,
    handleToggleSelect,
    handleClearSelection,
    handleUndo,
    handleUnlink,
    handleDragStart,
    handleDropOnNode,
    handleScroll,
  };
}
