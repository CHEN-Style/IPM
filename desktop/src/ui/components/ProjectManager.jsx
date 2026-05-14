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
import { useToast } from '../hooks/useToast.js';
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

  const { localFolders, refreshLocalFolders, importLocalFolder, removeLocalFolder } = useLocalFolders({ normalizedDomain, setNotice });
  const {
    newProjectName,
    setNewProjectName,
    enterProject,
    enterLocalFolder,
    goRoot,
    createProject,
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
      setCreateKnowledgeTarget({ entry, projectName: projName, domain: normalizedDomain });
    },
  });
  const title = useMemo(() => {
    if (isRoot) return entityLabelAll;
    if (isProjectCwd) return cwd.name || entityLabel;
    if (isLocalCwd) return '本地文件夹';
    return `${entityLabel}文件`;
  }, [isRoot, isProjectCwd, isLocalCwd, cwd, entityLabelAll, entityLabel]);
  const headerTitle = useMemo(() => {
    if (isStudy) {
      return `学习${cwd.type === 'project' && cwd.relPath ? ` / ${cwd.relPath}` : ''}`;
    }
    if (isRoot) return entityLabelAll;
    if (isLocalCwd) {
      return `本地文件夹：${String(cwd.rootPath || '').split(/[/\\]+/).filter(Boolean).slice(-1)[0] || String(cwd.rootPath || '')}`;
    }
    return `${entityLabel}文件：${title}`;
  }, [isStudy, isRoot, isLocalCwd, cwd, entityLabelAll, entityLabel, title]);
  const headerSubtitle = useMemo(() => {
    if (isStudy) {
      return `路径：userfile/study${cwd.type === 'project' && cwd.relPath ? ` / ${cwd.relPath}` : ''}`;
    }
    if (isRoot) return `共 ${projects.length} 个${entityLabel}`;
    if (isLocalCwd) {
      return `路径：${cwd.rootPath || ''}${cwd.relPath ? ` / ${cwd.relPath}` : ''}`;
    }
    return `当前${entityLabel}：${cwd.name}${cwd.relPath ? ` / ${cwd.relPath}` : ''}`;
  }, [isStudy, isRoot, isLocalCwd, cwd, projects.length, entityLabel]);
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
  // Knowledge management page
  if (knowledgeCtx) {
    return (
      <KnowledgePage
        projectName={knowledgeCtx.name}
        domain={normalizedDomain}
        onBack={() => setKnowledgeCtx(null)}
      />
    );
  }
  if (preferencesCtx) {
    return (
      <PreferencesPage
        projectName={preferencesCtx.name}
        domain={normalizedDomain}
        onBack={() => setPreferencesCtx(null)}
      />
    );
  }

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
      />

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
            onEnterLocalFolder={enterLocalFolder}
            onContextMenuLocalFolder={handleRowContextMenuLocalFolder}
            onEnterProject={enterProject}
            onContextMenuProject={handleRowContextMenuRoot}
            rowStyleByStatus={rowStyleByStatus}
            projectStatuses={PROJECT_STATUSES}
            statusLabel={statusLabel}
            badgeByStatus={badgeByStatus}
            onSetProjectStatus={setProjectStatus}
            onOpenKnowledge={(p) => setKnowledgeCtx({ name: p.name, path: p.path })}
            onOpenPreferences={(p) => setPreferencesCtx({ name: p.name, path: p.path })}
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
                data-track={pmContextMenuTrack(it.label)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                  it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700'
                }`}
                onClick={() => {
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
    </div>
  );
};

export default ProjectManager;



