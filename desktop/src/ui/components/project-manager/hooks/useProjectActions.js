import { useCallback, useState } from 'react';

const useProjectActions = ({
  entityApi,
  entityLabel,
  isStudy,
  refreshProjects,
  refreshLocalFolders,
  setCwd,
  setErrorText,
  setNotice,
  setCurrentProject,
}) => {
  const [newProjectName, setNewProjectName] = useState('');

  const enterProject = useCallback(
    async (name) => {
      await entityApi?.setCurrent?.(name);
      setCurrentProject?.(name);
      setCwd({ type: 'project', name, relPath: '' });
    },
    [entityApi, setCurrentProject, setCwd],
  );

  const enterLocalFolder = useCallback(
    async (rootPath) => {
      const rp = String(rootPath || '').trim();
      if (!rp) return;
      setCwd({ type: 'local', rootPath: rp, relPath: '' });
    },
    [setCwd],
  );

  const goRoot = useCallback(async () => {
    if (isStudy) {
      setCwd({ type: 'project', name: '', relPath: '' });
      return;
    }
    setCwd({ type: 'root' });
    await refreshProjects?.();
    await refreshLocalFolders?.().catch(() => {});
  }, [isStudy, refreshLocalFolders, refreshProjects, setCwd]);

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) {
      setErrorText?.(`请输入${entityLabel}名称`);
      return;
    }
    if (!entityApi?.create) {
      setErrorText?.('create 未就绪：请重启应用（不要只刷新页面）');
      return;
    }
    setErrorText?.('');
    try {
      await entityApi.create(name);
      setNewProjectName('');
      await refreshProjects?.();
      setCwd({ type: 'root' });
    } catch (e) {
      setErrorText?.(e?.message || String(e));
    }
  }, [entityApi, entityLabel, newProjectName, refreshProjects, setCwd, setErrorText]);

  const deleteProject = useCallback(
    async (name) => {
      if (!entityApi?.delete) {
        setErrorText?.('delete 未就绪：请重启应用（不要只刷新页面）');
        return;
      }
      if (!window.confirm(`确定删除${entityLabel}「${name}」吗？此操作将删除整个文件夹（不可恢复）。`)) return;
      setErrorText?.('');
      try {
        await entityApi.delete(name);
        await refreshProjects?.();
        setCwd({ type: 'root' });
      } catch (e) {
        setErrorText?.(e?.message || String(e));
      }
    },
    [entityApi, entityLabel, refreshProjects, setCwd, setErrorText],
  );

  return {
    newProjectName,
    setNewProjectName,
    enterProject,
    enterLocalFolder,
    goRoot,
    createProject,
    deleteProject,
  };
};

export default useProjectActions;


