import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Settings2, BookOpen, AlertTriangle, Link as LinkIcon, Cloud, Loader2 } from 'lucide-react';

const RootTable = ({
  errorText,
  // F1: 旧版「本地文件夹」分组已被「附属导入」取代；保留参数仅作向后兼容（实际不渲染）。
  localFolders, // eslint-disable-line no-unused-vars
  projects,
  entityLabel,
  // C3: 云端绑定状态 / 正在发布的项目名集合，用于在项目名旁显示云图标。
  cloudBindings,
  cloudLockedNames,
  onEnterLocalFolder, // eslint-disable-line no-unused-vars
  onContextMenuLocalFolder, // eslint-disable-line no-unused-vars
  onEnterProject,
  onContextMenuProject,
  rowStyleByStatus,
  projectStatuses,
  statusLabel,
  badgeByStatus,
  onSetProjectStatus,
  onOpenKnowledge,
  onOpenPreferences,
}) => {
  const PROJECT_STATUSES = projectStatuses || ['active', 'pending', 'archived'];

  // F (responsive): observe our own width so we can switch the table to a card
  // layout when the container (not just the viewport — the sync drawer/tree
  // squeeze us) gets too narrow for five columns.
  const wrapRef = useRef(null);
  const [wrapWidth, setWrapWidth] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((obs) => {
      const w = obs[0]?.contentRect?.width;
      if (typeof w === 'number') setWrapWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = wrapWidth != null && wrapWidth < 720;

  const computeRow = (p) => {
    const isAttached = Boolean(p?.attached);
    const isBroken = Boolean(p?.broken);
    const isActive = String(p.status || 'active').toLowerCase() === 'active';
    const externalPath = String(p?.externalRootPath || '');
    const cloudPublishing = cloudLockedNames?.has?.(p.name);
    const cloudInfo = cloudBindings?.[p.name];
    const cloudBound = Boolean(cloudInfo?.bound);
    const rowCls = isAttached && isBroken
      ? 'bg-rose-50/70 hover:bg-rose-50 border border-rose-200/60'
      : (rowStyleByStatus?.(p.status) || '');
    const displayPath = isAttached ? (externalPath || p.path) : p.path;
    return { isAttached, isBroken, isActive, externalPath, cloudPublishing, cloudInfo, cloudBound, rowCls, displayPath };
  };

  // ── Shared row pieces (used by both table rows and cards) ──
  const NameCell = ({ p, r }) => (
    <div className="flex items-center gap-3 min-w-0">
      <div className={`p-2 rounded shrink-0 transition-colors ${
        r.isAttached
          ? (r.isBroken ? 'bg-rose-100' : 'bg-amber-50 group-hover:bg-amber-100')
          : 'bg-slate-100 group-hover:bg-white'
      }`}>
        {r.isAttached
          ? (r.isBroken
            ? <AlertTriangle size={16} className="text-rose-600" />
            : <LinkIcon size={16} className="text-amber-600" />)
          : <FolderOpen size={16} className="text-[#3e4b9c]" />}
      </div>
      <div className="min-w-0 flex items-center gap-2 flex-wrap">
        <span className={`text-sm font-medium truncate ${
          r.isAttached && r.isBroken ? 'text-rose-700' : (String(p.status || '').toLowerCase() === 'archived' ? 'text-slate-500' : 'text-slate-800')
        }`}>
          {p.name}
        </span>
        {r.isAttached && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0"
            title={`外部根：${r.externalPath}`}
          >
            外挂
          </span>
        )}
        {r.isAttached && r.isBroken && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
            路径失效
          </span>
        )}
        {r.cloudPublishing ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#3e4b9c]/10 text-[#3e4b9c] shrink-0" title="正在发布到云端">
            <Loader2 size={11} className="animate-spin" />
            发布中
          </span>
        ) : r.cloudBound ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0"
            title={r.cloudInfo?.versionNumber ? `已绑定云端 · 版本 v${r.cloudInfo.versionNumber}` : '已绑定云端'}
          >
            <Cloud size={11} />
            云端{r.cloudInfo?.versionNumber ? ` v${r.cloudInfo.versionNumber}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );

  const StatusControl = ({ p }) => (
    <div
      className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm max-w-full overflow-x-auto no-scrollbar"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {PROJECT_STATUSES.map((s) => {
        const isOn = String(p.status || 'active').toLowerCase() === s;
        const badge = badgeByStatus?.(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSetProjectStatus?.(p.name, s)}
            className={`px-2 py-1 rounded-md text-[10px] font-bold tracking-wider transition-all border whitespace-nowrap ${
              isOn ? `${badge?.on || ''} shadow-sm` : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
            title={statusLabel?.(s)}
          >
            <span className="inline-flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${badge?.dot || ''} ring-4 ${badge?.ring || ''}`} />
              {statusLabel?.(s)}
            </span>
          </button>
        );
      })}
    </div>
  );

  // `showLabels` lets cards (which have vertical room) show button text even
  // when the table would collapse it to icons only.
  const ActionButtons = ({ p, pIdx, showLabels }) => (
    <div className="flex items-center gap-1.5 flex-nowrap">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[11px] font-medium hover:bg-slate-50 transition-colors whitespace-nowrap"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenPreferences?.(p); }}
        title="管理分类偏好与历史记录"
        data-tour={pIdx === 0 ? 'btn-preferences-first' : undefined}
      >
        <Settings2 size={13} />
        <span className={showLabels ? 'inline' : 'hidden xl:inline'}>偏好与记录</span>
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#3e4b9c] text-white rounded-lg text-[11px] font-semibold hover:bg-[#4e5bab] transition-colors shadow-sm whitespace-nowrap"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenKnowledge?.(p); }}
        title="知识碎片管理与关联"
        data-tour={pIdx === 0 ? 'btn-knowledge-first' : undefined}
      >
        <BookOpen size={13} />
        <span className={showLabels ? 'inline' : 'hidden xl:inline'}>知识管理</span>
      </button>
    </div>
  );

  const rowTitle = (p, r) => (r.isAttached
    ? (r.isBroken
      ? `外部目录失效：${p.brokenReason || r.externalPath}`
      : `外部导入项目 · 链接到 ${r.externalPath}`)
    : undefined);

  return (
    <div className="px-4 sm:px-8 py-4" ref={wrapRef}>
      {errorText && (
        <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {errorText}
        </div>
      )}

      {/* Responsive breakpoint styles for path column.
          约束各断点下路径列的最大宽度，确保长路径始终被截断而非撑开列宽；
          右内边距由 pr-* 控制，保证路径与状态列之间始终留有间隔。 */}
      <style>{`
        .root-table-path { display: table-cell; max-width: 360px; }
        @media (max-width: 1200px) { .root-table-path { max-width: 220px; } }
        @media (max-width: 900px) { .root-table-path { max-width: 120px; } }
        @media (max-width: 720px) { .root-table-path { display: none; } }
      `}</style>

      {!projects.length ? (
        <div className="py-10 text-center text-sm text-slate-400">
          暂无{entityLabel}，点击右上角「新建{entityLabel}」
        </div>
      ) : compact ? (
        /* ── Narrow: card layout ── */
        <div className="flex flex-col gap-2">
          {projects.map((p, pIdx) => {
            const r = computeRow(p);
            return (
              <div
                key={p.name}
                onClick={() => { if (r.isActive) onEnterProject?.(p.name); }}
                onContextMenu={(e) => onContextMenuProject?.(e, p.name)}
                className={`group rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 ${r.isActive ? 'cursor-pointer hover:border-slate-300' : 'cursor-default'} ${r.rowCls}`}
                title={rowTitle(p, r)}
              >
                <NameCell p={p} r={r} />
                {r.displayPath && (
                  <div className="mt-2 text-xs text-slate-400 truncate" title={r.displayPath}>{r.displayPath}</div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                  <StatusControl p={p} />
                  <ActionButtons p={p} pIdx={pIdx} showLabels />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Wide: table layout ── */
        <table className="w-full text-left border-separate border-spacing-y-1">
          <thead>
            <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
              <th className="pb-4 pl-4 font-bold">{entityLabel}名称</th>
              <th className="pb-4 pr-8 font-bold root-table-path">路径</th>
              <th className="pb-4 font-bold whitespace-nowrap">状态</th>
              <th className="pb-4 text-right pr-4 font-bold whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p, pIdx) => {
              const r = computeRow(p);
              return (
              <tr
                key={p.name}
                onClick={() => { if (r.isActive) onEnterProject?.(p.name); }}
                onContextMenu={(e) => onContextMenuProject?.(e, p.name)}
                className={`group transition-all duration-200 ${r.isActive ? 'cursor-pointer' : 'cursor-default'} ${r.rowCls}`}
                data-tour={pIdx === 0 ? 'project-card-first' : undefined}
                title={rowTitle(p, r)}
              >
                <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                  <NameCell p={p} r={r} />
                </td>
                <td className="py-3.5 pr-8 border-y border-transparent root-table-path">
                  <span className="text-xs text-slate-400 block truncate" title={r.displayPath}>{r.displayPath}</span>
                </td>
                <td className="py-3.5 border-y border-transparent">
                  <StatusControl p={p} />
                </td>
                <td className="py-3.5 text-right pr-4 rounded-r border-y border-transparent">
                  <div className="flex items-center justify-end">
                    <ActionButtons p={p} pIdx={pIdx} />
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default RootTable;
