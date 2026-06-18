import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import RejectPopover from './RejectPopover.jsx';

const cls = (...parts) => parts.filter(Boolean).join(' ');

const ActionIconButton = ({ title, children, tone = 'default', onClick }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    className={cls(
      'w-7 h-7 rounded-md inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all',
      tone === 'primary'
        ? 'text-[#5e6ad2] hover:bg-[#eef0fb]'
        : tone === 'danger'
          ? 'text-rose-600 hover:bg-rose-50'
          : 'text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100',
    )}
  >
    {children}
  </button>
);

const StatusDot = ({ tone = 'muted' }) => (
  <span
    className={cls(
      'inline-block w-1.5 h-1.5 rounded-full shrink-0',
      tone === 'active' && 'bg-[#5e6ad2] shadow-[0_0_0_4px_rgba(94,106,210,0.10)]',
      tone === 'ok' && 'bg-emerald-600',
      tone === 'warn' && 'bg-amber-500',
      tone === 'muted' && 'bg-zinc-300',
    )}
  />
);

const formatConfidence = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '待确认';
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
};

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
  pipelineClassified,
  pipelineFailed,
  onClearCompleted,
}) => {
  const [rejectingItem, setRejectingItem] = useState(null);

  if (!show) return null;

  const queuedCount = pipelineQueued?.length || 0;
  const classifyingCount = pipelineClassifying?.length || 0;
  const classifiedCount = pipelineClassified?.length || 0;
  const failedCount = pipelineFailed?.length || 0;
  const processingCount = queuedCount + classifyingCount;
  const completedCount = classifiedCount + failedCount;
  const hasGroups = pendingGhostGroups.length > 0;
  const isDoneOnly = !hasGroups && processingCount === 0 && completedCount > 0;
  const isProcessingOnly = !hasGroups && processingCount > 0;

  const statusLabel = hasGroups
    ? `${pendingGhostCount} 待确认`
    : isProcessingOnly
      ? `${processingCount} 分类中`
      : isDoneOnly
        ? '本轮已完成'
        : '同步中';

  return (
    <div className="px-4 sm:px-8 pt-3">
      <div className="border-y border-zinc-200 bg-[#fcfcfc]">
        <div className="min-h-[43px] px-3 sm:px-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <button
            type="button"
            className="min-w-0 flex items-center gap-2 text-left"
            onClick={onToggleOverview}
            title={overviewOpen ? '收起 AI 分类' : '展开 AI 分类'}
          >
            <Sparkles size={18} className="text-[#5e6ad2] shrink-0" />
            <span className="text-[13px] font-semibold text-zinc-900 whitespace-nowrap">AI 分类</span>
            <span
              className={cls(
                'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border text-[11.5px] font-medium whitespace-nowrap',
                isDoneOnly
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-[#eef0fb] border-[#dadef4] text-[#5e6ad2]',
              )}
            >
              <StatusDot tone={isDoneOnly ? 'ok' : 'active'} />
              {statusLabel}
            </span>
            <span className="text-xs text-zinc-400 truncate">
              {hasGroups
                ? `${pendingGhostFolderCount} 个目标文件夹${processingCount ? ` · ${processingCount} 个文件仍在分类` : ''}`
                : isProcessingOnly
                  ? `${queuedCount} 个排队 · ${classifyingCount} 个分类中`
                  : isDoneOnly
                    ? '暂无待处理建议 · 分类状态会短暂保留'
                    : '正在同步分类状态'}
            </span>
            {ghostLoading && <span className="text-[11px] text-zinc-400 font-medium whitespace-nowrap">同步中...</span>}
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {hasGroups ? (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onAcceptAll?.(); }}
                  className="h-7 px-3 rounded-md bg-[#5e6ad2] text-white text-xs font-semibold hover:bg-[#5560c4] transition-colors"
                  title="一键接受全部（移动）"
                >
                  全部接受
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRejectAll?.(); }}
                  className="h-7 px-2.5 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                  title="一键拒绝全部"
                >
                  全部拒绝
                </button>
              </>
            ) : null}
            {isDoneOnly ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClearCompleted?.(); }}
                className="h-7 px-2.5 rounded-md text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors"
                title="清除本轮完成状态"
              >
                清除状态
              </button>
            ) : null}
            <button
              type="button"
              className="w-7 h-7 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
              title="更多"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={15} />
            </button>
            <div className="w-7 h-7 inline-flex items-center justify-center text-zinc-400">
              {overviewOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </div>
          </div>
        </div>

        {overviewOpen && hasGroups ? (
          <div className="border-t border-zinc-100">
            <div className="h-[30px] px-3 sm:px-4 grid grid-cols-[minmax(0,1.1fr)_92px_120px_112px] items-center gap-3 text-[11.5px] text-zinc-400 border-b border-zinc-100">
              <div>目标文件夹 / 预览</div>
              <div>建议</div>
              <div>状态</div>
              <div />
            </div>

            {pendingGhostGroups.map((g) => {
              const open = Boolean(overviewExpanded?.[g.folderRelPath]);
              const preview = g.items.slice(0, 3).map((x) => x.fileName || 'file');
              const rest = Math.max(0, g.items.length - preview.length);
              return (
                <div key={g.folderRelPath}>
                  <div className="group min-h-[43px] px-3 sm:px-4 grid grid-cols-[minmax(0,1.1fr)_92px_120px_112px] items-center gap-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors">
                    <button
                      type="button"
                      className="min-w-0 flex items-center gap-2 text-left"
                      onClick={() => onToggleGroup?.(g.folderRelPath)}
                      title="展开/收起"
                    >
                      <span className="text-zinc-400 shrink-0">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-zinc-900 truncate">{g.folderRelPath}</span>
                        <span className="block text-xs text-zinc-400 truncate">
                          {preview.join('，')}
                          {rest ? ` 等 +${rest}` : ''}
                        </span>
                      </span>
                    </button>
                    <div>
                      <span className="inline-flex items-center h-[22px] px-2 rounded-full border border-zinc-200 bg-white text-xs text-zinc-600">
                        {g.items.length} 个
                      </span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-xs text-[#5e6ad2]">
                      <StatusDot tone="active" />
                      待确认
                    </div>
                    <div className="justify-self-end flex items-center gap-1">
                      <ActionIconButton title="进入文件夹" onClick={() => onEnterFolder?.(g.folderRelPath)}>
                        <ExternalLink size={14} />
                      </ActionIconButton>
                      <ActionIconButton title="接受该文件夹下的全部建议并移动" tone="primary" onClick={() => onAcceptGroup?.(g.folderRelPath)}>
                        <Check size={14} strokeWidth={2.2} />
                      </ActionIconButton>
                      <ActionIconButton title="拒绝该文件夹下的全部建议" tone="danger" onClick={() => onRejectGroup?.(g.folderRelPath)}>
                        <X size={14} strokeWidth={2.2} />
                      </ActionIconButton>
                    </div>
                  </div>

                  {open ? (
                    <div className="border-b border-zinc-100 bg-[#fbfbfc]">
                      {g.items.map((it) => (
                        <div
                          key={it.sourceRelPath}
                          className="group min-h-[38px] pl-12 pr-3 sm:pr-4 grid grid-cols-[minmax(0,1.1fr)_92px_120px_112px] items-center gap-3 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-medium text-zinc-700 truncate">{it.fileName || it.sourceRelPath}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{it.sourceRelPath}</div>
                          </div>
                          <div className="text-xs text-zinc-400">temp</div>
                          <div className="inline-flex items-center gap-1.5 text-xs text-[#5e6ad2]">
                            <StatusDot tone="active" />
                            {it.confidence != null ? formatConfidence(it.confidence) : '待确认'}
                          </div>
                          <div className="justify-self-end flex items-center gap-1 relative">
                            <ActionIconButton title="接受该文件" tone="primary" onClick={() => onAcceptItem?.(it.sourceRelPath)}>
                              <Check size={14} strokeWidth={2.2} />
                            </ActionIconButton>
                            <div className="relative">
                              <ActionIconButton
                                title="拒绝该文件"
                                tone="danger"
                                onClick={() => setRejectingItem(rejectingItem === it.sourceRelPath ? null : it.sourceRelPath)}
                              >
                                <X size={14} strokeWidth={2.2} />
                              </ActionIconButton>
                              {rejectingItem === it.sourceRelPath && (
                                <RejectPopover
                                  sourceRelPath={it.sourceRelPath}
                                  onConfirm={(src, feedback) => {
                                    setRejectingItem(null);
                                    onRejectItem?.(src, { userFeedback: feedback });
                                  }}
                                  onCancel={() => setRejectingItem(null)}
                                />
                              )}
                            </div>
                            <ActionIconButton title="查看 AI 分类过程" onClick={() => onViewTrace?.(it.sourceRelPath)}>
                              <Search size={14} />
                            </ActionIconButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {overviewOpen && !hasGroups ? (
          <div className="h-[43px] px-3 sm:px-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-zinc-100 text-xs">
            <div className="min-w-0 flex items-center gap-2 text-zinc-500">
              <StatusDot tone={isProcessingOnly ? 'active' : 'ok'} />
              {isProcessingOnly ? (
                <span>
                  <span className="font-medium text-zinc-800">AI 正在分类</span>
                  <span className="text-zinc-400"> · 当前还没有可处理建议</span>
                </span>
              ) : (
                <span>
                  <span className="font-medium text-zinc-800">所有建议已处理</span>
                  <span className="text-zinc-400"> · 不再显示空列表，可继续浏览文件</span>
                </span>
              )}
            </div>
            {isDoneOnly ? (
              <button
                type="button"
                className="h-7 px-2.5 rounded-md text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors"
                onClick={onClearCompleted}
              >
                清除完成状态
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AIGhostOverview;


