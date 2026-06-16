import React, { useEffect, useRef, useState } from 'react';
import { Ban, Check, Folder, Info, Search, Wand2 } from 'lucide-react';
import RejectPopover from './RejectPopover.jsx';
import { isHiddenSystemDir, folderTooltip } from './utils.js';

const EntryTable = ({
  errorText,
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
  // H4.5: per-file sync badges for bound cloud projects.
  // Map of project-root-relative posix path ('/a/b.docx') -> 'new'|'mod'|'conflict'.
  // null = project not bound (render nothing).
  syncBadges,
}) => {
  const [rejectingItem, setRejectingItem] = useState(null);
  const isProjectCwd = cwd?.type === 'project';

  // H4.5: container-aware responsive columns. The sync drawer squeezes this
  // area (it's a flex sibling, not the viewport), so media queries don't help;
  // observe our own width and shed low-priority columns instead of letting
  // cells pile onto each other.
  const wrapRef = useRef(null);
  const [wrapWidth, setWrapWidth] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === 'number') setWrapWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = wrapWidth != null && wrapWidth < 660; // hide 类型 + 大小
  const narrow = wrapWidth != null && wrapWidth < 500; // also hide 修改时间
  const visibleCols = 2 + (compact ? 0 : 2) + (narrow ? 0 : 1);

  // Conflict copies created by pull keep a recognizable name suffix; badge
  // them even without a plan entry so they stay identifiable after restarts.
  const CONFLICT_COPY_RE = /（云端冲突副本-v[^）]*）/;
  const syncBadgeFor = (entry) => {
    if (!syncBadges || entry.kind !== 'file') return null;
    if (CONFLICT_COPY_RE.test(entry.name)) {
      return { label: '冲突副本', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    const key = `/${String(entry.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')}`;
    const kind = syncBadges[key];
    if (kind === 'new') return { label: '新增 · 待同步', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (kind === 'mod') return { label: '已修改 · 待同步', className: 'bg-[#eceef7] text-[#3e4b9c] border-[#d8dbed]' };
    if (kind === 'conflict') return { label: '冲突待处理', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    return null;
  };
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

  return (
    <div className="px-4 sm:px-8 py-4 relative" ref={wrapRef}>
      {errorText && (
        <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {errorText}
        </div>
      )}
      <table className="w-full text-left border-separate border-spacing-y-1" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col />
            {!compact && <col style={{ width: 60 }} />}
            {!narrow && <col style={{ width: 128 }} />}
            {!compact && <col style={{ width: 72 }} />}
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
              <th className="pb-4 pl-4 font-bold">名称</th>
              {!compact && <th className="pb-4 font-bold">类型</th>}
              {!narrow && <th className="pb-4 font-bold">修改时间</th>}
              {!compact && <th className="pb-4 text-right font-bold">大小</th>}
              <th className="pb-4 text-right pr-2 font-bold">详情</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={visibleCols} className="py-10 text-center text-sm text-slate-400">
                  正在加载...
                </td>
              </tr>
            )}
            {!loading &&
              filterList.map((e, eIdx) => (
                <tr
                  key={e.relPath}
                  onContextMenu={e.kind === 'ghost' ? undefined : (evt) => onContextMenuEntry?.(evt, e)}
                  onClick={() => {
                    if (e.kind === 'dir') onEnterDir?.(e.relPath);
                  }}
                  data-tour={e.kind === 'dir' && filterList.slice(0, eIdx).every((x) => x.kind !== 'dir') ? 'folder-first' : undefined}
                  onDoubleClick={(evt) => {
                    // Double-click to open file via OS default app
                    if (e.kind === 'file') {
                      evt.preventDefault();
                      evt.stopPropagation();
                      onOpenFile?.(e.relPath);
                    }
                    // Ghost: open source file (always under temp/) for preview
                    if (e.kind === 'ghost') {
                      const src = e._ghost?.sourceRelPath;
                      if (!src) return;
                      evt.preventDefault();
                      evt.stopPropagation();
                      onOpenFile?.(src);
                    }
                  }}
                  title={e.kind === 'dir' ? folderTooltip(e.relPath) : undefined}
                  className={`transition-all duration-200 hover:bg-slate-50/50 cursor-pointer ${
                    e.kind === 'dir' && dragOverFolderRelPath === e.relPath ? 'ring-2 ring-[#d8dbed] bg-[#eceef7]/40' : ''
                  } ${e.kind === 'ghost' ? 'opacity-80 bg-amber-50/40 hover:bg-amber-50/60' : ''}`}
                  draggable={e.kind !== 'ghost'}
                  onDragStart={e.kind === 'ghost' ? undefined : (evt) => onDragStartEntry?.(evt, e)}
                  onDragEnd={e.kind === 'ghost' ? undefined : onDragEndAny}
                  onDragOver={e.kind === 'ghost' ? undefined : (evt) => onDragOverFolder?.(evt, e)}
                  onDragLeave={e.kind === 'ghost' ? undefined : (evt) => onDragLeaveFolder?.(evt, e)}
                  onDrop={e.kind === 'ghost' ? undefined : (evt) => onDropOnFolder?.(evt, e)}
                >
                  <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`p-2 rounded shrink-0 ${
                          e.kind === 'dir'
                            ? folderDecor?.(e.relPath).boxClass
                            : e.kind === 'file'
                              ? fileDecor?.(e.name).boxClass
                              : 'bg-slate-100'
                        }`}
                      >
                        {e.kind === 'dir' ? (
                          (() => {
                            const { Icon, iconClass } = folderDecor?.(e.relPath) || {};
                            const Comp = Icon || Folder;
                            return <Comp size={16} className={iconClass || 'text-slate-400'} />;
                          })()
                        ) : e.kind === 'ghost' ? (
                          <Wand2 size={16} className="text-amber-600" />
                        ) : (
                          (() => {
                            const { Icon, iconClass } = fileDecor?.(e.name) || {};
                            const Comp = Icon || Folder;
                            return <Comp size={16} className={iconClass || 'text-slate-400'} />;
                          })()
                        )}
                      </div>
                      <span className="text-sm font-medium text-slate-800 truncate" title={e.name}>{e.name}</span>
                      {(() => {
                        const badge = syncBadgeFor(e);
                        return badge ? (
                          <span className={`ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${badge.className}`}>
                            {badge.label}
                          </span>
                        ) : null;
                      })()}
                      {e.kind === 'ghost' && (
                        <span className="ml-1 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                          AI 建议
                        </span>
                      )}
                    </div>
                  </td>
                  {!compact && (
                    <td className="py-3.5 text-xs text-slate-500 border-y border-transparent whitespace-nowrap truncate">{getTypeLabel(e)}</td>
                  )}
                  {!narrow && (
                    <td className="py-3.5 text-xs text-slate-400 font-medium border-y border-transparent whitespace-nowrap truncate">
                      {e.kind === 'ghost' ? '-' : fmtTime?.(e.mtimeMs)}
                    </td>
                  )}
                  {!compact && (
                    <td className="py-3.5 text-right text-xs text-slate-500 font-medium border-y border-transparent whitespace-nowrap">
                      {e.kind === 'file' ? fmtBytes?.(e.sizeBytes) : '-'}
                    </td>
                  )}
                  <td className="py-3.5 text-right pr-2 rounded-r border-y border-transparent">
                    {e.kind === 'ghost' ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                          onClick={(evt) => {
                            evt.preventDefault();
                            evt.stopPropagation();
                            onAcceptGhost?.(e._ghost?.sourceRelPath);
                          }}
                          title="接受 AI 建议并移动"
                        >
                          <Check size={12} /> 接受
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                            onClick={(evt) => {
                              evt.preventDefault();
                              evt.stopPropagation();
                              setRejectingItem(rejectingItem === e._ghost?.sourceRelPath ? null : e._ghost?.sourceRelPath);
                            }}
                            title="放弃该建议"
                          >
                            <Ban size={12} /> 放弃
                          </button>
                          {rejectingItem === e._ghost?.sourceRelPath && (
                            <RejectPopover
                              sourceRelPath={e._ghost?.sourceRelPath}
                              onConfirm={(src, feedback) => {
                                setRejectingItem(null);
                                onRejectGhost?.(src, { userFeedback: feedback });
                              }}
                              onCancel={() => setRejectingItem(null)}
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-[#3e4b9c] rounded hover:bg-[#eceef7] hover:border-[#d8dbed] transition-colors"
                          onClick={(evt) => {
                            evt.preventDefault();
                            evt.stopPropagation();
                            onViewTrace?.(e._ghost?.sourceRelPath);
                          }}
                          title="查看 AI 分类过程"
                        >
                          <Search size={12} /> 过程
                        </button>
                      </div>
                    ) : e.kind === 'dir' && isProjectCwd ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 hover:text-slate-800 transition-colors"
                        onClick={(evt) => {
                          evt.preventDefault();
                          evt.stopPropagation();
                          onOpenFolderDetail?.(e);
                        }}
                        title="查看文件夹详情"
                      >
                        <Info size={12} /> 详情
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-300">-</span>
                    )}
                  </td>
                </tr>
              ))}
            {!loading && !filterList.length && !errorText && (
              <tr>
                <td colSpan={visibleCols} className="py-10 text-center text-sm text-slate-400">
                  目录为空（右键空白处可新建文件夹/上传文件）
                </td>
              </tr>
            )}
          </tbody>
        </table>
    </div>
  );
};

export default EntryTable;


