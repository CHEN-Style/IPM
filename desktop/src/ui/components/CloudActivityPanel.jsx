// C3: Sidebar cloud-activity panel.
//
// Shows in-flight (and recently finished) publishes so the user can minimize
// the publish modal and keep working. Clicking an item reopens its modal.
// Hidden entirely when there is no activity.

import React from 'react';
import { CloudUpload, Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { useCloudPublish } from '../hooks/useCloudPublish.jsx';

const PublishActivityRow = ({ activity, onOpen, onDismiss }) => {
  const { projectName, phase, upload } = activity;
  const isPublishing = phase === 'publishing';
  const isError = phase === 'error';
  const isDone = phase === 'done';

  const icon = isPublishing
    ? <Loader2 size={13} className="text-[#3e4b9c] animate-spin shrink-0" />
    : isError
      ? <AlertTriangle size={13} className="text-rose-500 shrink-0" />
      : <Check size={13} className="text-emerald-500 shrink-0" />;

  let statusText = '';
  if (isPublishing) {
    statusText = upload?.total ? `上传中 ${upload.current}/${upload.total}` : '发布中…';
  } else if (isError) {
    statusText = '发布失败';
  } else if (isDone) {
    statusText = activity.result?.versionNumber ? `已发布 v${activity.result.versionNumber}` : '已发布';
  }

  const pct = isPublishing && upload?.total ? Math.round((upload.current / upload.total) * 100) : (isDone ? 100 : 0);

  return (
    <div
      className="group px-2.5 py-2 rounded-lg hover:bg-slate-800/60 cursor-pointer"
      onClick={() => onOpen?.(activity.key)}
      title={projectName}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[12px] text-slate-200 truncate flex-1">{projectName}</span>
        {!isPublishing ? (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300"
            onClick={(e) => { e.stopPropagation(); onDismiss?.(activity.key); }}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 mt-1 pl-[21px]">
        <span className={`text-[10.5px] ${isError ? 'text-rose-400' : 'text-slate-400'}`}>{statusText}</span>
      </div>
      {(isPublishing || isDone) && upload?.total ? (
        <div className="mt-1.5 ml-[21px] h-1 rounded-full bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isDone ? 'bg-emerald-500' : 'bg-[#5b6ad0]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

const CloudActivityPanel = () => {
  const { activityList, reopenModal, dismissActivity } = useCloudPublish();
  const visible = activityList.filter((a) => a.phase === 'publishing' || a.phase === 'error' || a.phase === 'done');
  if (visible.length === 0) return null;

  return (
    <div className="px-2 py-2 border-t border-slate-800">
      <div className="flex items-center gap-1.5 px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <CloudUpload size={11} />
        云端活动
      </div>
      <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
        {visible.map((a) => (
          <PublishActivityRow key={a.key} activity={a} onOpen={reopenModal} onDismiss={dismissActivity} />
        ))}
      </div>
    </div>
  );
};

export default CloudActivityPanel;
