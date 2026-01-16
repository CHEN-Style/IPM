import React from 'react';
import { Info, X } from 'lucide-react';

const FolderDetailPanel = ({
  open,
  visible,
  loading,
  detail,
  descEditing,
  descDraft,
  descSaving,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onDraftChange,
  fmtTime,
}) => {
  if (!open) return null;

  const safeFmtTime = fmtTime || (() => '-');

  return (
    <div className="absolute inset-0 z-[80]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className={`absolute top-0 right-0 h-full w-[360px] bg-slate-50 border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-200 bg-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Info size={12} className="text-slate-400" /> 文件夹详情
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-800 truncate">{detail?.entry?.name || '文件夹'}</div>
            <div className="mt-1 text-[11px] text-slate-400 truncate">{detail?.entry?.relPath || ''}</div>
          </div>
          <button
            type="button"
            className="p-1.5 rounded border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={onClose}
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <section className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Properties</div>
            {loading ? (
              <div className="text-xs text-slate-400">加载中...</div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">名称</span>
                  <span className="font-medium text-slate-700 truncate max-w-[200px]">{detail?.entry?.name || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">路径</span>
                  <span className="font-medium text-slate-700 truncate max-w-[200px]">{detail?.entry?.relPath || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">修改时间</span>
                  <span className="font-medium text-slate-700">{safeFmtTime(detail?.entry?.mtimeMs || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">System</span>
                  <span className="font-medium text-slate-700">{detail?.folderMeta?.system ? 'true' : 'false'}</span>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Description</div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-slate-400">
                {detail?.folderMeta?.system ? '系统目录（不可编辑）' : descEditing ? '编辑模式' : '查看模式'}
              </div>
              {!detail?.folderMeta?.system ? (
                descEditing ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-2.5 py-1 text-[11px] font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
                      disabled={descSaving}
                      onClick={onSave}
                    >
                      {descSaving ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
                      disabled={descSaving}
                      onClick={onCancelEdit}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
                    onClick={onEdit}
                  >
                    编辑
                  </button>
                )
              ) : null}
            </div>

            {descEditing && !detail?.folderMeta?.system ? (
              <textarea
                value={descDraft}
                onChange={(e) => onDraftChange?.(e.target.value)}
                placeholder="为该文件夹写一段简介（可用于 Agent 检索/标签化）..."
                className="w-full min-h-[120px] px-3 py-2 border border-slate-200 rounded text-sm text-slate-700 focus:outline-none focus:border-slate-400 bg-white"
                disabled={descSaving}
              />
            ) : (
              <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                {detail?.folderMeta?.description ? detail.folderMeta.description : <span className="text-slate-400">（暂无描述）</span>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default FolderDetailPanel;


