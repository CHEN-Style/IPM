import React, { useState } from 'react';
import { Ban, Check, Folder, Info, Search, Wand2 } from 'lucide-react';
import ExplorerTree from './ExplorerTree.jsx';
import RejectPopover from './RejectPopover.jsx';
import { isHiddenSystemDir, folderTooltip } from './utils.js';

const EntryTable = ({
  errorText,
  viewMode,
  loading,
  entries,
  pendingGhostsInCwd,
  cwd,
  dragOverFolderRelPath,
  onContextMenuEntry,
  onEnterDir,
  onOpenFile,
  onAcceptGhost,
  onRejectGhost,
  onViewTrace,
  onDragStartEntry,
  onDragEndAny,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  onOpenFolderDetail,
  fmtTime,
  fmtBytes,
  folderDecor,
  fileDecor,
  fileFilter,
  fileFilterExts,
  onBlankContextMenu,
  tree,
  onToggleTree,
  onLoadTree,
}) => {
  const [rejectingItem, setRejectingItem] = useState(null);
  const isProjectCwd = cwd?.type === 'project';
  const getExt = (name) => {
    const base = String(name || '');
    const idx = base.lastIndexOf('.');
    if (idx <= 0 || idx === base.length - 1) return '';
    return base.slice(idx + 1).toLowerCase();
  };
  const getTypeLabel = (entry) => {
    if (entry.kind === 'ghost') return '幽灵文件';
    if (entry.kind === 'dir') return '文件夹';
    if (entry.kind === 'file') {
      const ext = getExt(entry.name);
      return ext ? ext.toUpperCase() : '无后缀';
    }
    return '其他';
  };
  const list = [
    ...(entries || []).filter((e) => !isHiddenSystemDir(e)),
    ...(pendingGhostsInCwd || []).map((g) => ({
      kind: 'ghost',
      name: g.fileName || 'file',
      relPath: `__ghost__${g.sourceRelPath}`,
      _ghost: g,
    })),
  ];
  const activeFilters = Array.isArray(fileFilter) ? fileFilter : [];
  const hasFilters = activeFilters.length > 0;
  const onlyFolder = activeFilters.length === 1 && activeFilters[0] === 'folder';
  const filterList = list.filter((entry) => {
    if (!hasFilters) return true;
    if (entry.kind === 'dir') return activeFilters.includes('folder');
    if (entry.kind !== 'file' && entry.kind !== 'ghost') return false;
    if (onlyFolder) return false;
    const ext = getExt(entry.name);
    return activeFilters.some((type) => {
      if (type === 'folder') return false;
      const allow = fileFilterExts?.[type] || [];
      return allow.includes(ext);
    });
  });

  const entryIcon = (e) => {
    const boxClass = e.kind === 'dir'
      ? folderDecor?.(e.relPath).boxClass
      : e.kind === 'file'
        ? fileDecor?.(e.name).boxClass
        : 'bg-slate-100';
    let icon;
    if (e.kind === 'dir') {
      const { Icon, iconClass } = folderDecor?.(e.relPath) || {};
      const Comp = Icon || Folder;
      icon = <Comp size={16} className={iconClass || 'text-slate-400'} />;
    } else if (e.kind === 'ghost') {
      icon = <Wand2 size={16} className="text-amber-600" />;
    } else {
      const { Icon, iconClass } = fileDecor?.(e.name) || {};
      const Comp = Icon || Folder;
      icon = <Comp size={16} className={iconClass || 'text-slate-400'} />;
    }
    return <div className={`p-2 rounded shrink-0 ${boxClass}`}>{icon}</div>;
  };

  const entryActions = (e) => {
    if (e.kind === 'ghost') {
      return (
        <div className="inline-flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors whitespace-nowrap"
            onClick={(evt) => { evt.preventDefault(); evt.stopPropagation(); onAcceptGhost?.(e._ghost?.sourceRelPath); }}
            title="接受 AI 建议并移动"
          >
            <Check size={12} /> 接受
          </button>
          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors whitespace-nowrap"
              onClick={(evt) => { evt.preventDefault(); evt.stopPropagation(); setRejectingItem(rejectingItem === e._ghost?.sourceRelPath ? null : e._ghost?.sourceRelPath); }}
              title="放弃该建议"
            >
              <Ban size={12} /> 放弃
            </button>
            {rejectingItem === e._ghost?.sourceRelPath && (
              <RejectPopover
                sourceRelPath={e._ghost?.sourceRelPath}
                onConfirm={(src, feedback) => { setRejectingItem(null); onRejectGhost?.(src, { userFeedback: feedback }); }}
                onCancel={() => setRejectingItem(null)}
              />
            )}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-[#3e4b9c] rounded hover:bg-[#eceef7] hover:border-[#d8dbed] transition-colors whitespace-nowrap"
            onClick={(evt) => { evt.preventDefault(); evt.stopPropagation(); onViewTrace?.(e._ghost?.sourceRelPath); }}
            title="查看 AI 分类过程"
          >
            <Search size={12} /> 过程
          </button>
        </div>
      );
    }
    if (e.kind === 'dir' && isProjectCwd) {
      return (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 hover:text-slate-800 transition-colors whitespace-nowrap"
          onClick={(evt) => { evt.preventDefault(); evt.stopPropagation(); onOpenFolderDetail?.(e); }}
          title="查看文件夹详情"
        >
          <Info size={12} /> 详情
        </button>
      );
    }
    return <span className="text-[11px] text-slate-300">-</span>;
  };

  const rowEventProps = (e) => ({
    onContextMenu: e.kind === 'ghost' ? undefined : (evt) => onContextMenuEntry?.(evt, e),
    onClick: () => { if (e.kind === 'dir') onEnterDir?.(e.relPath); },
    onDoubleClick: (evt) => {
      if (e.kind === 'file') { evt.preventDefault(); evt.stopPropagation(); onOpenFile?.(e.relPath); }
      if (e.kind === 'ghost') { const src = e._ghost?.sourceRelPath; if (!src) return; evt.preventDefault(); evt.stopPropagation(); onOpenFile?.(src); }
    },
    title: e.kind === 'dir' ? folderTooltip(e.relPath) : undefined,
    draggable: e.kind !== 'ghost',
    onDragStart: e.kind === 'ghost' ? undefined : (evt) => onDragStartEntry?.(evt, e),
    onDragEnd: e.kind === 'ghost' ? undefined : onDragEndAny,
    onDragOver: e.kind === 'ghost' ? undefined : (evt) => onDragOverFolder?.(evt, e),
    onDragLeave: e.kind === 'ghost' ? undefined : (evt) => onDragLeaveFolder?.(evt, e),
    onDrop: e.kind === 'ghost' ? undefined : (evt) => onDropOnFolder?.(evt, e),
  });

  const rowCls = (e) =>
    `transition-all duration-200 hover:bg-slate-50/50 cursor-pointer ${
      e.kind === 'dir' && dragOverFolderRelPath === e.relPath ? 'ring-2 ring-[#d8dbed] bg-[#eceef7]/40' : ''
    } ${e.kind === 'ghost' ? 'opacity-80 bg-amber-50/40 hover:bg-amber-50/60' : ''}`;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 relative">
      {errorText && (
        <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {errorText}
        </div>
      )}
      {viewMode === 'list' ? (
        <>
          {/* ── Wide: full table (≥768px) ── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-1" style={{ minWidth: '600px' }}>
              <thead>
                <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
                  <th className="pb-4 pl-4 font-bold">名称</th>
                  <th className="pb-4 font-bold whitespace-nowrap">类型</th>
                  <th className="pb-4 font-bold whitespace-nowrap">修改时间</th>
                  <th className="pb-4 text-right font-bold whitespace-nowrap">大小</th>
                  <th className="pb-4 text-right pr-4 font-bold whitespace-nowrap">详情</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">正在加载...</td></tr>
                )}
                {!loading && filterList.map((e, eIdx) => (
                  <tr
                    key={e.relPath}
                    data-tour={e.kind === 'dir' && filterList.slice(0, eIdx).every((x) => x.kind !== 'dir') ? 'folder-first' : undefined}
                    className={rowCls(e)}
                    {...rowEventProps(e)}
                  >
                    <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                      <div className="flex items-center gap-3 min-w-0">
                        {entryIcon(e)}
                        <div className="text-sm font-medium text-slate-800 truncate">{e.name}</div>
                        {e.kind === 'ghost' && (
                          <span className="ml-2 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                            AI 建议
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 text-xs text-slate-500 border-y border-transparent whitespace-nowrap">{getTypeLabel(e)}</td>
                    <td className="py-3.5 text-xs text-slate-400 font-medium border-y border-transparent whitespace-nowrap">
                      {e.kind === 'ghost' ? '-' : fmtTime?.(e.mtimeMs)}
                    </td>
                    <td className="py-3.5 text-right text-xs text-slate-500 font-medium border-y border-transparent whitespace-nowrap">
                      {e.kind === 'file' ? fmtBytes?.(e.sizeBytes) : '-'}
                    </td>
                    <td className="py-3.5 text-right pr-4 rounded-r border-y border-transparent">
                      {entryActions(e)}
                    </td>
                  </tr>
                ))}
                {!loading && !filterList.length && !errorText && (
                  <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">目录为空（右键空白处可新建文件夹/上传文件）</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Narrow: compact list (<768px) ── */}
          <div className="md:hidden space-y-1">
            {loading && <div className="py-10 text-center text-sm text-slate-400">正在加载...</div>}
            {!loading && filterList.map((e, eIdx) => (
              <div
                key={e.relPath}
                data-tour={e.kind === 'dir' && filterList.slice(0, eIdx).every((x) => x.kind !== 'dir') ? 'folder-first' : undefined}
                className={`rounded-lg px-3 py-3 ${rowCls(e)}`}
                {...rowEventProps(e)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {entryIcon(e)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{e.name}</span>
                      {e.kind === 'ghost' && (
                        <span className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">AI</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">
                      <span>{getTypeLabel(e)}</span>
                      {e.kind !== 'ghost' && <span>{fmtTime?.(e.mtimeMs)}</span>}
                      {e.kind === 'file' && <span>{fmtBytes?.(e.sizeBytes)}</span>}
                    </div>
                  </div>
                  <div className="shrink-0">{entryActions(e)}</div>
                </div>
              </div>
            ))}
            {!loading && !filterList.length && !errorText && (
              <div className="py-10 text-center text-sm text-slate-400">目录为空（右键空白处可新建文件夹/上传文件）</div>
            )}
          </div>
        </>
      ) : (
        <div className="p-2" onContextMenu={onBlankContextMenu}>
          <ExplorerTree
            name={
              cwd?.relPath
                ? String(cwd.relPath).split('/').slice(-1)[0]
                : cwd?.type === 'local'
                  ? String(cwd.rootPath || '').split(/[/\\]+/).filter(Boolean).slice(-1)[0] || String(cwd.rootPath || '本地文件夹')
                  : cwd?.name
            }
            relPath={cwd?.relPath || ''}
            depth={0}
            tree={tree}
            onToggle={onToggleTree}
            onLoad={onLoadTree}
            onEntryContextMenu={onContextMenuEntry}
            onOpenFile={onOpenFile}
            onDragStartEntry={onDragStartEntry}
            onDragEndAny={onDragEndAny}
            onDropOnFolder={onDropOnFolder}
            onDragOverFolder={onDragOverFolder}
            onDragLeaveFolder={onDragLeaveFolder}
            folderDecor={folderDecor}
            fmtBytes={fmtBytes}
          />
        </div>
      )}
    </div>
  );
};

export default EntryTable;


