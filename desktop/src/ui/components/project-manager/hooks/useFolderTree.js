import { useCallback, useEffect, useState } from 'react';
import { normalizeRelPathPosix } from '../utils.js';

const useFolderTree = ({ cwd, domainOpts, normalizedDomain, setNotice, setErrorText }) => {
  const [tree, setTree] = useState({}); // relPath -> { open, loading, entries }

  const resetTree = useCallback(() => setTree({}), []);

  const refreshTreeDir = useCallback(
    async (relPath) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      const key = normalizeRelPathPosix(relPath);
      try {
        const res =
          cwd.type === 'project'
            ? await window.ipm.explorer.list(cwd.name, key, domainOpts)
            : await window.ipm.localExplorer.list(cwd.rootPath, key);
        setTree((t) => {
          const prev = t[key] || {};
          return {
            ...t,
            [key]: {
              open: prev.open ?? true,
              loading: false,
              entries: res.entries || [],
            },
          };
        });
      } catch (e) {
        const msg = e?.message || String(e);
        setNotice?.({ variant: 'error', message: msg });
      }
    },
    [cwd, domainOpts, setNotice],
  );

  const ensureTreeNode = useCallback(
    async (relPath) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      const key = normalizeRelPathPosix(relPath);
      setTree((t) => ({
        ...t,
        [key]: { ...(t[key] || {}), loading: true, open: true },
      }));
      try {
        const res =
          cwd.type === 'project'
            ? await window.ipm.explorer.list(cwd.name, key, domainOpts)
            : await window.ipm.localExplorer.list(cwd.rootPath, key);
        setTree((t) => ({
          ...t,
          [key]: { open: true, loading: false, entries: res.entries || [] },
        }));
      } catch (e) {
        setErrorText?.(e?.message || String(e));
        setTree((t) => ({
          ...t,
          [key]: { ...(t[key] || {}), loading: false, open: true, entries: [] },
        }));
      }
    },
    [cwd, domainOpts, setErrorText],
  );

  const toggleTreeDir = useCallback(
    async (relPath) => {
      const key = normalizeRelPathPosix(relPath);
      const node = tree[key];
      if (!node) {
        await ensureTreeNode(key);
        return;
      }
      if (!node.open) {
        setTree((t) => ({
          ...t,
          [key]: { ...(t[key] || {}), open: true },
        }));
        if (!Array.isArray(node.entries)) {
          await ensureTreeNode(key);
        }
        return;
      }
      setTree((t) => ({
        ...t,
        [key]: { ...(t[key] || {}), open: false },
      }));
    },
    [tree, ensureTreeNode],
  );

  const removeTreeNode = useCallback((relPath) => {
    setTree((t) => {
      const next = { ...t };
      delete next[relPath];
      return next;
    });
  }, []);

  // Reveal the full ancestor chain of `relPath` by marking every level
  // open. The recursive ExplorerTree auto-loads children of any open node
  // that hasn't been fetched yet (its `onLoad` effect), so flipping the
  // `open` flags here is enough to cascade the lazy loads down to the
  // target. Used to keep the left tree in sync with right-pane / breadcrumb
  // / AI-overview navigation (dual-pane linkage).
  const expandToPath = useCallback(
    (relPath) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      const norm = normalizeRelPathPosix(relPath);
      const parts = norm ? norm.split('/').filter(Boolean) : [];
      const keys = [''];
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        keys.push(acc);
      }
      setTree((t) => {
        const next = { ...t };
        for (const k of keys) next[k] = { ...(next[k] || {}), open: true };
        return next;
      });
    },
    [cwd.type],
  );

  // Dual-pane: the tree is always live inside a project/local workspace
  // (no longer gated behind an explicit explorer view-mode). Rebuild the
  // root only when the workspace itself changes (domain / project / local
  // root); navigating between sub-folders in the right pane keeps the
  // existing expansion state.
  useEffect(() => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    resetTree();
    try {
      window.setTimeout(() => {
        ensureTreeNode('').catch(() => {});
      }, 0);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath]);

  return {
    tree,
    resetTree,
    refreshTreeDir,
    ensureTreeNode,
    toggleTreeDir,
    removeTreeNode,
    expandToPath,
  };
};

export default useFolderTree;


