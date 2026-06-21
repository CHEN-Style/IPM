import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronLeft,
  File,
  Folder,
  FolderPlus,
  Home,
  PanelLeftOpen,
  PanelLeftClose,
  ListFilter,
  Plus,
  Search,
  RefreshCw,
  Sparkles,
  Upload,
  X,
  CornerDownLeft,
  CloudUpload,
  Loader2,
  PanelRightOpen,
  PanelRightClose,
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
  navPaneOpen,
  onToggleNavPane,
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
  // F1: 附属壳（外部导入项目）专属操作
  isAttachedProject,
  isAttachedBroken,
  onRefreshAttached,
  onRelocateAttached,
  // H4.5: 云端状态 chip（替代原「云端 vN」徽标 + 「发布到云端」按钮）。
  // cloudChip = { key, tone: 'green'|'indigo'|'amber'|'red'|'slate', text, spin? }
  showCloudPublish,
  cloudChip,
  cloudPanelOpen,
  onCloudChipClick,
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
      {/* Row 1: Title + breadcrumbs */}
      {/* W4: 进入工作区后只显示面包屑；title/subtitle 均为空时隐藏左侧标题块与分隔线，
          仅保留返回按钮与面包屑，把空间让给路径表达。 */}
      <div className="px-4 sm:px-6 pt-4 pb-2 flex items-center gap-3 min-w-0">
        {(showBackHome || title || subtitle) && (
          <div className={`flex items-center gap-3 shrink-0 ${(title || subtitle) ? 'pr-3 border-r border-slate-200 mr-3' : 'mr-1'}`}>
            {showBackHome && (
              <button
                type="button"
                onClick={onBackHome}
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
                title="返回我的资料"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            {(title || subtitle) && (
              <div className="flex flex-col justify-center min-w-0">
                {title && (
                  <h1 className="text-base font-semibold text-slate-900 leading-tight truncate">{title}</h1>
                )}
                {subtitle && (
                  <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>
                )}
              </div>
            )}
          </div>
        )}

        {Array.isArray(breadcrumbs) && breadcrumbs.length > 0 && (
          <nav className="flex items-center text-[13px] text-slate-600 whitespace-nowrap overflow-x-auto no-scrollbar min-w-0">
            <Home className="w-4 h-4 mr-2 text-slate-400 shrink-0" />
            {breadcrumbs.map((crumb, index) => (
              <div key={crumb.id} className="flex items-center shrink-0">
                {index > 0 && <span className="mx-2 text-slate-300">/</span>}
                <button
                  type="button"
                  onClick={() => onNavigateBreadcrumb?.(crumb)}
                  disabled={crumb.active}
                  className={`${crumb.active ? 'font-semibold text-slate-900 text-[14px]' : 'text-slate-600 hover:text-[#3e4b9c]'} transition-colors truncate max-w-[160px]`}
                  title={crumb.label}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </nav>
        )}
      </div>

      {/* Row 2: Action bar. flex-wrap + gap-y keeps the buttons readable when
          they wrap onto multiple lines on a narrow window. */}
      <div className="px-4 sm:px-6 pb-3 flex items-center gap-2 gap-y-2 flex-wrap">
        {/* Left group: navigation + search */}
        {showGoParent && (
          <button
            type="button"
            onClick={onGoParent}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-xs whitespace-nowrap shrink-0"
            title="返回上一级"
          >
            <ArrowLeft size={13} /> 上一级
          </button>
        )}
        {showGoRoot && (
          <button
            type="button"
            onClick={onGoRoot}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-xs whitespace-nowrap shrink-0"
            title={`返回${goRootLabel}`}
          >
            <ArrowLeft size={13} /> {goRootLabel}
          </button>
        )}

        {/* In-project search. Shrinkable so it never forces the action row to
            overflow; it still grows on focus when there is room. */}
        {!isRoot && (
          <div className="relative shrink min-w-[120px] max-w-[200px]" ref={pWrapRef}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" size={12} style={{ color: pFocused ? '#64748b' : '#94a3b8' }} />
              <input
                ref={pInputRef}
                type="text"
                value={pq}
                onChange={handlePInput}
                onFocus={() => setPFocused(true)}
                onKeyDown={handlePKeyDown}
                placeholder="搜索文件..."
                className="h-8 w-full sm:w-36 sm:focus:w-48 pl-7 pr-6 rounded-lg border text-xs transition-all focus:outline-none"
                style={{
                  background: pFocused ? '#fff' : '#f8f9fb',
                  borderColor: pFocused ? '#3e4b9c66' : '#e2e4eb',
                  color: '#334155',
                }}
                autoComplete="off"
                spellCheck={false}
              />
              {pq && (
                <button type="button" onClick={() => { clearPSearch(); pInputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 transition-colors">
                  <X size={11} style={{ color: '#94a3b8' }} />
                </button>
              )}
            </div>

            {pOpen && (
              <div className="absolute left-0 mt-1 w-80 max-w-[calc(100vw-32px)] rounded-xl shadow-xl overflow-hidden z-50" style={{ background: '#fff', border: '1px solid #e2e4eb' }}>
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

        {/* Spacer to push right group */}
        <div className="flex-1" />

        {/* Right group: nav-pane toggle (file-browser style), filter, actions.
            The toggle only makes sense inside a workspace (the all-projects
            root has no folder tree). */}
        {!isRoot && (
          <button
            type="button"
            onClick={() => onToggleNavPane?.()}
            className={`p-1.5 rounded-lg border transition-all shrink-0 ${
              navPaneOpen
                ? 'bg-white border-slate-200 text-[#3e4b9c] shadow-sm'
                : 'bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-700'
            }`}
            title={navPaneOpen ? '隐藏导航窗格' : '显示导航窗格'}
          >
            {navPaneOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
        )}

        <div className="relative shrink-0" ref={filterRef}>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border transition-colors text-xs whitespace-nowrap ${
              hasActiveFilter
                ? 'bg-[#eceef7] text-[#3e4b9c] border-[#d8dbed]'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
            title="筛选文件类型"
            onClick={() => setFilterOpen((v) => !v)}
          >
            <ListFilter size={13} />
            <span>筛选</span>
            {hasActiveFilter && <span className="text-[10px] text-slate-500">· {activeFilterLabel}</span>}
          </button>
          {filterOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-xl z-20">
              <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                <div className="text-xs text-slate-500 font-semibold tracking-widest">文件类型筛选</div>
                <div className="text-[11px] text-slate-400 mt-1">可多选，勾选后即时生效</div>
              </div>
              <div className="py-2 max-h-72 overflow-auto">
                <button
                  type="button"
                  onClick={() => { onClearFilter?.(); setFilterOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  全部类型
                </button>
                <div className="px-2 py-1"><div className="h-px bg-slate-100" /></div>
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
                    {isSelected(opt.value) && <Check size={14} className="text-[#3e4b9c]" />}
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
                  onClick={() => { onClearFilter?.(); setFilterOpen(false); }}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  清空选择
                </button>
              </div>
            </div>
          )}
        </div>

        {isRoot ? (
          <>
            <button
              type="button"
              onClick={() => onImportLocalFolder?.()}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-xs whitespace-nowrap shrink-0"
              title="将外部文件夹以「附属」形式导入：不复制文件，应用内仅创建链接 + 系统目录（meta/temp/snippets）"
            >
              导入外部文件夹
            </button>
            {showCreateProject && (
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  ref={newProjectInputRef}
                  value={newProjectName}
                  onChange={(e) => onNewProjectNameChange?.(e.target.value)}
                  placeholder={`输入${createLabel}名`}
                  className="h-8 px-2.5 border border-slate-200 rounded-lg text-xs text-slate-700 w-32 sm:w-40 focus:outline-none focus:border-slate-400"
                  onKeyDown={(e) => { if (e.key === 'Enter') onCreateProject?.(); }}
                  data-tour="input-project-name"
                />
                <button
                  type="button"
                  onClick={onCreateProject}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[#3e4b9c] text-white hover:bg-[#4e5bab] transition-colors text-xs shadow-sm whitespace-nowrap shrink-0"
                  data-tour="btn-create-confirm"
                >
                  <Plus size={13} /> 新建{createLabel}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {pendingGhostCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={onAcceptAllGhostsHere}
                  className="h-8 px-2.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  title="接受本目录所有 AI 建议并移动"
                >
                  <Check size={13} /> 全部接受（{pendingGhostCount}）
                </button>
                <button
                  type="button"
                  onClick={onRejectAllGhostsHere}
                  className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  title="放弃本目录所有 AI 建议"
                >
                  <Ban size={13} /> 放弃全部
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onOpenNewFolder}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-xs whitespace-nowrap shrink-0"
            >
              <FolderPlus size={13} /> <span className="hidden sm:inline">新建文件夹</span><span className="sm:hidden">新建</span>
            </button>
            <button
              type="button"
              onClick={onUploadFiles}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors text-xs shadow-sm whitespace-nowrap shrink-0"
              disabled={aiUploadRunning}
              data-tour="btn-upload"
            >
              <Upload size={13} /> 上传文件
            </button>
            <button
              type="button"
              onClick={onPickFilesAndAiClassify}
              disabled={aiUploadRunning || !allowAiUpload}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors shadow-sm whitespace-nowrap shrink-0 ${
                aiUploadRunning || !allowAiUpload
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-[#3e4b9c] text-white hover:bg-[#4e5bab]'
              }`}
              title="选择文件，逐个放入 temp 并触发 AI 分类推荐"
              data-tour="btn-ai-upload"
            >
              <Sparkles size={13} /> {aiUploadRunning ? 'AI分类中…' : 'AI分类'}
            </button>
            {showCloudPublish && cloudChip && (() => {
              // H4.5: single cloud entry — a state-coloured chip that opens the
              // sync drawer (or the publish modal when the project is unbound).
              const toneStyles = {
                green: { background: '#ecfdf5', color: '#047857', border: '1px solid #cfe7db' },
                indigo: { background: '#eceef7', color: '#3e4b9c', border: '1px solid #d8dbed' },
                amber: { background: '#fffbeb', color: '#b45309', border: '1px solid #fde9c8' },
                red: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
                slate: { background: '#fff', color: '#475569', border: '1px solid #e2e8f0' },
              };
              const dotColors = {
                green: '#2d7a5f', indigo: '#3e4b9c', amber: '#d97706', red: '#dc2626', slate: '#94a3b8',
              };
              const style = toneStyles[cloudChip.tone] || toneStyles.slate;
              // Bound projects: the chip opens the sync panel — make that
              // affordance explicit with a divider + panel icon, hover lift,
              // and a pressed ring while the panel is open.
              const opensPanel = cloudChip.key !== 'unbound' && cloudChip.key !== 'publishing';
              const PanelIcon = cloudPanelOpen ? PanelRightClose : PanelRightOpen;
              return (
                <button
                  type="button"
                  onClick={() => onCloudChipClick?.()}
                  className="group inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-all hover:brightness-[0.97] hover:shadow-sm active:scale-[0.98]"
                  style={{
                    ...style,
                    ...(opensPanel && cloudPanelOpen ? { boxShadow: '0 0 0 2px rgba(62,75,156,0.18)' } : null),
                  }}
                  title={cloudChip.key === 'unbound'
                    ? '将该项目发布到云端'
                    : cloudChip.key === 'publishing'
                      ? '查看发布进度'
                      : cloudPanelOpen ? '收起同步面板' : '打开同步面板：查看变更、拉取/推送、版本历史'}
                >
                  {cloudChip.spin ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : cloudChip.key === 'unbound' ? (
                    <CloudUpload size={13} />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColors[cloudChip.tone] || dotColors.slate }} />
                  )}
                  {cloudChip.text}
                  {opensPanel && (
                    <>
                      <span className="w-px h-3.5 shrink-0 opacity-30" style={{ background: 'currentColor' }} />
                      <PanelIcon size={13} className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
                    </>
                  )}
                </button>
              );
            })()}
            {isAttachedProject && (
              <button
                type="button"
                onClick={() => onRefreshAttached?.()}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors text-xs whitespace-nowrap shrink-0"
                title="重新扫描外部文件夹的目录结构（不会复制文件）"
              >
                <RefreshCw size={13} /> 刷新结构
              </button>
            )}
            {isAttachedProject && isAttachedBroken && (
              <button
                type="button"
                onClick={() => onRelocateAttached?.()}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors text-xs font-medium whitespace-nowrap shrink-0"
                title="外部路径已失效，重新选择新路径"
              >
                <Folder size={13} /> 重新定位
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
};

export default HeaderBar;
