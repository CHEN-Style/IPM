import { useCallback, useEffect, useState } from 'react';

// F1: 此 Hook 在 W1-W4 之前是通过 `localFolders/*` IPC 浏览外部目录的旧入口
// （只读式浏览，不写入 IPM）。F1 之后，"导入外部文件夹"由 `projects.importAttached` /
// `cases.importAttached` 实现：在数据存储区创建附属壳 + meta/external-link.json
// 指向外部根，外部目录被纳入项目列表。
//
// 兼容策略：
//  - 旧的 `localFolders/list`（state.localFolders 数组）依然返回，但 RootTable
//    F1 后不再渲染该分组（前端展示统一看 `projects` 列表）。
//  - `importLocalFolder` 直接调用新 IPC（projects.importAttached / cases.importAttached），
//    成功后通过 onAttachedImported 回调让上层刷新项目列表。
//  - `removeLocalFolder` 保留，仅作用于历史遗留的 localFolders。

const useLocalFolders = ({ normalizedDomain, setNotice, onAttachedImported }) => {
  // 仅保留遗留 localFolders 数据（用于一次性迁移提示），不展示在新版 RootTable。
  const [localFolders, setLocalFolders] = useState([]);

  const refreshLocalFolders = useCallback(async () => {
    const api = window.ipm?.localFolders?.list;
    if (!api) return;
    try {
      const res = await api();
      const arr = Array.isArray(res?.folders) ? res.folders : [];
      setLocalFolders(arr);
    } catch {
      setLocalFolders([]);
    }
  }, []);

  // F1: 外部文件夹「附属导入」。学习域不开放（学习固定结构，不允许附属壳）。
  const importLocalFolder = useCallback(async () => {
    const api =
      normalizedDomain === 'cases'
        ? window.ipm?.cases?.importAttached
        : normalizedDomain === 'study'
          ? null
          : window.ipm?.projects?.importAttached;
    if (!api) {
      setNotice?.({
        variant: 'error',
        message:
          normalizedDomain === 'study'
            ? '学习域暂不支持外部导入'
            : 'importAttached 未就绪：请重启应用（不要只刷新页面）',
      });
      return;
    }
    try {
      const res = await api();
      if (res?.canceled) return;
      if (!res?.ok) throw new Error(res?.error || '导入失败');
      setNotice?.({
        variant: 'success',
        message: `已导入「${res.name}」（外部目录：${res.externalRootPath}）`,
      });
      if (typeof onAttachedImported === 'function') {
        try { await onAttachedImported(res); } catch { /* ignore */ }
      }
    } catch (e) {
      setNotice?.({ variant: 'error', message: e?.message || String(e) });
    }
  }, [normalizedDomain, onAttachedImported, setNotice]);

  // 保留的旧 localFolders 删除入口（仅作用于历史遗留数据）
  const removeLocalFolder = useCallback(
    async (absPath) => {
      const api = window.ipm?.localFolders?.remove;
      if (!api) return;
      if (!window.confirm('确定从历史导入列表中移除该文件夹吗？（不会删除磁盘上的文件）')) return;
      try {
        await api(absPath);
        await refreshLocalFolders();
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
