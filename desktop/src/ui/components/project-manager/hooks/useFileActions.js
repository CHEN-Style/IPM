import { useCallback, useState } from 'react';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog.jsx';

const useFileActions = ({
  cwd,
  domainOpts,
  refreshEntries,
  refreshGhosts,
  refreshTreeDir,
  removeTreeNode,
  setNotice,
  setErrorText,
}) => {
  const confirm = useConfirmDialog();
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderBaseRelPath, setNewFolderBaseRelPath] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameRelPath, setRenameRelPath] = useState('');
  const [renameOldName, setRenameOldName] = useState('');
  const [renameNewName, setRenameNewName] = useState('');

  const openNewFolder = useCallback(() => {
    setNewFolderName('');
    setNewFolderBaseRelPath(cwd.type === 'project' || cwd.type === 'local' ? cwd.relPath || '' : '');
    setNewFolderOpen(true);
  }, [cwd]);

  const openNewFolderAt = useCallback((baseRelPath) => {
    setNewFolderName('');
    setNewFolderBaseRelPath(String(baseRelPath || ''));
    setNewFolderOpen(true);
  }, []);

  const createFolder = useCallback(async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const name = newFolderName.trim();
    if (!name) {
      setErrorText?.('请输入文件夹名称');
      return;
    }
    setErrorText?.('');
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.mkdir(cwd.name, newFolderBaseRelPath || '', name, domainOpts)
          : await window.ipm.localExplorer.mkdir(cwd.rootPath, newFolderBaseRelPath || '', name);
      if (res?.ok === false && res?.conflict) {
        setNotice?.({ variant: 'warn', message: '已取消创建（存在重名）' });
        return;
      }
      setNewFolderOpen(false);
      await refreshEntries?.();
      await refreshTreeDir?.(newFolderBaseRelPath || '');
      setNotice?.({ variant: 'success', message: `已创建文件夹：${res?.createdName || name}` });
    } catch (e) {
      setErrorText?.(e?.message || String(e));
      setNotice?.({ variant: 'error', message: e?.message || String(e) });
    }
  }, [cwd, domainOpts, newFolderBaseRelPath, newFolderName, refreshEntries, refreshTreeDir, setErrorText, setNotice]);

  const uploadFiles = useCallback(async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setErrorText?.('');
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.upload(cwd.name, cwd.relPath || '', domainOpts)
          : await window.ipm.localExplorer.upload(cwd.rootPath, cwd.relPath || '');
      if (res?.ok === false && res?.conflict) {
        setNotice?.({ variant: 'warn', message: '已取消上传（存在重名）' });
        return;
      }
      await refreshEntries?.();
      await refreshTreeDir?.(cwd.relPath || '');
      setNotice?.({ variant: 'success', message: '上传完成' });
    } catch (e) {
      setErrorText?.(e?.message || String(e));
      setNotice?.({ variant: 'error', message: e?.message || String(e) });
    }
  }, [cwd, domainOpts, refreshEntries, refreshTreeDir, setErrorText, setNotice]);

  const uploadFilesTo = useCallback(
    async (destRelPath, folderName) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      setErrorText?.('');
      try {
        const res =
          cwd.type === 'project'
            ? await window.ipm.explorer.upload(cwd.name, destRelPath || '', domainOpts)
            : await window.ipm.localExplorer.upload(cwd.rootPath, destRelPath || '');
        if (res?.ok === false && res?.conflict) {
          setNotice?.({ variant: 'warn', message: `已取消上传（「${folderName}」中存在重名）` });
          return;
        }
        await refreshEntries?.();
        await refreshTreeDir?.(destRelPath || '');
        setNotice?.({ variant: 'success', message: `已上传到「${folderName}」` });
      } catch (e) {
        setErrorText?.(e?.message || String(e));
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshTreeDir, setErrorText, setNotice],
  );

  const dropUploadFiles = useCallback(
    async (filePaths) => {
      if (cwd.type !== 'project') return;
      if (!filePaths?.length) return;
      setErrorText?.('');
      try {
        const res = await window.ipm.explorer.dropUpload(cwd.name, cwd.relPath || '', filePaths, domainOpts);
        if (res?.ok) {
          await refreshEntries?.();
          await refreshTreeDir?.(cwd.relPath || '');
          setNotice?.({ variant: 'success', message: `已上传 ${filePaths.length} 个文件/文件夹` });
        }
      } catch (e) {
        setErrorText?.(e?.message || String(e));
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshTreeDir, setErrorText, setNotice],
  );

  const deleteEntry = useCallback(
    async (entry) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      const label = entry.kind === 'dir' ? '文件夹' : '文件';
      const ok = await confirm({
        title: `删除${label}`,
        message: `确定删除${label}「${entry.name}」吗？此操作不可恢复。`,
        confirmLabel: '删除',
        danger: true,
      });
      if (!ok) return;
      setErrorText?.('');
      try {
        if (cwd.type === 'project') {
          await window.ipm.explorer.delete(cwd.name, entry.relPath, domainOpts);
        } else {
          await window.ipm.localExplorer.delete(cwd.rootPath, entry.relPath);
        }
        await refreshEntries?.();
        await refreshGhosts?.().catch(() => {});
        {
          const parts = String(entry.relPath || '').split('/').filter(Boolean);
          parts.pop();
          const parent = parts.join('/');
          await refreshTreeDir?.(parent);
          removeTreeNode?.(entry.relPath);
        }
        setNotice?.({ variant: 'success', message: '已删除' });
      } catch (e) {
        const raw = e?.message || String(e);
        const cleaned = raw
          .replace(/^Error invoking remote method 'explorer\/delete': Error:\s*/i, '')
          .replace(/^Error invoking remote method 'localExplorer\/delete': Error:\s*/i, '');
        setErrorText?.(cleaned);
        setNotice?.({ variant: 'error', message: cleaned });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshGhosts, refreshTreeDir, removeTreeNode, setErrorText, setNotice],
  );

  const openRename = useCallback(
    (entry) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      setRenameRelPath(entry.relPath);
      setRenameOldName(entry.name);
      setRenameNewName(entry.name);
      setRenameOpen(true);
    },
    [cwd.type],
  );

  const doRename = useCallback(async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const newName = renameNewName.trim();
    if (!newName) {
      setNotice?.({ variant: 'warn', message: '新名称不能为空' });
      return;
    }
    if (newName === renameOldName) {
      setRenameOpen(false);
      setNotice?.({ variant: 'info', message: '名称未变化' });
      return;
    }
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.rename(cwd.name, renameRelPath, newName, domainOpts)
          : await window.ipm.localExplorer.rename(cwd.rootPath, renameRelPath, newName);
      if (res?.ok === false && res?.conflict) {
        setNotice?.({ variant: 'warn', message: '已取消重命名（存在重名）' });
        return;
      }
      setRenameOpen(false);
      await refreshEntries?.();
      {
        const parts = String(renameRelPath || '').split('/').filter(Boolean);
        parts.pop();
        await refreshTreeDir?.(parts.join('/'));
      }
      setNotice?.({ variant: 'success', message: `已重命名为：${res?.renamedTo || newName}` });
    } catch (e) {
      setNotice?.({ variant: 'error', message: e?.message || String(e) });
    }
  }, [cwd, domainOpts, refreshEntries, refreshTreeDir, renameNewName, renameOldName, renameRelPath, setNotice]);

  const openFileByRelPath = useCallback(
    async (relPath) => {
      try {
        if (cwd.type === 'project') {
          const api = window.ipm?.explorer?.open;
          if (!api) {
            setNotice?.({ variant: 'error', message: 'explorer/open 未就绪：请重启应用（不要只刷新页面）' });
            return;
          }
          await api(cwd.name, relPath, domainOpts);
          return;
        }
        if (cwd.type === 'local') {
          const api = window.ipm?.localExplorer?.open;
          if (!api) {
            setNotice?.({ variant: 'error', message: 'localExplorer/open 未就绪：请重启应用（不要只刷新页面）' });
            return;
          }
          await api(cwd.rootPath, relPath);
        }
      } catch (e) {
        const raw = e?.message || String(e);
        const cleaned = raw
          .replace(/^Error invoking remote method 'explorer\/open': Error:\s*/i, '')
          .replace(/^Error invoking remote method 'localExplorer\/open': Error:\s*/i, '');
        setNotice?.({ variant: 'error', message: cleaned });
      }
    },
    [cwd, domainOpts, setNotice],
  );

  return {
    newFolderOpen,
    newFolderName,
    newFolderBaseRelPath,
    renameOpen,
    renameOldName,
    renameNewName,
    setNewFolderOpen,
    setNewFolderName,
    setNewFolderBaseRelPath,
    setRenameOpen,
    setRenameNewName,
    openNewFolder,
    openNewFolderAt,
    createFolder,
    uploadFiles,
    uploadFilesTo,
    dropUploadFiles,
    deleteEntry,
    openRename,
    doRename,
    openFileByRelPath,
  };
};

export default useFileActions;


