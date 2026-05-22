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
  onCreateKnowledge,
  // W3b: 项目/案件根级重命名（学习域不传则不显示菜单项）
  renameProject,
  // F1: 附属壳专属操作（外部导入项目）。projects 提供识别 attached 标记的元数据，
  // refreshAttached/relocateAttached 是显式的右键操作回调。
  projects,
  refreshAttached,
  relocateAttached,
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
        { label: '新建知识碎片', onClick: () => onCreateKnowledge?.(null) },
      ]);
    },
    [entityLabel, isRoot, newProjectInputRef, openMenu, openNewFolder, pickFilesAndAiClassify, setErrorText, uploadFiles, onCreateKnowledge],
  );

  const handleRowContextMenuRoot = useCallback(
    (e, projectName) => {
      e.preventDefault();
      e.stopPropagation();
      const items = [];
      const meta = (projects || []).find((p) => p && p.name === projectName) || null;
      const isAttached = Boolean(meta?.attached);
      if (typeof renameProject === 'function') {
        items.push({ label: `重命名${entityLabel}：${projectName}`, onClick: () => renameProject(projectName) });
      }
      if (isAttached && typeof refreshAttached === 'function') {
        items.push({ label: `刷新外部结构：${projectName}`, onClick: () => refreshAttached(projectName) });
      }
      if (isAttached && typeof relocateAttached === 'function') {
        items.push({ label: `重新定位外部根：${projectName}`, onClick: () => relocateAttached(projectName) });
      }
      items.push({
        label: isAttached ? `取消导入：${projectName}` : `删除${entityLabel}：${projectName}`,
        danger: true,
        onClick: () => deleteProject?.(projectName),
      });
      openMenu(e.clientX, e.clientY, items);
    },
    [deleteProject, entityLabel, openMenu, projects, refreshAttached, relocateAttached, renameProject],
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
          { label: '新建知识碎片', onClick: () => onCreateKnowledge?.(entry) },
          { label: `重命名：${entry.name}`, onClick: () => openRename?.(entry) },
          { label: `删除文件夹：${entry.name}`, danger: true, onClick: () => deleteEntry?.(entry) },
        ]);
        return;
      }
      openMenu(e.clientX, e.clientY, [
        { label: '新建知识碎片', onClick: () => onCreateKnowledge?.(entry) },
        { label: `重命名：${entry.name}`, onClick: () => openRename?.(entry) },
        { label: `删除文件：${entry.name}`, danger: true, onClick: () => deleteEntry?.(entry) },
      ]);
    },
    [deleteEntry, isRoot, openMenu, openNewFolderAt, openRename, uploadFilesTo, onCreateKnowledge],
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


