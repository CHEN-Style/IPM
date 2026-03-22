import React from 'react';
import { Ban, Check, ChevronDown, ChevronRight, Search, Wand2 } from 'lucide-react';
import ClassifyPipeline from './ClassifyPipeline.jsx';

const AIGhostOverview = ({
  show,
  overviewOpen,
  pendingGhostCount,
  pendingGhostFolderCount,
  ghostLoading,
  pendingGhostGroups,
  overviewExpanded,
  onToggleOverview,
  onToggleGroup,
  onAcceptAll,
  onRejectAll,
  onAcceptGroup,
  onRejectGroup,
  onEnterFolder,
  onAcceptItem,
  onRejectItem,
  onViewTrace,
  pipelineQueued,
  pipelineClassifying,
}) => {
  if (!show) return null;

  return (
    <div className="px-8 pt-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button
          type="button"
          className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
          onClick={onToggleOverview}
        >
          <div className="min-w-0 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50 border border-amber-200/60">
              <Wand2 size={16} className="text-amber-600" />
            </div>
            <div className="min-w-0 text-left">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-800 truncate">
                  AI 暂存区：待处理 {pendingGhostCount} 个
                </span>
                <ClassifyPipeline
                  queued={pipelineQueued}
                  classifying={pipelineClassifying}
                  pendingGhostCount={pendingGhostCount}
                />
                {ghostLoading ? <span className="text-[11px] text-slate-400 font-medium">同步中...</span> : null}
              </div>
              <div className="text-[11px] text-slate-400 truncate">分布在 {pendingGhostFolderCount} 个文件夹（点击展开）</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAcceptAll?.();
              }}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
              title="一键接受全部（移动）"
            >
              <span className="inline-flex items-center gap-2">
                <Check size={14} /> 全部接受
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRejectAll?.();
              }}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              title="一键放弃全部"
            >
              <span className="inline-flex items-center gap-2">
                <Ban size={14} /> 全部放弃
              </span>
            </button>
            <div className="text-slate-400">{overviewOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
          </div>
        </button>

        {overviewOpen ? (
          <div className="border-t border-slate-200 bg-slate-50/50">
            <div className="px-4 py-3 space-y-2">
              {pendingGhostGroups.map((g) => {
                const open = Boolean(overviewExpanded?.[g.folderRelPath]);
                const preview = g.items.slice(0, 2).map((x) => x.fileName || 'file');
                const rest = Math.max(0, g.items.length - preview.length);
                return (
                  <div key={g.folderRelPath} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex items-center gap-2 text-left"
                        onClick={() => onToggleGroup?.(g.folderRelPath)}
                        title="展开/收起"
                      >
                        <div className="text-slate-400">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">
                            {g.folderRelPath}
                            <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                              {g.items.length}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {preview.join('，')}
                            {rest ? ` 等 +${rest}` : ''}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                          onClick={() => onEnterFolder?.(g.folderRelPath)}
                          title="跳转到该文件夹"
                        >
                          进入
                        </button>
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                          onClick={() => onAcceptGroup?.(g.folderRelPath)}
                          title="接受该文件夹下的全部建议并移动"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Check size={12} /> 接受
                          </span>
                        </button>
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                          onClick={() => onRejectGroup?.(g.folderRelPath)}
                          title="放弃该文件夹下的全部建议"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Ban size={12} /> 放弃
                          </span>
                        </button>
                      </div>
                    </div>

                    {open ? (
                      <div className="border-t border-slate-200">
                        {g.items.map((it) => (
                          <div key={it.sourceRelPath} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50">
                            <div className="min-w-0">
                              <div className="text-sm text-slate-800 truncate">{it.fileName || it.sourceRelPath}</div>
                              <div className="text-[11px] text-slate-400 truncate">{it.sourceRelPath}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                                onClick={() => onAcceptItem?.(it.sourceRelPath)}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <Check size={12} /> 接受
                                </span>
                              </button>
                              <button
                                type="button"
                                className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                                onClick={() => onRejectItem?.(it.sourceRelPath)}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <Ban size={12} /> 放弃
                                </span>
                              </button>
                              <button
                                type="button"
                                className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-violet-600 rounded hover:bg-violet-50 hover:border-violet-200 transition-colors"
                                onClick={() => onViewTrace?.(it.sourceRelPath)}
                                title="查看 AI 分类过程"
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <Search size={12} /> 过程
                                </span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AIGhostOverview;


