import { useCallback, useEffect, useState } from 'react';

const useLocalFolders = ({ normalizedDomain, setNotice }) => {
  const [localFolders, setLocalFolders] = useState([]); // {path,name,exists,reason}[]

  const refreshLocalFolders = useCallback(async () => {
    const api = window.ipm?.localFolders?.list;
    if (!api) return;
    try {
      const res = await api();
      const arr = Array.isArray(res?.folders) ? res.folders : [];
      setLocalFolders(arr);
      const bad = arr.filter((x) => x && x.exists === false);
      if (bad.length) {
        setNotice?.({ variant: 'warn', message: `有 ${bad.length} 个导入的本地文件夹已失效（可能被移动/删除/重命名），请取消关联或重新导入。` });
      }
    } catch {
      // best-effort; do not block projects page
      setLocalFolders([]);
    }
  }, [setNotice]);

  const importLocalFolder = useCallback(async () => {
    const api = window.ipm?.localFolders?.import;
    if (!api) {
      setNotice?.({ variant: 'error', message: 'localFolders/import 未就绪：请重启应用（不要只刷新页面）' });
      return;
    }
    try {
      const res = await api();
      await refreshLocalFolders();
      if (res?.canceled) return;
      setNotice?.({ variant: 'success', message: '已导入本地文件夹（仅用于浏览/基础文件操作）' });
    } catch (e) {
      setNotice?.({ variant: 'error', message: e?.message || String(e) });
    }
  }, [refreshLocalFolders, setNotice]);

  const removeLocalFolder = useCallback(
    async (absPath) => {
      const api = window.ipm?.localFolders?.remove;
      if (!api) return;
      if (!window.confirm('确定取消关联该本地文件夹吗？')) return;
      try {
        await api(absPath);
        await refreshLocalFolders();
        setNotice?.({ variant: 'info', message: '已取消关联' });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [refreshLocalFolders, setNotice],
  );

  useEffect(() => {
    refreshLocalFolders().catch(() => {});
  }, [normalizedDomain, refreshLocalFolders]);

  return {
    localFolders,
    refreshLocalFolders,
    importLocalFolder,
    removeLocalFolder,
  };
};

export default useLocalFolders;


