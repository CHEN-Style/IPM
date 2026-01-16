import { useCallback, useState } from 'react';

const useContextMenu = ({
  isRoot,
  entityLabel,
  newProjectInputRef,
  setErrorText,
  openNewFolder,
  uploadFiles,
  pickFilesAndAiClassify,
  deleteProject,
  uploadFilesTo,
  openNewFolderAt,
  openRename,
  deleteEntry,
  removeLocalFolder,
}) => {
  const [menu, setMenu] = useState(null); // {x,y, items:[{label,onClick, danger?}]}

  const openMenu = useCallback((x, y, items) => setMenu({ x, y, items }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleBlankContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isRoot) {
        openMenu(e.clientX, e.clientY, [
          {
            label: `新建${entityLabel}`,
            onClick: () => {
              setErrorText?.('');
              setTimeout(() => newProjectInputRef.current?.focus(), 0);
            },
          },
        ]);
        return;
      }

      openMenu(e.clientX, e.clientY, [
        { label: '新建文件夹', onClick: () => openNewFolder?.() },
        { label: '上传文件', onClick: () => uploadFiles?.() },
        { label: '上传并AI分类', onClick: () => pickFilesAndAiClassify?.() },
      ]);
    },
    [entityLabel, isRoot, newProjectInputRef, openMenu, openNewFolder, pickFilesAndAiClassify, setErrorText, uploadFiles],
  );

  const handleRowContextMenuRoot = useCallback(
    (e, projectName) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, [
        { label: `删除${entityLabel}：${projectName}`, danger: true, onClick: () => deleteProject?.(projectName) },
      ]);
    },
    [deleteProject, entityLabel, openMenu],
  );

  const handleRowContextMenuLocalFolder = useCallback(
    (e, folder) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, [
        { label: `取消关联：${folder?.name || '本地文件夹'}`, danger: true, onClick: () => removeLocalFolder?.(folder?.path) },
      ]);
    },
    [openMenu, removeLocalFolder],
  );

  const handleRowContextMenuEntry = useCallback(
    (e, entry) => {
      e.preventDefault();
      e.stopPropagation();
      if (isRoot) return;
      if (entry.kind === 'dir') {
        openMenu(e.clientX, e.clientY, [
          { label: `上传文件到文件夹「${entry.name}」`, onClick: () => uploadFilesTo?.(entry.relPath, entry.name) },
          { label: `在「${entry.name}」中新建文件夹`, onClick: () => openNewFolderAt?.(entry.relPath, entry.name) },
          { label: `重命名：${entry.name}`, onClick: () => openRename?.(entry) },
          { label: `删除文件夹：${entry.name}`, danger: true, onClick: () => deleteEntry?.(entry) },
        ]);
        return;
      }
      openMenu(e.clientX, e.clientY, [
        { label: `重命名：${entry.name}`, onClick: () => openRename?.(entry) },
        { label: `删除文件：${entry.name}`, danger: true, onClick: () => deleteEntry?.(entry) },
      ]);
    },
    [deleteEntry, isRoot, openMenu, openNewFolderAt, openRename, uploadFilesTo],
  );

  return {
    menu,
    openMenu,
    closeMenu,
    handleBlankContextMenu,
    handleRowContextMenuRoot,
    handleRowContextMenuLocalFolder,
    handleRowContextMenuEntry,
  };
};

export default useContextMenu;


