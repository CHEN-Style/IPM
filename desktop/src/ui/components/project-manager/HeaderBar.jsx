import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  FolderPlus,
  Folders,
  Home,
  LayoutList,
  ListFilter,
  Plus,
  Sparkles,
  Upload,
} from 'lucide-react';

const HeaderBar = ({
  title,
  subtitle,
  breadcrumbs,
  onNavigateBreadcrumb,
  showBackHome,
  onBackHome,
  showGoRoot,
  onGoRoot,
  viewMode,
  onSetViewMode,
  isRoot,
  showGoParent,
  onGoParent,
  showRootPlaceholder,
  filterTypes,
  filterOptions,
  filterPersistent,
  onSetFilterTypes,
  onSetFilterPersistent,
  onClearFilter,
  onImportLocalFolder,
  pendingGhostCount,
  onAcceptAllGhostsHere,
  onRejectAllGhostsHere,
  onOpenNewFolder,
  onUploadFiles,
  onPickFilesAndAiClassify,
  aiUploadRunning,
  allowAiUpload,
  showCreateProject,
  newProjectName,
  onNewProjectNameChange,
  onCreateProject,
  newProjectInputRef,
  goRootLabel,
  createLabel,
}) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const selectedFilters = Array.isArray(filterTypes) ? filterTypes : [];
  const activeFilterLabel =
    selectedFilters.length === 1
      ? (filterOptions || []).find((opt) => opt.value === selectedFilters[0])?.label || '已选 1 项'
      : selectedFilters.length > 1
        ? `已选 ${selectedFilters.length} 项`
        : '全部类型';
  const hasActiveFilter = selectedFilters.length > 0;
  const listOptions = (filterOptions || []).filter((opt) => opt.value !== 'all');
  const isSelected = (value) => selectedFilters.includes(value);
  const toggleFilter = (value) => {
    if (value === 'all') {
      onClearFilter?.();
      return;
    }
    if (isSelected(value)) {
      onSetFilterTypes?.(selectedFilters.filter((v) => v !== value));
      return;
    }
    onSetFilterTypes?.([...selectedFilters, value]);
  };

  useEffect(() => {
    if (!filterOpen) return undefined;
    const handleClick = (evt) => {
      if (filterRef.current && !filterRef.current.contains(evt.target)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 relative">
        <div className="flex items-center gap-3 overflow-hidden w-full md:w-auto pr-16 md:pr-0">
          <div className="flex items-center gap-3 pr-3 border-r border-slate-200 mr-3 shrink-0 max-w-[70%] sm:max-w-none">
            {showBackHome ? (
              <button
                type="button"
                onClick={onBackHome}
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                title="返回我的资料"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}
            <div className="flex flex-col justify-center min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 leading-tight truncate">{title}</h1>
              <p className="text-[11px] sm:text-xs text-slate-500 truncate">{subtitle}</p>
            </div>
          </div>

          {Array.isArray(breadcrumbs) && breadcrumbs.length ? (
            <nav className="flex items-center text-sm text-slate-600 whitespace-nowrap overflow-x-auto no-scrollbar min-w-0 flex-1 md:flex-none">
              <Home className="w-4 h-4 mr-2 text-slate-400 shrink-0" />
              {breadcrumbs.map((crumb, index) => (
                <div key={crumb.id} className="flex items-center">
                  {index > 0 && <span className="mx-2 text-slate-300">/</span>}
                  <button
                    type="button"
                    onClick={() => onNavigateBreadcrumb?.(crumb)}
                    disabled={crumb.active}
                    className={`${
                      crumb.active
                        ? 'font-semibold text-slate-900'
                        : 'text-slate-600 hover:text-blue-600'
                    } transition-colors`}
                    title={crumb.label}
                  >
                    {crumb.label}
                  </button>
                </div>
              ))}
            </nav>
          ) : null}
        </div>

        <div className="flex items-center gap-1 md:hidden absolute top-4 right-4 bg-white pl-2">
          <button
            type="button"
            onClick={() => onSetViewMode?.('list')}
            className={`h-8 w-8 rounded-md transition-all ${
              viewMode === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
            title="列表视图"
          >
            <LayoutList size={16} />
          </button>
          <button
            type="button"
            onClick={() => onSetViewMode?.('explorer')}
            className={`h-8 w-8 rounded-md transition-all ${
              viewMode === 'explorer' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
            title="Explorer 视图"
          >
            <Folders size={16} />
          </button>
        </div>
      </div>

      <div className="px-6 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {showGoParent ? (
            <button
              type="button"
              onClick={onGoParent}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
              title="返回上一级"
            >
              <ArrowLeft size={14} /> 上一级
            </button>
          ) : null}
          {showRootPlaceholder ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-100 text-slate-500 border border-slate-200 text-sm cursor-default"
              title="AI分析（占位）"
            >
              <Sparkles size={14} /> AI分析
            </button>
          ) : null}
          {showGoRoot ? (
            <button
              type="button"
              onClick={onGoRoot}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
              title={`返回${goRootLabel}`}
            >
              <ArrowLeft size={14} /> 返回{goRootLabel}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden md:flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => onSetViewMode?.('list')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="列表视图"
            >
              <LayoutList size={16} />
            </button>
            <button
              type="button"
              onClick={() => onSetViewMode?.('explorer')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'explorer' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Explorer 视图"
            >
              <Folders size={16} />
            </button>
          </div>

          <div className="relative" ref={filterRef}>
            <button
              type="button"
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border transition-colors text-sm ${
                hasActiveFilter
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="筛选文件类型"
              onClick={() => setFilterOpen((v) => !v)}
            >
              <ListFilter size={14} />
              <span>筛选</span>
              {hasActiveFilter ? (
                <span className="text-xs text-slate-500">· {activeFilterLabel}</span>
              ) : null}
            </button>
            {filterOpen ? (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-xl z-20">
                <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                  <div className="text-xs text-slate-500 font-semibold tracking-widest">文件类型筛选</div>
                  <div className="text-[11px] text-slate-400 mt-1">可多选，勾选后即时生效</div>
                </div>
                <div className="py-2 max-h-72 overflow-auto">
                  <button
                    type="button"
                    onClick={() => {
                      onClearFilter?.();
                      setFilterOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    全部类型
                  </button>
                  <div className="px-2 py-1">
                    <div className="h-px bg-slate-100" />
                  </div>
                  {listOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleFilter(opt.value)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md hover:bg-slate-50 flex items-center justify-between ${
                        isSelected(opt.value) ? 'text-slate-900 font-medium bg-slate-50' : 'text-slate-600'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {isSelected(opt.value) ? <Check size={14} className="text-emerald-600" /> : null}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 px-3 py-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(filterPersistent)}
                      onChange={(e) => onSetFilterPersistent?.(e.target.checked)}
                    />
                    持久生效
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      onClearFilter?.();
                      setFilterOpen(false);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    清空选择
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="w-px h-8 bg-slate-200 mx-1 hidden sm:block"></div>

          {isRoot ? (
            <>
              <button
                type="button"
                onClick={onImportLocalFolder}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition-colors text-sm"
                title="导入一个本地文件夹（仅用于浏览/基础文件操作）"
              >
                导入本地
              </button>
              {showCreateProject ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={newProjectInputRef}
                    value={newProjectName}
                    onChange={(e) => onNewProjectNameChange?.(e.target.value)}
                    placeholder={`输入${createLabel}名`}
                    className="h-9 px-3 border border-slate-200 rounded-lg text-sm text-slate-700 w-48 focus:outline-none focus:border-slate-400"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCreateProject?.();
                    }}
                  />
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors text-sm shadow-sm"
                  >
                    <Plus size={14} /> 新建{createLabel}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {pendingGhostCount ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onAcceptAllGhostsHere}
                    className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-2"
                    title="接受本目录所有 AI 建议并移动"
                  >
                    <Check size={14} /> 接受全部（{pendingGhostCount}）
                  </button>
                  <button
                    type="button"
                    onClick={onRejectAllGhostsHere}
                    className="h-9 px-3 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors inline-flex items-center gap-2"
                    title="放弃本目录所有 AI 建议"
                  >
                    <Ban size={14} /> 放弃全部
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={onOpenNewFolder}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
              >
                <FolderPlus size={14} /> 新建文件夹
              </button>
              <button
                type="button"
                onClick={onUploadFiles}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors text-sm shadow-sm"
                disabled={aiUploadRunning}
              >
                <Upload size={14} /> 上传文件
              </button>
              <button
                type="button"
                onClick={onPickFilesAndAiClassify}
                disabled={aiUploadRunning || !allowAiUpload}
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                  aiUploadRunning || !allowAiUpload
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700'
                }`}
                title="选择一个或多个文件，逐个放入 temp，并逐个触发 AI 分类推荐"
              >
                <Sparkles size={14} /> {aiUploadRunning ? '上传并AI分类…' : '上传并AI分类'}
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default HeaderBar;


