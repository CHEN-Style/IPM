import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import KnowledgePage from './knowledge/KnowledgePage.jsx';
import FolderDetailPanel from './project-manager/FolderDetailPanel.jsx';
import AIGhostOverview from './project-manager/AIGhostOverview.jsx';
import HeaderBar from './project-manager/HeaderBar.jsx';
import RootTable from './project-manager/RootTable.jsx';
import EntryTable from './project-manager/EntryTable.jsx';
import useProjects from './project-manager/hooks/useProjects.js';
import useExplorerEntries from './project-manager/hooks/useExplorerEntries.js';
import useGhosts from './project-manager/hooks/useGhosts.js';
import useDragDrop from './project-manager/hooks/useDragDrop.js';
import useFolderDetail from './project-manager/hooks/useFolderDetail.js';
import useClipboardUpload from './project-manager/hooks/useClipboardUpload.js';
import useLocalFolders from './project-manager/hooks/useLocalFolders.js';
import useFolderTree from './project-manager/hooks/useFolderTree.js';
import useContextMenu from './project-manager/hooks/useContextMenu.js';
import useFileActions from './project-manager/hooks/useFileActions.js';
import useProjectActions from './project-manager/hooks/useProjectActions.js';
import useResumeRefresh from './project-manager/hooks/useResumeRefresh.js';
import useTraceView from './project-manager/hooks/useTraceView.js';
import useClassifyPipeline from './project-manager/hooks/useClassifyPipeline.js';
import ClassifyTraceView from './project-manager/ClassifyTraceView.jsx';
import PreferencesPage from './project-manager/PreferencesPage.jsx';
import CreateKnowledgeModal from './project-manager/CreateKnowledgeModal.jsx';
import SyncStatusBar from './cloud-projects/SyncStatusBar.jsx';
import FileHistoryRestoreModal from './cloud-projects/FileHistoryRestoreModal.jsx';
import { useToast } from '../hooks/useToast.js';
import { useCloudPublish } from '../hooks/useCloudPublish.jsx';
import { fileDecor, folderDecor, fmtBytes, fmtTime } from './project-manager/utils.js';

/** Stable analytics ids for context menu rows (labels come from useContextMenu). */
function pmContextMenuTrack(label) {
  const t = String(label || '');
  if (/^新建(项目|案件|学习)$/.test(t)) return 'pm-create-project';
  if (t === '新建文件夹') return 'pm-new-folder';
  if (t === '上传文件') return 'pm-upload-files';
  if (t === '上传并AI分类') return 'pm-ai-classify-upload';
  if (t === '新建知识碎片') return 'pm-knowledge';
  if (t.startsWith('上传文件到文件夹')) return 'pm-upload-to-folder';
  if (/^在「.+」中新建文件夹$/.test(t)) return 'pm-new-folder-in-folder';
  if (t.startsWith('重命名：')) return 'pm-rename-entry';
  if (t.startsWith('查看历史/恢复文件：')) return 'pm-restore-file';
  if (t.startsWith('删除文件夹：')) return 'pm-delete-folder';
  if (t.startsWith('删除文件：')) return 'pm-delete-file';
  if (t.startsWith('取消关联：')) return 'pm-unlink-local-folder';
  if (/^删除.+：/.test(t)) return 'pm-delete-project';
  return undefined;
}

const ProjectManager = ({ domain = 'projects', onBackHome = null, searchNavTarget = null, onSearchNavDone = null }) => {
  const raw = String(domain || 'projects').toLowerCase();
  const normalizedDomain = raw === 'cases' ? 'cases' : raw === 'study' ? 'study' : 'projects';
  const isCases = normalizedDomain === 'cases';
  const isStudy = normalizedDomain === 'study';
  const entityLabel = isStudy ? '学习' : isCases ? '案件' : '项目';
  const entityLabelAll = isStudy ? '学习' : `所有${entityLabel}`;
  const domainOpts = useMemo(() => ({ domain: normalizedDomain }), [normalizedDomain]);
  const entityApi = isCases ? window.ipm?.cases : isStudy ? null : window.ipm?.projects;

  const [notice, setNotice] = useState(null); // {variant,message}
  const { showToast } = useToast();
  useEffect(() => {
    if (notice) {
      showToast(notice.message || String(notice), notice.variant || 'info');
      setNotice(null);
    }
  }, [notice, showToast]);
  const [fileFilters, setFileFilters] = useState([]);
  const [filterPersistent, setFilterPersistent] = useState(false);
  const {
    projects,
    currentProject,
    setCurrentProject,
    refreshProjects,
    PROJECT_STATUSES,
    statusLabel,
    rowStyleByStatus,
    badgeByStatus,
    setProjectStatus,
  } = useProjects({ normalizedDomain, isStudy, entityApi, setNotice });

  // C3: cloud publish wiring. Tracks per-project binding status (for the cloud
  // icon / menu) and derives the set of projects currently being published.
  const cloud = useCloudPublish();
  const [cloudBindings, setCloudBindings] = useState({}); // name -> { bound, versionNumber }
  const fetchBinding = useCallback(async (name) => {
    if (!name || isStudy) return;
    try {
      const res = await window.ipm?.cloud?.getBindingStatus?.({ projectName: name, domain: normalizedDomain });
      setCloudBindings((prev) => ({
        ...prev,
        [name]: { bound: Boolean(res?.bound), versionNumber: res?.binding?.lastSyncedVersionNumber ?? null },
      }));
    } catch { /* ignore */ }
  }, [isStudy, normalizedDomain]);
  useEffect(() => {
    if (isStudy) return;
    for (const p of projects || []) {
      if (p?.name && !p.attached) void fetchBinding(p.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, normalizedDomain, isStudy]);

  const cloudLockedNames = useMemo(() => {
    const set = new Set();
    for (const a of cloud.activityList) {
      if (a.phase === 'publishing' && a.domain === normalizedDomain) set.add(a.projectName);
    }
    return set;
  }, [cloud.activityList, normalizedDomain]);
  const cloudBoundNames = useMemo(() => {
    const set = new Set();
    for (const [name, info] of Object.entries(cloudBindings)) {
      if (info?.bound) set.add(name);
    }
    return set;
  }, [cloudBindings]);

  const handlePublishProject = useCallback((name) => {
    if (!name) return;
    cloud.openPublishModal(name, normalizedDomain);
  }, [cloud, normalizedDomain]);

  // Refresh a project's binding once its publish finishes.
  const handledDoneRef = useRef(new Set());
  useEffect(() => {
    for (const a of cloud.activityList) {
      if (a.phase === 'done' && a.domain === normalizedDomain && !handledDoneRef.current.has(a.key)) {
        handledDoneRef.current.add(a.key);
        void fetchBinding(a.projectName);
      }
    }
  }, [cloud.activityList, normalizedDomain, fetchBinding]);

  const [knowledgeCtx, setKnowledgeCtx] = useState(null); // { name, path } | null
  const {
    cwd,
    setCwd,
    entries,
    setEntries,
    loading,
    errorText,
    setErrorText,
    refreshEntries,
    enterRelDir,
    goParent,
  } = useExplorerEntries({ isStudy, domainOpts });
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'explorer' (UI only for now)
  const newProjectInputRef = useRef(null);

  // AI ghost files (staging suggestions)
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState({}); // folderRelPath -> boolean
  const {
    ghostLoading,
    refreshGhosts,
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
  } = useGhosts({ cwd, domainOpts, refreshEntries, setNotice });
  const {
    aiUploadInputRef,
    aiUpload,
    uploadFilesAndAiClassify,
    pickFilesAndAiClassify,
  } = useClipboardUpload({
    cwd,
    domainOpts,
    refreshEntries,
    refreshGhosts,
    setNotice,
    setErrorText,
  });

  const { traceOpen, traceLoading, traceData, openTrace, closeTrace } = useTraceView({ cwd, domainOpts });
  const [preferencesCtx, setPreferencesCtx] = useState(null);
  const pipelineState = useClassifyPipeline({ cwd, refreshGhosts, refreshEntries });

  // F1: 导入外部文件夹后刷新项目列表 + 进入新创建的附属壳
  const onAttachedImported = useCallback(async (res) => {
    try { await refreshProjects?.(); } catch { /* ignore */ }
    if (res?.name) {
      try {
        if (entityApi?.setCurrent) await entityApi.setCurrent(res.name);
        setCurrentProject?.(res.name);
      } catch { /* ignore */ }
    }
  }, [entityApi, refreshProjects, setCurrentProject]);
  const { localFolders, refreshLocalFolders, importLocalFolder, removeLocalFolder } = useLocalFolders({ normalizedDomain, setNotice, onAttachedImported });
  // W1: 新建项目/案件时弹模板选择窗（默认四类 / 空白）。
  // 学习域固定结构，不显示模板选择。
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // W3b: 项目/案件重命名两步模态。
  // step 'warning' → 风险告知；step 'input' → 输入新名称。学习域不开放。
  const [renameWorkspaceState, setRenameWorkspaceState] = useState({
    open: false,
    step: 'warning', // 'warning' | 'input' | 'busy'
    oldName: '',
    newName: '',
    error: '',
  });
  const openRenameWorkspace = useCallback((name) => {
    if (!name) return;
    setRenameWorkspaceState({ open: true, step: 'warning', oldName: name, newName: name, error: '' });
  }, []);
  const closeRenameWorkspace = useCallback(() => {
    setRenameWorkspaceState((s) => ({ ...s, open: false }));
  }, []);
  const submitRenameWorkspace = useCallback(async () => {
    const { oldName, newName } = renameWorkspaceState;
    const trimmed = String(newName || '').trim();
    if (!trimmed) {
      setRenameWorkspaceState((s) => ({ ...s, error: '新名称不能为空' }));
      return;
    }
    if (trimmed === oldName) {
      setRenameWorkspaceState((s) => ({ ...s, error: '新名称与原名称相同' }));
      return;
    }
    // 复用主进程 sanitize：仅在客户端做基础非法字符检查，最终由后端校验
    if (/[<>:"/\\|?*]/.test(trimmed)) {
      setRenameWorkspaceState((s) => ({ ...s, error: '名称不能包含 < > : " / \\ | ? * 等字符' }));
      return;
    }
    setRenameWorkspaceState((s) => ({ ...s, step: 'busy', error: '' }));
    try {
      const api = entityApi;
      if (!api || typeof api.rename !== 'function') {
        throw new Error('当前域不支持重命名');
      }
      const res = await api.rename(oldName, trimmed);
      if (!res?.ok && !res?.summary?.diskRenamed) {
        throw new Error(res?.errors?.join('; ') || '重命名失败');
      }
      setRenameWorkspaceState({ open: false, step: 'warning', oldName: '', newName: '', error: '' });
      // 刷新列表 + 切换 currentProject
      try {
        await refreshProjects?.();
      } catch { /* ignore */ }
      try {
        if (typeof api.setCurrent === 'function') await api.setCurrent(trimmed);
        setCurrentProject?.(trimmed);
      } catch { /* ignore */ }
      const partial = Array.isArray(res?.errors) && res.errors.length > 0;
      setNotice?.({
        variant: partial ? 'warn' : 'success',
        message: partial
          ? `已重命名为「${trimmed}」，但部分联动失败：${res.errors.join('；')}`
          : `已重命名为「${trimmed}」`,
      });
    } catch (e) {
      setRenameWorkspaceState((s) => ({ ...s, step: 'input', error: e?.message || '重命名失败' }));
    }
  }, [entityApi, refreshProjects, setCurrentProject, setNotice, renameWorkspaceState]);
  const {
    newProjectName,
    setNewProjectName,
    enterProject,
    enterLocalFolder,
    goRoot,
    createProject,
    createProjectWithTemplate,
    deleteProject,
  } = useProjectActions({
    entityApi,
    entityLabel,
    isStudy,
    refreshProjects,
    refreshLocalFolders,
    setCwd,
    setErrorText,
    setNotice,
    setCurrentProject,
    onRequestTemplate: isStudy ? undefined : () => setTemplatePickerOpen(true),
    projects,
  });

  const {
    detailOpen,
    detailVisible,
    detailLoading,
    detail,
    descEditing,
    descDraft,
    descSaving,
    setDescEditing,
    setDescDraft,
    openFolderDetail,
    closeFolderDetail,
    saveFolderDescription,
  } = useFolderDetail({ cwd, domainOpts, setNotice });

  const {
    tree,
    resetTree,
    refreshTreeDir,
    ensureTreeNode,
    toggleTreeDir,
    removeTreeNode,
  } = useFolderTree({ cwd, domainOpts, normalizedDomain, viewMode, setNotice, setErrorText });

  const {
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
  } = useFileActions({
    cwd,
    domainOpts,
    viewMode,
    refreshEntries,
    refreshGhosts,
    refreshTreeDir,
    removeTreeNode,
    setNotice,
    setErrorText,
  });

  const isRoot = cwd.type === 'root';
  const isProjectCwd = cwd.type === 'project';
  const isLocalCwd = cwd.type === 'local';
  const setViewModeSafe = (next) => {
    setViewMode(next);
    if (isRoot) {
      setNotice({
        variant: 'info',
        message: `提示：视图切换仅在进入某个${entityLabel}后生效；当前为「${entityLabelAll}」视图。`,
      });
    }
  };
  const [createKnowledgeTarget, setCreateKnowledgeTarget] = useState(null);
  const [restoreFileTarget, setRestoreFileTarget] = useState(null);
  const openRestoreFile = useCallback((entry) => {
    if (!entry || entry.kind !== 'file' || cwd.type !== 'project' || !cwd.name) return;
    setRestoreFileTarget({ entry, projectName: cwd.name, domain: normalizedDomain });
  }, [cwd, normalizedDomain]);
  const {
    menu,
    closeMenu,
    handleBlankContextMenu,
    handleRowContextMenuRoot,
    handleRowContextMenuLocalFolder,
    handleRowContextMenuEntry,
  } = useContextMenu({
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
    onCreateKnowledge: (entry) => {
      const projName = cwd?.name || currentProject;
      if (!projName) return;
      const meta = (projects || []).find((p) => p && p.name === projName) || null;
      setCreateKnowledgeTarget({
        entry,
        projectName: projName,
        domain: normalizedDomain,
        isAttached: Boolean(meta?.attached),
      });
    },
    onRestoreFile: !isStudy && cwd.type === 'project' && cloudBoundNames.has(cwd.name) ? openRestoreFile : undefined,
    // W3b: 仅 projects/cases 域提供根级重命名（学习域不传 → 菜单不显示）
    renameProject: isStudy ? undefined : openRenameWorkspace,
    // F1: 附属壳右键菜单 — 刷新外部结构 / 重新定位（仅项目和案件域）
    projects: isStudy ? [] : projects,
    refreshAttached: isStudy ? undefined : (async (name) => {
      const api = isCases ? window.ipm?.cases?.refreshAttached : window.ipm?.projects?.refreshAttached;
      if (!api) return;
      try {
        const res = await api(name);
        if (res?.broken) {
          setNotice({ variant: 'warn', message: `「${name}」外部目录失效：${res.brokenReason || '路径不可访问'}` });
        } else {
          setNotice({ variant: 'success', message: `已刷新「${name}」外部目录结构` });
        }
        try { await refreshProjects?.(); } catch { /* ignore */ }
      } catch (e) {
        setNotice({ variant: 'error', message: e?.message || String(e) });
      }
    }),
    relocateAttached: isStudy ? undefined : (async (name) => {
      const ok = window.confirm(
        `重新定位「${name}」的外部根路径：\n\n` +
        '注意：如果新位置的文件夹结构与原位置不同，之前基于目录结构的 AI 分类结果可能失效。\n\n' +
        '是否继续？',
      );
      if (!ok) return;
      const api = isCases ? window.ipm?.cases?.relocateAttached : window.ipm?.projects?.relocateAttached;
      if (!api) return;
      try {
        const res = await api(name);
        if (res?.canceled) return;
        setNotice({ variant: 'success', message: `「${name}」已重新定位到 ${res.externalRootPath}` });
        try { await refreshProjects?.(); } catch { /* ignore */ }
      } catch (e) {
        setNotice({ variant: 'error', message: e?.message || String(e) });
      }
    }),
    // C3: 云端发布（学习域不支持）
    onPublish: isStudy ? undefined : handlePublishProject,
    cloudBoundNames,
    cloudLockedNames,
  });
  const title = useMemo(() => {
    if (isRoot) return entityLabelAll;
    if (isProjectCwd) return cwd.name || entityLabel;
    if (isLocalCwd) return '本地文件夹';
    return `${entityLabel}文件`;
  }, [isRoot, isProjectCwd, isLocalCwd, cwd, entityLabelAll, entityLabel]);

  // F1: 当前 cwd 对应的项目是否为附属壳（外部导入项目）
  const currentProjectMeta = useMemo(() => {
    if (cwd.type !== 'project' || !cwd.name) return null;
    return (projects || []).find((p) => p && p.name === cwd.name) || null;
  }, [projects, cwd]);
  const isAttachedCwd = Boolean(currentProjectMeta?.attached);
  const isAttachedBroken = Boolean(currentProjectMeta?.broken);

  const handleRefreshAttached = useCallback(async () => {
    if (!currentProjectMeta || !currentProjectMeta.attached) return;
    const api = isCases ? window.ipm?.cases?.refreshAttached : window.ipm?.projects?.refreshAttached;
    if (!api) return;
    try {
      const res = await api(currentProjectMeta.name);
      if (res?.broken) {
        setNotice({ variant: 'warn', message: `外部目录失效：${res.brokenReason || '路径不可访问'}` });
      } else {
        setNotice({ variant: 'success', message: '已刷新外部目录结构' });
      }
      try { await refreshProjects?.(); } catch { /* ignore */ }
      try { await refreshEntries?.(); } catch { /* ignore */ }
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  }, [currentProjectMeta, isCases, refreshEntries, refreshProjects]);

  const handleRelocateAttached = useCallback(async () => {
    if (!currentProjectMeta || !currentProjectMeta.attached) return;
    const ok = window.confirm(
      '重新定位外部根路径：\n\n' +
      '注意：如果新位置的文件夹结构与原位置不同，之前基于目录结构的 AI 分类结果可能失效。\n\n' +
      '是否继续？',
    );
    if (!ok) return;
    const api = isCases ? window.ipm?.cases?.relocateAttached : window.ipm?.projects?.relocateAttached;
    if (!api) return;
    try {
      const res = await api(currentProjectMeta.name);
      if (res?.canceled) return;
      setNotice({ variant: 'success', message: `已重新定位到 ${res.externalRootPath}` });
      try { await refreshProjects?.(); } catch { /* ignore */ }
      try { await refreshEntries?.(); } catch { /* ignore */ }
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  }, [currentProjectMeta, isCases, refreshEntries, refreshProjects]);
  // W4: 进入工作区后位置信息完全交给面包屑，左侧不再显示重复的标题/副标题。
  // 仅根列表（isRoot）保留语义标题，因为面包屑此时也只有一项「所有项目/案件」，
  // 独立标题更易扫读、且能展示「共 N 个」的统计信息。
  const headerTitle = useMemo(() => {
    if (isRoot) return entityLabelAll;
    return '';
  }, [isRoot, entityLabelAll]);
  const headerSubtitle = useMemo(() => {
    if (isRoot) return `共 ${projects.length} 个${entityLabel}`;
    return '';
  }, [isRoot, projects.length, entityLabel]);
  const fileFilterOptions = useMemo(
    () => [
      { value: 'all', label: '全部类型' },
      { value: 'folder', label: '仅文件夹' },
      { value: 'doc', label: 'Word 文档' },
      { value: 'ppt', label: 'PPT 演示' },
      { value: 'excel', label: 'Excel 表格' },
      { value: 'pdf', label: 'PDF' },
      { value: 'text', label: '文本' },
      { value: 'image', label: '图片' },
      { value: 'video', label: '视频' },
      { value: 'audio', label: '音频' },
      { value: 'archive', label: '压缩包' },
      { value: 'code', label: '代码' },
    ],
    []
  );
  const fileFilterExts = useMemo(
    () => ({
      doc: ['doc', 'docx', 'rtf', 'odt'],
      ppt: ['ppt', 'pptx', 'key', 'odp'],
      excel: ['xls', 'xlsx', 'csv', 'ods'],
      pdf: ['pdf'],
      text: ['txt', 'md', 'markdown', 'log'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'heic'],
      video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
      archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'tgz'],
      code: ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'css', 'scss', 'less', 'sql', 'sh', 'bat', 'ps1', 'json', 'yml', 'yaml'],
    }),
    []
  );
  const breadcrumbs = useMemo(() => {
    const items = [];
    const relParts = String(cwd.relPath || '')
      .split(/[/\\]+/)
      .filter(Boolean);
    if (isRoot) {
      return [{ id: 'root', label: entityLabelAll, relPath: '', kind: 'root', active: true }];
    }
    if (isLocalCwd) {
      const rootLabel =
        String(cwd.rootPath || '')
          .split(/[/\\]+/)
          .filter(Boolean)
          .slice(-1)[0] || '本地文件夹';
      items.push({ id: 'local-root', label: rootLabel, relPath: '', kind: 'local-root' });
      relParts.forEach((part, index) => {
        items.push({
          id: `local-${index}`,
          label: part,
          relPath: relParts.slice(0, index + 1).join('/'),
          kind: 'local-path',
        });
      });
      if (items.length) items[items.length - 1].active = true;
      return items;
    }
    const rootLabel = isStudy ? '学习' : entityLabelAll;
    items.push({ id: 'root', label: rootLabel, relPath: '', kind: 'root' });
    if (!isStudy) {
      const projectLabel = cwd.name || title || entityLabel;
      items.push({ id: 'project', label: projectLabel, relPath: '', kind: 'project' });
    }
    relParts.forEach((part, index) => {
      items.push({
        id: `path-${index}`,
        label: part,
        relPath: relParts.slice(0, index + 1).join('/'),
        kind: 'path',
      });
    });
    if (items.length) items[items.length - 1].active = true;
    return items;
  }, [isRoot, isLocalCwd, isStudy, cwd, entityLabelAll, title, entityLabel]);
  const handleNavigateBreadcrumb = (crumb) => {
    if (!crumb || crumb.active) return;
    if (isLocalCwd) {
      if (crumb.kind === 'local-root') {
        setCwd({ ...cwd, relPath: '' });
        return;
      }
      if (typeof crumb.relPath === 'string') {
        setCwd({ ...cwd, relPath: crumb.relPath });
      }
          return;
        }
    if (crumb.kind === 'root') {
      if (isStudy) {
        setCwd({ type: 'project', name: '', relPath: '' });
        return;
      }
      goRoot();
          return;
        }
    if (crumb.kind === 'project') {
      setCwd({ ...cwd, relPath: '' });
        return;
      }
    if (typeof crumb.relPath === 'string') {
      setCwd({ ...cwd, relPath: crumb.relPath });
    }
  };

  // Reset navigation context when switching domain.
  useEffect(() => {
    if (isStudy) {
      setCwd({ type: 'project', name: '', relPath: '' });
      setEntries([]);
      resetTree();
      return;
    }
    setCwd({ type: 'root' });
    setEntries([]);
    resetTree();
  }, [isStudy, normalizedDomain]);

  useEffect(() => {
    if (cwd.type === 'project' || cwd.type === 'local') refreshEntries().catch(console.error);
    if (cwd.type === 'root') setEntries([]);
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath]);

  useEffect(() => {
    if (cwd.type !== 'project') return;
    refreshGhosts().catch(() => {});
    // Close overview when navigating away from project root
    if (cwd.relPath) {
      setOverviewOpen(false);
      setOverviewExpanded({});
    }
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath]);

  useResumeRefresh({ normalizedDomain, cwd, refreshProjects, refreshEntries, refreshGhosts });

  const lastNavTs = useRef(0);
  useEffect(() => {
    if (!searchNavTarget || !searchNavTarget._ts) return;
    if (searchNavTarget._ts === lastNavTs.current) return;
    lastNavTs.current = searchNavTarget._ts;

    const { projectName, relPath, kind } = searchNavTarget;

    const targetDir = kind === 'dir' ? relPath : (relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '');

    if (isStudy) {
      setCwd({ type: 'project', name: '', relPath: targetDir });
    } else if (projectName) {
      entityApi?.setCurrent?.(projectName).catch(() => {});
      setCurrentProject?.(projectName);
      setCwd({ type: 'project', name: projectName, relPath: targetDir });
    }
    onSearchNavDone?.();
  }, [searchNavTarget, isStudy, entityApi, setCurrentProject, setCwd, onSearchNavDone]);

  useEffect(() => {
    if (!filterPersistent) {
      setFileFilters([]);
    }
  }, [filterPersistent, normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath]);

  const {
    dragOverFolderRelPath,
    onDragStartEntry,
    onDragEndAny,
    onDropOnFolder,
    onDragOverFolder,
    onDragLeaveFolder,
  } = useDragDrop({
    cwd,
    domainOpts,
    viewMode,
    refreshEntries,
    refreshTreeDir,
    setNotice,
  });

  // NOTE: hooks below MUST stay above the `knowledgeCtx` / `preferencesCtx`
  // early-return branches. Returning early from a function component before
  // hooks are declared violates the Rules of Hooks and triggers
  // "Rendered fewer hooks than expected" — which black-screens the entire
  // app because there is no ErrorBoundary above ProjectManager. Putting
  // these here also keeps the drag-drop wiring identical regardless of
  // which sub-page is shown, which is what we want anyway.
  const inProject = cwd.type === 'project';

  /* ── Invisible page-level drag-drop upload ── */
  const [pageDragOver, setPageDragOver] = useState(false);
  const pageDragCounter = useRef(0);

  const handlePageDragEnter = useCallback((e) => {
    if (!inProject || isRoot) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    pageDragCounter.current += 1;
    if (pageDragCounter.current === 1) setPageDragOver(true);
  }, [inProject, isRoot]);

  const handlePageDragOver = useCallback((e) => {
    if (!inProject || isRoot) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [inProject, isRoot]);

  const handlePageDragLeave = useCallback((e) => {
    e.preventDefault();
    pageDragCounter.current -= 1;
    if (pageDragCounter.current <= 0) {
      pageDragCounter.current = 0;
      setPageDragOver(false);
    }
  }, []);

  const handlePageDrop = useCallback((e) => {
    e.preventDefault();
    pageDragCounter.current = 0;
    setPageDragOver(false);
    if (!inProject || isRoot) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const paths = Array.from(files)
      .map((f) => window.ipm?.files?.getPathForFile?.(f) || f.path || '')
      .filter(Boolean);
    if (paths.length) dropUploadFiles(paths);
  }, [inProject, isRoot, dropUploadFiles]);

  // Knowledge management page
  if (knowledgeCtx) {
    return (
      <KnowledgePage
        projectName={knowledgeCtx.name}
        domain={normalizedDomain}
        onBack={() => setKnowledgeCtx(null)}
        isAttached={Boolean(knowledgeCtx.attached)}
        externalRootPath={knowledgeCtx.externalRootPath || ''}
      />
    );
  }
  if (preferencesCtx) {
    return (
      <PreferencesPage
        projectName={preferencesCtx.name}
        domain={normalizedDomain}
        onBack={() => setPreferencesCtx(null)}
        isAttached={Boolean(preferencesCtx.attached)}
        externalRootPath={preferencesCtx.externalRootPath || ''}
      />
    );
  }

  return (
    <div
      className="flex-1 flex h-full bg-[#f8f9fb] relative"
      onClick={closeMenu}
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
    {pageDragOver && inProject && !isRoot && (
      <div className="absolute inset-0 z-40 pointer-events-none rounded-lg" style={{ border: '2px dashed rgba(62,75,156,0.35)', background: 'rgba(62,75,156,0.03)' }} />
    )}
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* Hidden file input for “Upload & AI classify” (Electron gives file.path) */}
      <input
        ref={aiUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const arr = Array.from(e.target.files || []);
          // reset so selecting same file twice still triggers change
          e.target.value = '';
          void uploadFilesAndAiClassify(arr);
        }}
      />
      <HeaderBar
        title={headerTitle}
        subtitle={headerSubtitle}
        breadcrumbs={breadcrumbs}
        onNavigateBreadcrumb={handleNavigateBreadcrumb}
        showBackHome={typeof onBackHome === 'function'}
        onBackHome={onBackHome}
        showGoRoot={cwd.type === 'project' && !cwd.relPath && !isStudy}
        onGoRoot={goRoot}
        viewMode={viewMode}
        onSetViewMode={setViewModeSafe}
        isRoot={isRoot}
        showGoParent={!isRoot && Boolean(cwd.relPath)}
        onGoParent={goParent}
        filterTypes={fileFilters}
        filterOptions={fileFilterOptions}
        filterPersistent={filterPersistent}
        onSetFilterTypes={setFileFilters}
        onSetFilterPersistent={setFilterPersistent}
        onClearFilter={() => setFileFilters([])}
        onImportLocalFolder={importLocalFolder}
        pendingGhostCount={pendingGhostsInCwd.length}
        onAcceptAllGhostsHere={acceptAllGhostsHere}
        onRejectAllGhostsHere={rejectAllGhostsHere}
        onOpenNewFolder={openNewFolder}
        onUploadFiles={uploadFiles}
        onPickFilesAndAiClassify={pickFilesAndAiClassify}
        aiUploadRunning={aiUpload.running}
        allowAiUpload={cwd.type === 'project'}
        showCreateProject={isRoot}
        newProjectName={newProjectName}
        onNewProjectNameChange={setNewProjectName}
        onCreateProject={createProject}
        newProjectInputRef={newProjectInputRef}
        goRootLabel={entityLabelAll}
        createLabel={entityLabel}
        showAgentChat={false}
        projectName={cwd.type === 'project' ? cwd.name : ''}
        domain={normalizedDomain}
        onNavigateToResult={(item) => {
          if (!item) return;
          const targetDir = item.kind === 'dir'
            ? item.relPath
            : (item.relPath.includes('/') ? item.relPath.slice(0, item.relPath.lastIndexOf('/')) : '');
          setCwd({ ...cwd, relPath: targetDir });
        }}
        isAttachedProject={isAttachedCwd}
        isAttachedBroken={isAttachedBroken}
        onRefreshAttached={handleRefreshAttached}
        onRelocateAttached={handleRelocateAttached}
        showCloudPublish={cwd.type === 'project' && !cwd.relPath && !isStudy && !isAttachedCwd}
        cloudPublishing={cwd.type === 'project' ? cloudLockedNames.has(cwd.name) : false}
        cloudBound={cwd.type === 'project' ? Boolean(cloudBindings[cwd.name]?.bound) : false}
        cloudVersionNumber={cwd.type === 'project' ? (cloudBindings[cwd.name]?.versionNumber ?? null) : null}
        onPublishCurrent={() => { if (cwd.type === 'project' && cwd.name) handlePublishProject(cwd.name); }}
      />

      {/* C5: sync banner for a bound project (push/pull/milestone) */}
      {cwd.type === 'project' && !isStudy && !isAttachedCwd && cloudBindings[cwd.name]?.bound && (
        <SyncStatusBar
          projectName={cwd.name}
          domain={normalizedDomain}
          onAfterSync={() => { void fetchBinding(cwd.name); void refreshEntries?.(); }}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto" onContextMenu={handleBlankContextMenu}>
        <AIGhostOverview
          show={!isRoot && (showOverviewBar || pipelineState.isActive)}
          overviewOpen={overviewOpen}
          pendingGhostCount={pendingGhostCount}
          pendingGhostFolderCount={pendingGhostFolderCount}
          ghostLoading={ghostLoading}
          pendingGhostGroups={pendingGhostGroups}
          overviewExpanded={overviewExpanded}
          onToggleOverview={() => setOverviewOpen((v) => !v)}
          onToggleGroup={(folderRelPath) => setOverviewExpanded((m) => ({ ...m, [folderRelPath]: !m[folderRelPath] }))}
          onAcceptAll={acceptAllGhostsProject}
          onRejectAll={rejectAllGhostsProject}
          onAcceptGroup={acceptGroup}
          onRejectGroup={rejectGroup}
          onEnterFolder={(folderRelPath) => setCwd({ ...cwd, relPath: folderRelPath })}
          onAcceptItem={acceptGhost}
          onRejectItem={rejectGhost}
          onViewTrace={openTrace}
          pipelineQueued={pipelineState.queued}
          pipelineClassifying={pipelineState.classifying}
        />

        {isRoot ? (
          <RootTable
            errorText={errorText}
            localFolders={localFolders}
            projects={projects}
            entityLabel={entityLabel}
            cloudBindings={cloudBindings}
            cloudLockedNames={cloudLockedNames}
            onEnterLocalFolder={enterLocalFolder}
            onContextMenuLocalFolder={handleRowContextMenuLocalFolder}
            onEnterProject={enterProject}
            onContextMenuProject={handleRowContextMenuRoot}
            rowStyleByStatus={rowStyleByStatus}
            projectStatuses={PROJECT_STATUSES}
            statusLabel={statusLabel}
            badgeByStatus={badgeByStatus}
            onSetProjectStatus={setProjectStatus}
            onOpenKnowledge={(p) => setKnowledgeCtx({
              name: p.name,
              path: p.path,
              attached: Boolean(p.attached),
              externalRootPath: p.externalRootPath || '',
            })}
            onOpenPreferences={(p) => setPreferencesCtx({
              name: p.name,
              path: p.path,
              attached: Boolean(p.attached),
              externalRootPath: p.externalRootPath || '',
            })}
          />
        ) : (
          <EntryTable
            errorText={errorText}
            viewMode={viewMode}
            loading={loading}
            entries={entries}
            pendingGhostsInCwd={pendingGhostsInCwd}
            cwd={cwd}
            dragOverFolderRelPath={dragOverFolderRelPath}
            onContextMenuEntry={handleRowContextMenuEntry}
            onEnterDir={enterRelDir}
                  onOpenFile={openFileByRelPath}
            onAcceptGhost={acceptGhost}
            onRejectGhost={rejectGhost}
            onViewTrace={openTrace}
                  onDragStartEntry={onDragStartEntry}
                  onDragEndAny={onDragEndAny}
                  onDragOverFolder={onDragOverFolder}
                  onDragLeaveFolder={onDragLeaveFolder}
            onDropOnFolder={onDropOnFolder}
            onOpenFolderDetail={openFolderDetail}
            fmtTime={fmtTime}
            fmtBytes={fmtBytes}
            folderDecor={folderDecor}
            fileDecor={fileDecor}
            fileFilter={isRoot ? [] : fileFilters}
            fileFilterExts={fileFilterExts}
            onBlankContextMenu={handleBlankContextMenu}
            tree={tree}
            onToggleTree={toggleTreeDir}
            onLoadTree={ensureTreeNode}
          />
        )}
      </div>

      {/* Folder Detail Overlay (covers main area; click outside to close) */}
      <FolderDetailPanel
        open={detailOpen}
        visible={detailVisible}
        loading={detailLoading}
        detail={detail}
        descEditing={descEditing}
        descDraft={descDraft}
        descSaving={descSaving}
        onClose={closeFolderDetail}
        onEdit={() => setDescEditing(true)}
        onCancelEdit={() => {
                            const d = detail?.folderMeta?.description;
                            setDescDraft(typeof d === 'string' ? d : '');
                            setDescEditing(false);
                          }}
        onSave={saveFolderDescription}
        onDraftChange={setDescDraft}
        fmtTime={fmtTime}
      />

      {/* New folder modal */}
      {newFolderOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setNewFolderOpen(false)}>
          <div className="w-[420px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-2">新建文件夹</div>
            <div className="text-xs text-slate-500 mb-3">
              将在目录创建：{cwd.type === 'project' ? `${cwd.name}${newFolderBaseRelPath ? `/${newFolderBaseRelPath}` : ''}` : '-'}
            </div>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder();
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-track="pm-new-folder-cancel"
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded"
                onClick={() => setNewFolderOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                data-track="pm-new-folder-submit"
                className="px-3 py-2 text-sm bg-[#3e4b9c] text-white rounded hover:bg-[#4e5bab]"
                onClick={createFolder}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rename modal */}
      {renameOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setRenameOpen(false)}>
          <div className="w-[420px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-2">重命名</div>
            <div className="text-xs text-slate-500 mb-3">原名称：{renameOldName}</div>
            <input
              value={renameNewName}
              onChange={(e) => setRenameNewName(e.target.value)}
              placeholder="新名称"
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') doRename();
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-track="pm-rename-cancel"
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded"
                onClick={() => setRenameOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                data-track="pm-rename-submit"
                className="px-3 py-2 text-sm bg-[#3e4b9c] text-white rounded hover:bg-[#4e5bab]"
                onClick={doRename}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* W1: 模板选择弹窗 — 新建项目/案件时让用户选「四类模板」或「空白」 */}
      {templatePickerOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30"
          onClick={() => setTemplatePickerOpen(false)}
        >
          <div
            className="w-[520px] bg-white rounded-xl border border-slate-200 shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-slate-800 mb-1">为「{newProjectName}」选择初始结构</div>
            <div className="text-xs text-slate-500 mb-4">创建后可随时增删/重命名文件夹（系统目录除外）。</div>
            <div className="grid grid-cols-2 gap-3 items-stretch">
              <button
                type="button"
                data-track="pm-template-default"
                className="flex flex-col items-start text-left h-full min-h-[148px] p-4 rounded-lg border border-slate-200 hover:border-[#3e4b9c] hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3e4b9c]/30"
                onClick={async () => {
                  setTemplatePickerOpen(false);
                  await createProjectWithTemplate('default');
                }}
              >
                <div className="text-sm font-semibold text-slate-800 mb-2 shrink-0">法律{entityLabel}四类</div>
                <div className="flex-1 text-[11px] text-slate-500 leading-relaxed min-h-[2.75rem]">
                  自动创建：收到资料 / 过程文档 / 调研研究 / 交付成果。
                </div>
                <div className="text-[11px] text-slate-400 mt-2 shrink-0">推荐律所/团队首次使用。</div>
              </button>
              <button
                type="button"
                data-track="pm-template-blank"
                className="flex flex-col items-start text-left h-full min-h-[148px] p-4 rounded-lg border border-slate-200 hover:border-[#3e4b9c] hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3e4b9c]/30"
                onClick={async () => {
                  setTemplatePickerOpen(false);
                  await createProjectWithTemplate('blank');
                }}
              >
                <div className="text-sm font-semibold text-slate-800 mb-2 shrink-0">空白</div>
                <div className="flex-1 text-[11px] text-slate-500 leading-relaxed min-h-[2.75rem]">
                  仅创建系统目录（meta / temp / snippets），业务文件夹完全由你自定义。
                </div>
                <div className="text-[11px] text-slate-400 mt-2 shrink-0">适合已有自己归档体系的用户。</div>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                data-track="pm-template-cancel"
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded"
                onClick={() => setTemplatePickerOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* W3b: 项目/案件重命名两步模态 */}
      {renameWorkspaceState.open ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => renameWorkspaceState.step !== 'busy' && closeRenameWorkspace()}
        >
          <div
            className="w-[520px] bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {renameWorkspaceState.step === 'warning' && (
              <>
                <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
                  <div className="text-sm font-semibold text-amber-900">
                    重命名{entityLabel}「{renameWorkspaceState.oldName}」前请确认
                  </div>
                  <div className="text-[11px] text-amber-700 mt-1">
                    本操作会修改磁盘目录名并联动多处数据。请阅读以下风险提示。
                  </div>
                </div>
                <div className="px-5 py-4 space-y-3 text-[12.5px] text-slate-700 leading-relaxed">
                  <div>
                    <span className="font-medium text-slate-800">会自动迁移：</span>
                    项目内 <code className="text-[11px] bg-slate-100 px-1 rounded">structure.json</code> / 剪贴板与截图记录中的 projectName 字段；看板卡片的来源项目；通知、偏好分析记录；当前项目指针与状态 key；本地文件夹与悬浮窗 pin/hide 列表中以本项目目录为前缀的绝对路径。
                  </div>
                  <div>
                    <span className="font-medium text-rose-700">需要你注意的失效项：</span>
                    <ul className="list-disc list-inside space-y-1 mt-1">
                      <li>KnowClaw 历史会话中绑定的工作区路径将失效，需要 fork 新会话。</li>
                      <li>外部脚本/链接/快捷方式中硬编码的项目目录绝对路径会断裂。</li>
                      <li>本操作不能一键撤销（如需还原需要再次重命名回去）。</li>
                    </ul>
                  </div>
                  <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded px-3 py-2">
                    若有重要外部依赖建议先备份，确认无误后继续。
                  </div>
                </div>
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded"
                    onClick={closeRenameWorkspace}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="px-4 py-1.5 text-sm bg-[#3e4b9c] text-white rounded hover:bg-[#4e5bab]"
                    onClick={() => setRenameWorkspaceState((s) => ({ ...s, step: 'input', error: '' }))}
                  >
                    我已了解，继续
                  </button>
                </div>
              </>
            )}

            {renameWorkspaceState.step === 'input' && (
              <>
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="text-sm font-semibold text-slate-800">
                    重命名{entityLabel}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    原名称：<span className="text-slate-700">{renameWorkspaceState.oldName}</span>
                  </div>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">新名称</label>
                    <input
                      autoFocus
                      type="text"
                      value={renameWorkspaceState.newName}
                      onChange={(e) => setRenameWorkspaceState((s) => ({ ...s, newName: e.target.value, error: '' }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRenameWorkspace();
                        if (e.key === 'Escape') closeRenameWorkspace();
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40"
                      placeholder="输入新名称"
                    />
                  </div>
                  {renameWorkspaceState.error ? (
                    <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded px-3 py-2">
                      {renameWorkspaceState.error}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400">
                      不能包含 {'< > : " / \\ | ? *'} 等字符。
                    </div>
                  )}
                </div>
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:text-slate-700"
                    onClick={() => setRenameWorkspaceState((s) => ({ ...s, step: 'warning', error: '' }))}
                  >
                    ← 返回风险提示
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded"
                      onClick={closeRenameWorkspace}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="px-4 py-1.5 text-sm bg-[#3e4b9c] text-white rounded hover:bg-[#4e5bab] disabled:opacity-50"
                      disabled={!renameWorkspaceState.newName?.trim() || renameWorkspaceState.newName === renameWorkspaceState.oldName}
                      onClick={submitRenameWorkspace}
                    >
                      重命名
                    </button>
                  </div>
                </div>
              </>
            )}

            {renameWorkspaceState.step === 'busy' && (
              <div className="px-5 py-8 text-center text-sm text-slate-600">
                正在重命名并同步关联数据，请稍候…
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Context menu */}
      {menu ? (
        <div className="fixed inset-0 z-[70]" onClick={closeMenu} onContextMenu={(e) => e.preventDefault()}>
          <div
            className="absolute min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.items.map((it) => (
              <button
                key={it.label}
                type="button"
                disabled={it.disabled}
                data-track={pmContextMenuTrack(it.label)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  it.disabled
                    ? 'text-slate-300 cursor-default'
                    : it.danger
                      ? 'text-rose-600 hover:bg-rose-50'
                      : 'text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => {
                  if (it.disabled) return;
                  closeMenu();
                  it.onClick?.();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* AI Classify Trace Viewer */}
      <ClassifyTraceView
        open={traceOpen}
        loading={traceLoading}
        data={traceData}
        onClose={closeTrace}
      />

    </div>

    {createKnowledgeTarget && (
      <CreateKnowledgeModal
        target={createKnowledgeTarget}
        onClose={() => setCreateKnowledgeTarget(null)}
        onNavigateKnowledge={() => setKnowledgeCtx({ name: createKnowledgeTarget.projectName })}
      />
    )}
    {restoreFileTarget && (
      <FileHistoryRestoreModal
        projectName={restoreFileTarget.projectName}
        domain={restoreFileTarget.domain}
        entry={restoreFileTarget.entry}
        onClose={() => setRestoreFileTarget(null)}
        onRestored={() => {
          setNotice({ variant: 'success', message: '已恢复到本地；确认无误后可同步到云端。' });
          void refreshEntries?.();
        }}
      />
    )}
    </div>
  );
};

export default ProjectManager;



