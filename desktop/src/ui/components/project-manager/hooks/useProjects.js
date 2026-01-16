import { useCallback, useEffect, useState } from 'react';

const PROJECT_STATUSES = ['active', 'pending', 'archived'];

const statusLabel = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'pending') return 'PENDING';
  if (v === 'archived') return 'ARCHIVED';
  return 'ACTIVE';
};

const rowStyleByStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'pending') return 'bg-amber-50/60 hover:bg-amber-50';
  if (v === 'archived') return 'bg-slate-100/60 hover:bg-slate-100 text-slate-400';
  return 'hover:bg-slate-50/50';
};

const badgeByStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'pending') return { dot: 'bg-amber-500', ring: 'ring-amber-500/20', on: 'bg-amber-500/15 text-amber-700 border-amber-300/40' };
  if (v === 'archived') return { dot: 'bg-slate-500', ring: 'ring-slate-500/20', on: 'bg-slate-500/10 text-slate-600 border-slate-300/60' };
  return { dot: 'bg-emerald-500', ring: 'ring-emerald-500/20', on: 'bg-emerald-500/15 text-emerald-700 border-emerald-300/40' };
};

const useProjects = ({ normalizedDomain, isStudy, entityApi, setNotice }) => {
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);

  const refreshProjects = useCallback(async () => {
    if (isStudy) return;
    if (!entityApi?.list) return;
    const list = await entityApi.list();
    setProjects(list);
    const cur = await entityApi.getCurrent();
    setCurrentProject(cur);
  }, [isStudy, entityApi]);

  const setProjectStatus = useCallback(
    async (name, nextStatus) => {
      if (!entityApi?.setStatus) {
        setNotice?.({ variant: 'error', message: 'setStatus 未就绪：请重启应用（不要只刷新页面）' });
        return;
      }
      try {
        await entityApi.setStatus(name, nextStatus);
        await refreshProjects();
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [entityApi, refreshProjects, setNotice],
  );

  useEffect(() => {
    refreshProjects().catch(console.error);
  }, [normalizedDomain, refreshProjects]);

  return {
    projects,
    currentProject,
    setCurrentProject,
    refreshProjects,
    PROJECT_STATUSES,
    statusLabel,
    rowStyleByStatus,
    badgeByStatus,
    setProjectStatus,
  };
};

export default useProjects;


