// H5: "我的提交" tab inside SkillManagerPanel.
//
// Lists every skill the current user has published to the org registry,
// regardless of review state, so members can track pending reviews and see
// rejection reasons without pinging an admin. "提交新版本" reopens the
// publish modal pre-targeted at the skill's slug (server-side the publish
// endpoint upserts by slug, so it lands as a new pending version).

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, RefreshCw, UploadCloud, XCircle, Archive } from 'lucide-react';

const STATUS_META = {
  pending_review: { label: '待审核', cls: 'bg-amber-50 text-amber-700', Icon: Clock3 },
  approved: { label: '已上架', cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  rejected: { label: '已拒绝', cls: 'bg-rose-50 text-rose-700', Icon: XCircle },
  archived: { label: '已归档', cls: 'bg-slate-100 text-slate-500', Icon: Archive },
};

function truncate(text, max = 72) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max) + '…';
}

const MySubmissionsPanel = ({ listMineRegistrySkills, onSubmitNewVersion }) => {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listMineRegistrySkills?.();
    if (res?.ok) setSkills(Array.isArray(res.skills) ? res.skills : []);
    else setError(res?.error || '我的提交加载失败');
    setLoading(false);
  }, [listMineRegistrySkills]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-2 bg-white border-b border-slate-100">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="w-full h-8 px-3 flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          刷新我的提交
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {loading && skills.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-slate-400 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            正在加载我的提交...
          </div>
        ) : skills.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-slate-400 leading-relaxed">
            你还没有向组织市场提交过技能。切到「组织市场」Tab 可以发布本地技能。
          </div>
        ) : (
          <ul className="space-y-1">
            {skills.map((s) => {
              const meta = STATUS_META[s.status] || STATUS_META.pending_review;
              const { Icon } = meta;
              return (
                <li key={s.id} className="p-2 rounded-lg border border-slate-100 bg-white hover:border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{s.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 ${meta.cls}`}>
                      <Icon size={10} />
                      {meta.label}
                    </span>
                    {s.latestVersion && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                        {s.latestVersion}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{truncate(s.description)}</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {s.status === 'approved' && `安装 ${s.installCount ?? 0} 人`}
                    {s.status === 'pending_review' && '等待管理员审核'}
                    {s.status === 'archived' && '已被管理员归档，市场不可见'}
                    {s.status === 'rejected' && (s.reviewerName ? `由 ${s.reviewerName} 拒绝` : '已被拒绝')}
                  </div>
                  {s.status === 'rejected' && s.reviewNote && (
                    <div className="mt-1.5 px-2 py-1.5 rounded-md bg-rose-50 border border-rose-100 text-[11px] text-rose-700 leading-snug">
                      拒绝原因：{s.reviewNote}
                    </div>
                  )}
                  {s.status !== 'archived' && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => onSubmitNewVersion?.(s)}
                        className="h-7 px-2 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-medium hover:bg-indigo-100 flex items-center gap-1"
                      >
                        <UploadCloud size={12} />
                        提交新版本
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MySubmissionsPanel;
