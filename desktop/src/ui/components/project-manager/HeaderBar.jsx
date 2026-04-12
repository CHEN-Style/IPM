import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  File,
  Folder,
  FolderPlus,
  Folders,
  Home,
  LayoutList,
  ListFilter,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
  CornerDownLeft,
} from 'lucide-react';

const DEBOUNCE_MS = 280;

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
  showAgentChat,
  projectName,
  domain,
  onNavigateToResult,
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

  const [pq, setPq] = useState('');
  const [pResults, setPResults] = useState([]);
  const [pLoading, setPLoading] = useState(false);
  const [pTruncated, setPTruncated] = useState(false);
  const [pIdx, setPIdx] = useState(0);
  const [pFocused, setPFocused] = useState(false);
  const pInputRef = useRef(null);
  const pDebRef = useRef(null);
  const pWrapRef = useRef(null);
  const pListRef = useRef(null);

  const pOpen = pFocused && pq.trim().length > 0;

  const doProjectSearch = useCallback(async (q) => {
    const trimmed = q.trim();
    if (!trimmed) { setPResults([]); setPTruncated(false); setPLoading(false); return; }
    setPLoading(true);
    try {
      const res = await window.ipm?.search?.project?.(projectName || '', domain || 'projects', trimmed);
      if (res?.ok) { setPResults(res.results || []); setPTruncated(!!res.truncated); }
    } catch { setPResults([]); }
    finally { setPLoading(false); }
  }, [projectName, domain]);

  const handlePInput = useCallback((e) => {
    const val = e.target.value;
    setPq(val);
    setPIdx(0);
    if (pDebRef.current) clearTimeout(pDebRef.current);
    pDebRef.current = setTimeout(() => doProjectSearch(val), DEBOUNCE_MS);
  }, [doProjectSearch]);

  const clearPSearch = useCallback(() => {
    setPq(''); setPResults([]); setPTruncated(false); setPIdx(0);
  }, []);

  const selectPResult = useCallback((item) => {
    onNavigateToResult?.(item);
    clearPSearch();
    setPFocused(false);
    pInputRef.current?.blur();
  }, [onNavigateToResult, clearPSearch]);

  const handlePKeyDown = useCallback((e) => {
    if (!pOpen) return;
    if (e.key === 'Escape') { clearPSearch(); pInputRef.current?.blur(); setPFocused(false); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setPIdx((i) => Math.min(i + 1, pResults.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setPIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && pResults.length > 0) { e.preventDefault(); selectPResult(pResults[pIdx]); }
  }, [pOpen, pResults, pIdx, selectPResult, clearPSearch]);

  useEffect(() => () => { if (pDebRef.current) clearTimeout(pDebRef.current); }, []);
  useEffect(() => { clearPSearch(); }, [projectName, domain]);

  useEffect(() => {
    if (!pFocused) return;
    const onClick = (e) => { if (pWrapRef.current && !pWrapRef.current.contains(e.target)) setPFocused(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [pFocused]);

  useEffect(() => {
    const el = pListRef.current?.children?.[pIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [pIdx]);

  return (
    <header className="bg-white border-b border-[#e2e4eb] sticky top-0 z-10">
      <div className="px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 relative">
        <div className="flex items-center gap-3 overflow-hidden w-full md:w-auto pr-16 md:pr-0">
          <div className="flex items-center gap-2 sm:gap-3 pr-3 border-r border-slate-200 mr-2 sm:mr-3 shrink-0 max-w-[60%] sm:max-w-[70%] md:max-w-none">
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
                        : 'text-slate-600 hover:text-[#3e4b9c]'
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

      <div className="px-4 sm:px-6 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2 min-w-0">
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

          {/* In-project search */}
          {!isRoot && (
            <div className="relative" ref={pWrapRef}>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" size={13} style={{ color: pFocused ? '#64748b' : '#94a3b8' }} />
                <input
                  ref={pInputRef}
                  type="text"
                  value={pq}
                  onChange={handlePInput}
                  onFocus={() => setPFocused(true)}
                  onKeyDown={handlePKeyDown}
                  placeholder="搜索文件..."
                  className="h-9 w-32 sm:w-44 pl-8 pr-7 rounded-lg border text-sm transition-all focus:outline-none focus:w-48 sm:focus:w-56"
                  style={{
                    background: pFocused ? '#fff' : '#f8f9fb',
                    borderColor: pFocused ? '#3e4b9c66' : '#e2e4eb',
                    color: '#334155',
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                {pq ? (
                  <button type="button" onClick={() => { clearPSearch(); pInputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 transition-colors">
                    <X size={12} style={{ color: '#94a3b8' }} />
                  </button>
                ) : null}
              </div>

              {pOpen && (
                <div className="absolute left-0 mt-1 w-80 rounded-xl shadow-xl overflow-hidden z-50" style={{ background: '#fff', border: '1px solid #e2e4eb' }}>
                  <div className="overflow-y-auto" style={{ maxHeight: '52vh' }} ref={pListRef}>
                    {pLoading && pResults.length === 0 && (
                      <div className="px-3 py-5 text-center text-[12px] text-slate-400">
                        <div className="inline-block w-3.5 h-3.5 border-[1.5px] border-slate-200 border-t-[#3e4b9c] rounded-full animate-spin" />
                        <span className="ml-1.5">搜索中...</span>
                      </div>
                    )}
                    {!pLoading && pq.trim() && pResults.length === 0 && (
                      <div className="px-3 py-5 text-center text-[12px] text-slate-400">没有找到匹配结果</div>
                    )}
                    {pResults.map((item, idx) => {
                      const active = idx === pIdx;
                      return (
                        <div
                          key={`${item.relPath}-${idx}`}
                          className="flex items-center gap-2.5 px-3 py-[7px] cursor-pointer transition-colors"
                          style={{ background: active ? '#f0f2f8' : 'transparent' }}
                          onMouseEnter={() => setPIdx(idx)}
                          onClick={() => selectPResult(item)}
                        >
                          <div className="shrink-0 w-6 h-6 rounded flex items-center justify-center" style={{ background: active ? '#e4e7f0' : '#f3f4f7' }}>
                            {item.kind === 'dir' ? <Folder size={12} className="text-slate-400" /> : <File size={12} className="text-slate-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium text-slate-800 truncate">{item.name}</div>
                            {item.parentPath && <div className="text-[10px] text-slate-400 truncate">{item.parentPath}/</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {pResults.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-1.5" style={{ borderTop: '1px solid #eef0f4', background: '#fafbfc' }}>
                      <span className="text-[10px] text-slate-400">{pTruncated ? `${pResults.length}+` : pResults.length} 条结果</span>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1"><CornerDownLeft size={8} /> 打开</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
                  ? 'bg-[#eceef7] text-[#3e4b9c] border-[#d8dbed]'
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
                      {isSelected(opt.value) ? <Check size={14} className="text-[#3e4b9c]" /> : null}
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
                disabled
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-100 text-slate-400 border border-slate-200 text-sm cursor-not-allowed"
                title="正在开发中"
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
                    className="h-9 px-3 border border-slate-200 rounded-lg text-sm text-slate-700 w-28 sm:w-48 focus:outline-none focus:border-slate-400"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCreateProject?.();
                    }}
                    data-tour="input-project-name"
                  />
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] transition-colors text-sm shadow-sm"
                    data-tour="btn-create-confirm"
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
                className="inline-flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-sm whitespace-nowrap"
                title="新建文件夹"
              >
                <FolderPlus size={14} /> <span className="hidden sm:inline">新建文件夹</span>
              </button>
              <button
                type="button"
                onClick={onUploadFiles}
                className="inline-flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors text-sm shadow-sm whitespace-nowrap"
                disabled={aiUploadRunning}
                data-tour="btn-upload"
                title="上传文件"
              >
                <Upload size={14} /> <span className="hidden sm:inline">上传文件</span>
              </button>
              <button
                type="button"
                onClick={onPickFilesAndAiClassify}
                disabled={aiUploadRunning || !allowAiUpload}
                className={`inline-flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-lg text-sm font-medium transition-colors shadow-sm whitespace-nowrap ${
                  aiUploadRunning || !allowAiUpload
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-[#3e4b9c] text-white hover:bg-[#4e5bab]'
                }`}
                title="选择一个或多个文件，逐个放入 temp，并逐个触发 AI 分类推荐"
                data-tour="btn-ai-upload"
              >
                <Sparkles size={14} /> <span className="hidden sm:inline">{aiUploadRunning ? '上传并AI分类…' : '上传并AI分类'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default HeaderBar;


