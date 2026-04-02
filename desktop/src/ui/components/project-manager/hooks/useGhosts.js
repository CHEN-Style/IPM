import { useCallback, useMemo, useState } from 'react';

const useGhosts = ({ cwd, domainOpts, refreshEntries, setNotice }) => {
  const [ghosts, setGhosts] = useState([]); // suggestions[] from ai-storage.json (pending+others)
  const [ghostLoading, setGhostLoading] = useState(false);

  const refreshGhosts = useCallback(async () => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.list;
    if (!api) return;
    setGhostLoading(true);
    try {
      const res = await api(cwd.name, { status: 'pending', ...domainOpts });
      setGhosts(Array.isArray(res?.suggestions) ? res.suggestions : []);
    } catch {
      // ignore
    } finally {
      setGhostLoading(false);
    }
  }, [cwd, domainOpts]);

  const pendingGhostsAll = useMemo(() => {
    if (cwd.type !== 'project') return [];
    return (ghosts || []).filter((g) => String(g?.status) === 'pending');
  }, [ghosts, cwd.type]);

  const pendingGhostGroups = useMemo(() => {
    const map = new Map(); // folderRelPath -> suggestions[]
    for (const g of pendingGhostsAll) {
      const k = String(g?.suggestedFolderRelPath || '');
      if (!k) continue;
      const arr = map.get(k) || [];
      arr.push(g);
      map.set(k, arr);
    }
    const groups = Array.from(map.entries())
      .map(([folderRelPath, items]) => ({ folderRelPath, items }))
      .sort((a, b) => b.items.length - a.items.length || a.folderRelPath.localeCompare(b.folderRelPath, 'zh-Hans-CN'));
    return groups;
  }, [pendingGhostsAll]);

  const pendingGhostCount = pendingGhostsAll.length;
  const pendingGhostFolderCount = pendingGhostGroups.length;
  const showOverviewBar = cwd.type === 'project' && !cwd.relPath && pendingGhostCount > 0;

  const pendingGhostsInCwd = useMemo(() => {
    if (cwd.type !== 'project') return [];
    const rel = String(cwd.relPath || '');
    return (ghosts || []).filter((g) => String(g?.status) === 'pending' && String(g?.suggestedFolderRelPath) === rel);
  }, [ghosts, cwd.type, cwd.relPath]);

  const acceptGhost = useCallback(
    async (sourceRelPath) => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.accept;
      if (!api) return;
      try {
        const res = await api(cwd.name, sourceRelPath, domainOpts);
        await refreshEntries?.();
        await refreshGhosts();
        if (res?.stale) {
          setNotice?.({ variant: 'info', message: '源文件已不在暂存区，本条建议已自动关闭' });
        } else if (res?.alreadyApplied) {
          setNotice?.({ variant: 'success', message: '文件已在目标文件夹，建议已标记为已接受' });
        } else {
          setNotice?.({ variant: 'success', message: '已移动（AI 建议已接受）' });
        }
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshGhosts, setNotice],
  );

  const rejectGhost = useCallback(
    async (sourceRelPath, { userFeedback } = {}) => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.reject;
      if (!api) return;
      try {
        await api(cwd.name, sourceRelPath, { ...domainOpts, userFeedback: userFeedback || null });
        await refreshGhosts();
        setNotice?.({ variant: 'info', message: '已放弃（暂存建议已拒绝）' });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshGhosts, setNotice],
  );

  const acceptAllGhostsHere = useCallback(
    async () => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.acceptAll;
      if (!api) return;
      try {
        const res = await api(cwd.name, { folderRelPath: cwd.relPath || '', ...domainOpts });
        await refreshEntries?.();
        await refreshGhosts();
        const parts = [`已接受 ${res?.accepted || 0} 个`];
        if (res?.alreadyApplied) parts.push(`其中 ${res.alreadyApplied} 个已在目标位置`);
        if (res?.staleClosed) parts.push(`已清理失效建议 ${res.staleClosed} 条`);
        if (res?.failed) parts.push(`失败 ${res.failed} 个`);
        setNotice?.({ variant: 'success', message: parts.join('；') });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshGhosts, setNotice],
  );

  const rejectAllGhostsHere = useCallback(
    async () => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.rejectAll;
      if (!api) return;
      try {
        const res = await api(cwd.name, { folderRelPath: cwd.relPath || '', ...domainOpts });
        await refreshGhosts();
        setNotice?.({ variant: 'info', message: `已放弃 ${res?.rejected || 0} 个` });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshGhosts, setNotice],
  );

  const acceptAllGhostsProject = useCallback(
    async () => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.acceptAll;
      if (!api) return;
      try {
        const res = await api(cwd.name, { ...domainOpts });
        await refreshEntries?.();
        await refreshGhosts();
        const parts = [`已接受 ${res?.accepted || 0} 个`];
        if (res?.alreadyApplied) parts.push(`其中 ${res.alreadyApplied} 个已在目标位置`);
        if (res?.staleClosed) parts.push(`已清理失效建议 ${res.staleClosed} 条`);
        if (res?.failed) parts.push(`失败 ${res.failed} 个`);
        setNotice?.({ variant: 'success', message: parts.join('；') });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshGhosts, setNotice],
  );

  const rejectAllGhostsProject = useCallback(
    async () => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.rejectAll;
      if (!api) return;
      try {
        const res = await api(cwd.name, { ...domainOpts });
        await refreshGhosts();
        setNotice?.({ variant: 'info', message: `已放弃 ${res?.rejected || 0} 个` });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshGhosts, setNotice],
  );

  const acceptGroup = useCallback(
    async (folderRelPath) => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.acceptAll;
      if (!api) return;
      try {
        const res = await api(cwd.name, { folderRelPath, ...domainOpts });
        await refreshEntries?.();
        await refreshGhosts();
        const parts = [`已接受 ${res?.accepted || 0} 个`];
        if (res?.alreadyApplied) parts.push(`其中 ${res.alreadyApplied} 个已在目标位置`);
        if (res?.staleClosed) parts.push(`已清理失效建议 ${res.staleClosed} 条`);
        if (res?.failed) parts.push(`失败 ${res.failed} 个`);
        setNotice?.({ variant: 'success', message: parts.join('；') });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshGhosts, setNotice],
  );

  const rejectGroup = useCallback(
    async (folderRelPath) => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.rejectAll;
      if (!api) return;
      try {
        const res = await api(cwd.name, { folderRelPath, ...domainOpts });
        await refreshGhosts();
        setNotice?.({ variant: 'info', message: `已放弃 ${res?.rejected || 0} 个` });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshGhosts, setNotice],
  );

  return {
    ghosts,
    ghostLoading,
    refreshGhosts,
    pendingGhostsAll,
    pendingGhostGroups,
    pendingGhostCount,
    pendingGhostFolderCount,
    showOverviewBar,
    pendingGhostsInCwd,
    acceptGhost,
    rejectGhost,
    acceptAllGhostsHere,
    rejectAllGhostsHere,
    acceptAllGhostsProject,
    rejectAllGhostsProject,
    acceptGroup,
    rejectGroup,
  };
};

export default useGhosts;


