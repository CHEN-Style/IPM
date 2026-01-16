import React from 'react';
import { Ban, Check, Folder, Info, Wand2 } from 'lucide-react';
import ExplorerTree from './ExplorerTree.jsx';

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
  onDragStartEntry,
  onDragEndAny,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  onOpenFolderDetail,
  fmtTime,
  fmtBytes,
  folderDecor,
  onBlankContextMenu,
  tree,
  onToggleTree,
  onLoadTree,
}) => {
  const isProjectCwd = cwd?.type === 'project';
  const list = [
    ...(entries || []),
    ...(pendingGhostsInCwd || []).map((g) => ({
      kind: 'ghost',
      name: g.fileName || 'file',
      relPath: `__ghost__${g.sourceRelPath}`,
      _ghost: g,
    })),
  ];

  return (
    <div className="px-8 py-4 relative">
      {errorText && (
        <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {errorText}
        </div>
      )}
      {viewMode === 'list' ? (
        <table className="w-full text-left border-separate border-spacing-y-1">
          <thead>
            <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
              <th className="pb-4 pl-4 font-bold">名称</th>
              <th className="pb-4 font-bold">类型</th>
              <th className="pb-4 font-bold">修改时间</th>
              <th className="pb-4 text-right font-bold">大小</th>
              <th className="pb-4 text-right pr-4 font-bold">详情</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                  正在加载...
                </td>
              </tr>
            )}
            {!loading &&
              list.map((e) => (
                <tr
                  key={e.relPath}
                  onContextMenu={e.kind === 'ghost' ? undefined : (evt) => onContextMenuEntry?.(evt, e)}
                  onClick={() => {
                    if (e.kind === 'dir') onEnterDir?.(e.relPath);
                  }}
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
                  className={`transition-all duration-200 hover:bg-slate-50/50 cursor-pointer ${
                    e.kind === 'dir' && dragOverFolderRelPath === e.relPath ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''
                  } ${e.kind === 'ghost' ? 'opacity-80 bg-amber-50/40 hover:bg-amber-50/60' : ''}`}
                  draggable={e.kind !== 'ghost'}
                  onDragStart={e.kind === 'ghost' ? undefined : (evt) => onDragStartEntry?.(evt, e)}
                  onDragEnd={e.kind === 'ghost' ? undefined : onDragEndAny}
                  onDragOver={e.kind === 'ghost' ? undefined : (evt) => onDragOverFolder?.(evt, e)}
                  onDragLeave={e.kind === 'ghost' ? undefined : (evt) => onDragLeaveFolder?.(evt, e)}
                  onDrop={e.kind === 'ghost' ? undefined : (evt) => onDropOnFolder?.(evt, e)}
                >
                  <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded ${e.kind === 'dir' ? folderDecor?.(e.relPath).boxClass : 'bg-slate-100'}`}>
                        {e.kind === 'dir' ? (
                          (() => {
                            const { Icon, iconClass } = folderDecor?.(e.relPath) || {};
                            const Comp = Icon || Folder;
                            return <Comp size={16} className={iconClass || 'text-slate-400'} />;
                          })()
                        ) : e.kind === 'ghost' ? (
                          <Wand2 size={16} className="text-amber-600" />
                        ) : (
                          <Folder size={16} className="text-slate-400" />
                        )}
                      </div>
                      <div className="text-sm font-medium text-slate-800">{e.name}</div>
                      {e.kind === 'ghost' ? (
                        <span className="ml-2 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                          AI 建议
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-3.5 text-xs text-slate-500 border-y border-transparent">
                    {e.kind === 'ghost' ? '幽灵文件' : e.kind === 'dir' ? '文件夹' : e.kind === 'file' ? '文件' : '其他'}
                  </td>
                  <td className="py-3.5 text-xs text-slate-400 font-medium border-y border-transparent">
                    {e.kind === 'ghost' ? '-' : fmtTime?.(e.mtimeMs)}
                  </td>
                  <td className="py-3.5 text-right text-xs text-slate-500 font-medium border-y border-transparent">
                    {e.kind === 'file' ? fmtBytes?.(e.sizeBytes) : '-'}
                  </td>
                  <td className="py-3.5 text-right pr-4 rounded-r border-y border-transparent">
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
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                          onClick={(evt) => {
                            evt.preventDefault();
                            evt.stopPropagation();
                            onRejectGhost?.(e._ghost?.sourceRelPath);
                          }}
                          title="放弃该建议"
                        >
                          <Ban size={12} /> 放弃
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
            {!loading && !list.length && !errorText && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                  目录为空（右键空白处可新建文件夹/上传文件）
                </td>
              </tr>
            )}
          </tbody>
        </table>
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


