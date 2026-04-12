import React from 'react';
import { FolderOpen, Settings2, Bot, BookOpen } from 'lucide-react';

const RootTable = ({
  errorText,
  localFolders,
  projects,
  entityLabel,
  onEnterLocalFolder,
  onContextMenuLocalFolder,
  onEnterProject,
  onContextMenuProject,
  rowStyleByStatus,
  projectStatuses,
  statusLabel,
  badgeByStatus,
  onSetProjectStatus,
  onOpenKnowledge,
  onOpenPreferences,
  onOpenAgent,
}) => {
  const PROJECT_STATUSES = projectStatuses || ['active', 'pending', 'archived'];
  const isEmpty = !projects.length && !(localFolders || []).length;

  /* ── Status toggle (shared by both layouts) ── */
  const StatusToggle = ({ project }) => (
    <div
      className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {PROJECT_STATUSES.map((s) => {
        const isOn = String(project.status || 'active').toLowerCase() === s;
        const badge = badgeByStatus?.(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSetProjectStatus?.(project.name, s)}
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

  /* ── Action buttons (shared, compact=true for card layout) ── */
  const ActionButtons = ({ project, isFirst, compact }) => (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors whitespace-nowrap`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenPreferences?.(project); }}
        title="管理分类偏好与历史记录"
        data-tour={isFirst ? 'btn-preferences-first' : undefined}
      >
        <Settings2 size={13} />
        {!compact && <span>偏好</span>}
      </button>
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition-colors shadow-sm whitespace-nowrap`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenAgent?.(project); }}
        title="打开 AI 助理对话"
      >
        <Bot size={13} />
        {!compact && <span>AI</span>}
      </button>
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} bg-[#3e4b9c] text-white rounded-lg text-xs font-semibold hover:bg-[#4e5bab] transition-colors shadow-sm whitespace-nowrap`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenKnowledge?.(project); }}
        title="知识碎片管理与关联"
        data-tour={isFirst ? 'btn-knowledge-first' : undefined}
      >
        <BookOpen size={13} />
        {!compact && <span>知识</span>}
      </button>
    </div>
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4">
      {errorText && (
        <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {errorText}
        </div>
      )}

      {/* ════════ Wide screen: table layout (≥1024px) ════════ */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left border-separate border-spacing-y-1 table-fixed" style={{ minWidth: '700px' }}>
          <thead>
            <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
              <th className="pb-4 pl-4 font-bold" style={{ width: '20%' }}>{entityLabel}名称</th>
              <th className="pb-4 font-bold" style={{ width: '30%' }}>路径</th>
              <th className="pb-4 text-center font-bold whitespace-nowrap" style={{ width: '28%' }}>状态</th>
              <th className="pb-4 text-right pr-4 font-bold whitespace-nowrap" style={{ width: '22%' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {(localFolders || []).map((f) => {
              const exists = Boolean(f?.exists);
              const name = String(f?.name || '本地文件夹');
              const p = String(f?.path || '');
              const rowCls = exists
                ? 'hover:bg-slate-50/50'
                : 'bg-rose-50/70 hover:bg-rose-50 border border-rose-200/60';
              return (
                <tr
                  key={`__local__${p}`}
                  onClick={() => { if (exists) onEnterLocalFolder?.(p); }}
                  onContextMenu={(e) => onContextMenuLocalFolder?.(e, f)}
                  className={`group transition-all duration-200 ${exists ? 'cursor-pointer' : 'cursor-not-allowed'} ${rowCls}`}
                  title={exists ? '点击进入该本地文件夹' : '该路径已失效（可能被移动/删除/重命名），右键可取消关联'}
                >
                  <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded shrink-0 ${exists ? 'bg-slate-100 group-hover:bg-white' : 'bg-rose-100'} transition-colors`}>
                        <FolderOpen size={16} className={exists ? 'text-slate-600' : 'text-rose-600'} />
                      </div>
                      <div className={`text-sm font-medium truncate ${exists ? 'text-slate-800' : 'text-rose-700'}`}>
                        {name}
                        <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900/5 text-slate-600 border border-slate-200">
                          本地
                        </span>
                        {!exists && (
                          <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                            已失效
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 border-y border-transparent overflow-hidden">
                    <div className="text-xs text-slate-400 font-medium truncate" title={p}>{p}</div>
                  </td>
                  <td className="py-3.5 text-center border-y border-transparent">
                    <span className="text-[10px] font-bold px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 whitespace-nowrap">
                      LOCAL
                    </span>
                  </td>
                  <td className="py-3.5 text-right pr-4 rounded-r text-xs text-slate-300 font-medium border-y border-transparent">—</td>
                </tr>
              );
            })}
            {projects.map((p, pIdx) => (
              <tr
                key={p.name}
                onClick={() => onEnterProject?.(p.name)}
                onContextMenu={(e) => onContextMenuProject?.(e, p.name)}
                className={`group cursor-pointer transition-all duration-200 ${rowStyleByStatus?.(p.status) || ''}`}
                data-tour={pIdx === 0 ? 'project-card-first' : undefined}
              >
                <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded group-hover:bg-white transition-colors shrink-0">
                      <FolderOpen size={16} className="text-[#3e4b9c]" />
                    </div>
                    <div className={`text-sm font-medium truncate ${String(p.status || '').toLowerCase() === 'archived' ? 'text-slate-500' : 'text-slate-800'}`}>
                      {p.name}
                    </div>
                  </div>
                </td>
                <td className="py-3.5 border-y border-transparent overflow-hidden">
                  <div className="text-xs text-slate-400 font-medium truncate" title={p.path}>{p.path}</div>
                </td>
                <td className="py-3.5 text-center border-y border-transparent">
                  <StatusToggle project={p} />
                </td>
                <td className="py-3.5 text-right pr-4 rounded-r border-y border-transparent">
                  <div className="flex items-center justify-end">
                    <ActionButtons project={p} isFirst={pIdx === 0} />
                  </div>
                </td>
              </tr>
            ))}
            {isEmpty && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-sm text-slate-400">
                  暂无{entityLabel}，点击右上角「新建{entityLabel}」
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ════════ Narrow screen: card layout (<1024px) ════════ */}
      <div className="lg:hidden space-y-2">
        {(localFolders || []).map((f) => {
          const exists = Boolean(f?.exists);
          const name = String(f?.name || '本地文件夹');
          const p = String(f?.path || '');
          return (
            <div
              key={`__local__${p}`}
              onClick={() => { if (exists) onEnterLocalFolder?.(p); }}
              onContextMenu={(e) => onContextMenuLocalFolder?.(e, f)}
              className={`group rounded-xl p-4 transition-all duration-200 ${
                exists
                  ? 'bg-white border border-slate-200 cursor-pointer hover:border-slate-300 hover:shadow-sm'
                  : 'bg-rose-50/70 border border-rose-200/60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded shrink-0 ${exists ? 'bg-slate-100' : 'bg-rose-100'}`}>
                  <FolderOpen size={16} className={exists ? 'text-slate-600' : 'text-rose-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${exists ? 'text-slate-800' : 'text-rose-700'}`}>{name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900/5 text-slate-600 border border-slate-200">本地</span>
                    {!exists && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">已失效</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 truncate" title={p}>{p}</div>
                </div>
              </div>
            </div>
          );
        })}

        {projects.map((p, pIdx) => (
          <div
            key={p.name}
            onClick={() => onEnterProject?.(p.name)}
            onContextMenu={(e) => onContextMenuProject?.(e, p.name)}
            className={`group rounded-xl bg-white border border-slate-200 p-4 cursor-pointer transition-all duration-200 hover:border-slate-300 hover:shadow-sm ${rowStyleByStatus?.(p.status) || ''}`}
            data-tour={pIdx === 0 ? 'project-card-first' : undefined}
          >
            {/* Row 1: name + status */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-100 rounded group-hover:bg-white transition-colors shrink-0">
                <FolderOpen size={16} className="text-[#3e4b9c]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`text-sm font-medium truncate ${String(p.status || '').toLowerCase() === 'archived' ? 'text-slate-500' : 'text-slate-800'}`}>
                    {p.name}
                  </span>
                  <StatusToggle project={p} />
                </div>
                <div className="text-xs text-slate-400 mt-1 truncate" title={p.path}>{p.path}</div>
              </div>
            </div>
            {/* Row 2: action buttons */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end">
              <ActionButtons project={p} isFirst={pIdx === 0} compact />
            </div>
          </div>
        ))}

        {isEmpty && (
          <div className="py-10 text-center text-sm text-slate-400">
            暂无{entityLabel}，点击右上角「新建{entityLabel}」
          </div>
        )}
      </div>
    </div>
  );
};

export default RootTable;
