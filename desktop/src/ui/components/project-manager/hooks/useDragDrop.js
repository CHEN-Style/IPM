import { useCallback, useState } from 'react';

const useDragDrop = ({ cwd, domainOpts, refreshEntries, refreshTreeDir, setNotice }) => {
  const [dragOverFolderRelPath, setDragOverFolderRelPath] = useState('');

  const getDragPayload = useCallback((e) => {
    try {
      const raw = e.dataTransfer.getData('application/x-ipm-entry') || e.dataTransfer.getData('text/plain');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, []);

  const onDragStartEntry = useCallback(
    (e, entry) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      setDragOverFolderRelPath('');
      const payload = { relPath: entry.relPath, kind: entry.kind, name: entry.name };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-ipm-entry', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    },
    [cwd.type],
  );

  const onDragEndAny = useCallback(() => {
    setDragOverFolderRelPath('');
  }, []);

  const moveEntryTo = useCallback(
    async (srcRelPath, destDirRelPath) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      try {
        const res =
          cwd.type === 'project'
            ? await window.ipm.explorer.move(cwd.name, srcRelPath, destDirRelPath || '', domainOpts)
            : await window.ipm.localExplorer.move(cwd.rootPath, srcRelPath, destDirRelPath || '');
        if (res?.ok === false && res?.conflict) {
          setNotice?.({ variant: 'warn', message: '已取消移动（存在重名）' });
          return;
        }
        await refreshEntries?.();
        {
          const srcParts = String(srcRelPath || '').split('/').filter(Boolean);
          srcParts.pop();
          const srcParent = srcParts.join('/');
          await refreshTreeDir?.(destDirRelPath || '');
          if (srcParent !== (destDirRelPath || '')) await refreshTreeDir?.(srcParent);
        }
        setNotice?.({ variant: 'success', message: '移动完成' });
      } catch (e) {
        const raw = e?.message || String(e);
        const cleaned = raw
          .replace(/^Error invoking remote method 'explorer\/move': Error:\s*/i, '')
          .replace(/^Error invoking remote method 'localExplorer\/move': Error:\s*/i, '');
        setNotice?.({ variant: 'error', message: cleaned });
      }
    },
    [cwd, refreshEntries, refreshTreeDir, setNotice],
  );

  const onDropOnFolder = useCallback(
    async (e, folderEntry) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverFolderRelPath('');
      const payload = getDragPayload(e);
      if (!payload?.relPath) return;
      if (folderEntry.kind !== 'dir') return;
      if (payload.relPath === folderEntry.relPath) return;
      if (payload.kind === 'dir') {
        const src = String(payload.relPath);
        const dest = String(folderEntry.relPath);
        if (dest.startsWith(src + '/')) {
          setNotice?.({ variant: 'warn', message: '不能将文件夹移动到其自身或子目录中' });
          return;
        }
      }
      await moveEntryTo(payload.relPath, folderEntry.relPath);
    },
    [getDragPayload, moveEntryTo, setNotice],
  );

  const onDragOverFolder = useCallback((e, folderEntry) => {
    if (folderEntry.kind !== 'dir') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolderRelPath(folderEntry.relPath);
  }, []);

  const onDragLeaveFolder = useCallback(
    (_e, folderEntry) => {
      if (dragOverFolderRelPath === folderEntry.relPath) setDragOverFolderRelPath('');
    },
    [dragOverFolderRelPath],
  );

  return {
    dragOverFolderRelPath,
    onDragStartEntry,
    onDragEndAny,
    onDropOnFolder,
    onDragOverFolder,
    onDragLeaveFolder,
  };
};

export default useDragDrop;


