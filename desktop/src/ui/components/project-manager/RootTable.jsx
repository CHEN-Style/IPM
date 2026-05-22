import React from 'react';
import { FolderOpen, Settings2, BookOpen, AlertTriangle, Link as LinkIcon } from 'lucide-react';

const RootTable = ({
  errorText,
  // F1: 旧版「本地文件夹」分组已被「附属导入」取代；保留参数仅作向后兼容（实际不渲染）。
  localFolders, // eslint-disable-line no-unused-vars
  projects,
  entityLabel,
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

  return (
    <div className="px-4 sm:px-8 py-4">
      {errorText && (
        <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {errorText}
        </div>
      )}

      {/* Responsive breakpoint styles for path column */}
      <style>{`
        .root-table-path { display: table-cell; }
        @media (max-width: 900px) { .root-table-path { max-width: 120px; } }
        @media (max-width: 720px) { .root-table-path { display: none; } }
      `}</style>

      <table className="w-full text-left border-separate border-spacing-y-1">
        <thead>
          <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
            <th className="pb-4 pl-4 font-bold">{entityLabel}名称</th>
            <th className="pb-4 font-bold root-table-path">路径</th>
            <th className="pb-4 font-bold whitespace-nowrap">状态</th>
            <th className="pb-4 text-right pr-4 font-bold whitespace-nowrap">操作</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p, pIdx) => {
            const isAttached = Boolean(p?.attached);
            const isBroken = Boolean(p?.broken);
            const externalPath = String(p?.externalRootPath || '');
            const rowCls = isAttached && isBroken
              ? 'bg-rose-50/70 hover:bg-rose-50 border border-rose-200/60'
              : (rowStyleByStatus?.(p.status) || '');
            const displayPath = isAttached ? (externalPath || p.path) : p.path;
            return (
            <tr
              key={p.name}
              onClick={() => onEnterProject?.(p.name)}
              onContextMenu={(e) => onContextMenuProject?.(e, p.name)}
              className={`group cursor-pointer transition-all duration-200 ${rowCls}`}
              data-tour={pIdx === 0 ? 'project-card-first' : undefined}
              title={isAttached
                ? (isBroken
                  ? `外部目录失效：${p.brokenReason || externalPath}`
                  : `外部导入项目 · 链接到 ${externalPath}`)
                : undefined}
            >
              <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded shrink-0 transition-colors ${
                    isAttached
                      ? (isBroken ? 'bg-rose-100' : 'bg-amber-50 group-hover:bg-amber-100')
                      : 'bg-slate-100 group-hover:bg-white'
                  }`}>
                    {isAttached
                      ? (isBroken
                        ? <AlertTriangle size={16} className="text-rose-600" />
                        : <LinkIcon size={16} className="text-amber-600" />)
                      : <FolderOpen size={16} className="text-[#3e4b9c]" />}
                  </div>
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium truncate ${
                      isAttached && isBroken ? 'text-rose-700' : (String(p.status || '').toLowerCase() === 'archived' ? 'text-slate-500' : 'text-slate-800')
                    }`}>
                      {p.name}
                    </span>
                    {isAttached && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0"
                        title={`外部根：${externalPath}`}
                      >
                        外挂
                      </span>
                    )}
                    {isAttached && isBroken && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
                        路径失效
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="py-3.5 border-y border-transparent root-table-path">
                <span className="text-xs text-slate-400 block truncate" title={displayPath}>{displayPath}</span>
              </td>
              <td className="py-3.5 border-y border-transparent">
                <div
                  className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm"
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
              </td>
              <td className="py-3.5 text-right pr-4 rounded-r border-y border-transparent">
                <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[11px] font-medium hover:bg-slate-50 transition-colors whitespace-nowrap"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenPreferences?.(p); }}
                    title="管理分类偏好与历史记录"
                    data-tour={pIdx === 0 ? 'btn-preferences-first' : undefined}
                  >
                    <Settings2 size={13} />
                    <span className="hidden xl:inline">偏好与记录</span>
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#3e4b9c] text-white rounded-lg text-[11px] font-semibold hover:bg-[#4e5bab] transition-colors shadow-sm whitespace-nowrap"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenKnowledge?.(p); }}
                    title="知识碎片管理与关联"
                    data-tour={pIdx === 0 ? 'btn-knowledge-first' : undefined}
                  >
                    <BookOpen size={13} />
                    <span className="hidden xl:inline">知识管理</span>
                  </button>
                </div>
              </td>
            </tr>
            );
          })}
          {!projects.length && (
            <tr>
              <td colSpan={4} className="py-10 text-center text-sm text-slate-400">
                暂无{entityLabel}，点击右上角「新建{entityLabel}」
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default RootTable;
