import { useCallback, useEffect, useState } from 'react';
import { normalizeRelPathPosix } from '../utils.js';

const useFolderTree = ({ cwd, domainOpts, normalizedDomain, viewMode, setNotice, setErrorText }) => {
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

  useEffect(() => {
    if (viewMode !== 'explorer') return;
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
  }, [normalizedDomain, viewMode, cwd.type, cwd.name, cwd.rootPath]);

  return {
    tree,
    resetTree,
    refreshTreeDir,
    ensureTreeNode,
    toggleTreeDir,
    removeTreeNode,
  };
};

export default useFolderTree;


