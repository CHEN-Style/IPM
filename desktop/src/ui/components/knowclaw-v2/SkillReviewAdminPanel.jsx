import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, SlidersHorizontal, XCircle } from 'lucide-react';
import SkillAccessModal from './SkillAccessModal.jsx';

const STATUS_META = {
  pending_review: { label: '待审核', cls: 'bg-amber-50 text-amber-700' },
  approved: { label: '已通过', cls: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: '已拒绝', cls: 'bg-rose-50 text-rose-700' },
  archived: { label: '已下架', cls: 'bg-slate-100 text-slate-500' },
};

function truncate(text, max = 80) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function manifestSummary(skill) {
  const manifest = skill?.latestManifest || {};
  const fileCount = Array.isArray(manifest.files) ? manifest.files.length : null;
  const manual = manifest.disableModelInvocation ? 'manual-only' : '自动可见';
  return `${fileCount == null ? '未知文件数' : `${fileCount} 个文件`} · ${manual}`;
}

const SkillReviewAdminPanel = ({
  listSkillReviewQueue,
  listOrgUsersForSkills,
  reviewRegistrySkill,
  getRegistrySkillAccess,
  setRegistrySkillAccess,
}) => {
  const [status, setStatus] = useState('');
  const [skills, setSkills] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [accessTarget, setAccessTarget] = useState(null);
  const [accessGrants, setAccessGrants] = useState([]);
  const [accessSaving, setAccessSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [queueRes, usersRes] = await Promise.all([
      listSkillReviewQueue?.({ status: status || undefined }),
      listOrgUsersForSkills?.(),
    ]);
    if (queueRes?.ok) setSkills(Array.isArray(queueRes.skills) ? queueRes.skills : []);
    else setError(queueRes?.error || '审核列表加载失败');
    if (usersRes?.ok) setOrgUsers(Array.isArray(usersRes.users) ? usersRes.users : []);
    setLoading(false);
  }, [listOrgUsersForSkills, listSkillReviewQueue, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const acc = { pending_review: 0, approved: 0, rejected: 0, archived: 0 };
    for (const s of skills) if (acc[s.status] !== undefined) acc[s.status] += 1;
    return acc;
  }, [skills]);

  const openAccess = useCallback(async (skill) => {
    setBusyId(skill.id);
    setError(null);
    const res = await getRegistrySkillAccess?.(skill.id);
    setBusyId(null);
    if (!res?.ok) {
      setError(res?.error || '访问范围加载失败');
      return;
    }
    setAccessGrants(Array.isArray(res.grants) ? res.grants : []);
    setAccessTarget(skill);
  }, [getRegistrySkillAccess]);

  const approve = useCallback((skill) => {
    setAccessGrants([{ grantType: 'org' }]);
    setAccessTarget({ ...skill, _reviewDecision: 'approved' });
  }, []);

  const reject = useCallback(async (skill) => {
    const note = window.prompt(`拒绝「${skill.name}」的原因（可留空）`, '');
    if (note === null) return;
    setBusyId(skill.id);
    setError(null);
    const res = await reviewRegistrySkill?.({ id: skill.id, decision: 'rejected', note });
    setBusyId(null);
    if (!res?.ok) {
      setError(res?.error || '拒绝失败');
      return;
    }
    await refresh();
  }, [refresh, reviewRegistrySkill]);

  const saveAccess = useCallback(async (grants) => {
    if (!accessTarget) return;
    setAccessSaving(true);
    setError(null);
    const res = accessTarget._reviewDecision === 'approved'
      ? await reviewRegistrySkill?.({ id: accessTarget.id, decision: 'approved', grants })
      : await setRegistrySkillAccess?.({ id: accessTarget.id, grants });
    setAccessSaving(false);
    if (!res?.ok) {
      setError(res?.error || '保存访问范围失败');
      return;
    }
    setAccessTarget(null);
    setAccessGrants([]);
    await refresh();
  }, [accessTarget, refresh, reviewRegistrySkill, setRegistrySkillAccess]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-2 bg-white border-b border-slate-100 space-y-2">
        <div className="flex gap-1 p-1 rounded-lg bg-slate-100">
          {[
            ['', '全部'],
            ['pending_review', '待审核'],
            ['approved', '已通过'],
            ['rejected', '已拒绝'],
          ].map(([key, label]) => (
            <button
              key={key || 'all'}
              type="button"
              onClick={() => setStatus(key)}
              className={`h-7 flex-1 rounded-md text-[11px] font-medium transition-colors ${
                status === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="w-full h-8 px-3 flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          刷新审核列表
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
            正在加载审核列表...
          </div>
        ) : skills.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-slate-400 leading-relaxed">
            当前没有需要展示的 Skill。待审核 {counts.pending_review} 个，已通过 {counts.approved} 个，已拒绝 {counts.rejected} 个。
          </div>
        ) : (
          <ul className="space-y-1">
            {skills.map((s) => {
              const meta = STATUS_META[s.status] || STATUS_META.pending_review;
              return (
                <li key={s.id} className="p-2 rounded-lg border border-slate-100 bg-white hover:border-slate-200">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">{s.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                        {s.latestVersion && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            {s.latestVersion}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{truncate(s.description)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        提交人：{s.publisherName || s.publisherId || '未知'} · {manifestSummary(s)}
                      </div>
                      {s.reviewNote && (
                        <div className="text-[10px] text-rose-500 mt-1">审核备注：{s.reviewNote}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.status === 'pending_review' && (
                      <>
                        <button
                          type="button"
                          onClick={() => approve(s)}
                          disabled={busyId === s.id}
                          className="h-7 px-2 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-medium hover:bg-emerald-100 flex items-center gap-1"
                        >
                          <CheckCircle2 size={12} />
                          通过并授权
                        </button>
                        <button
                          type="button"
                          onClick={() => reject(s)}
                          disabled={busyId === s.id}
                          className="h-7 px-2 rounded-md bg-rose-50 text-rose-700 text-[11px] font-medium hover:bg-rose-100 flex items-center gap-1"
                        >
                          <XCircle size={12} />
                          拒绝
                        </button>
                      </>
                    )}
                    {s.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() => openAccess(s)}
                        disabled={busyId === s.id}
                        className="h-7 px-2 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-medium hover:bg-indigo-100 flex items-center gap-1"
                      >
                        {busyId === s.id ? <Loader2 size={12} className="animate-spin" /> : <SlidersHorizontal size={12} />}
                        调整可见范围
                      </button>
                    )}
                    {s.status === 'approved' && (
                      <span className="h-7 px-2 rounded-md bg-slate-50 text-slate-400 text-[11px] flex items-center gap-1">
                        <ShieldCheck size={12} />
                        市场可控可见
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <SkillAccessModal
        open={Boolean(accessTarget)}
        skill={accessTarget}
        orgUsers={orgUsers}
        initialGrants={accessGrants}
        saving={accessSaving}
        onClose={() => {
          if (!accessSaving) {
            setAccessTarget(null);
            setAccessGrants([]);
          }
        }}
        onSave={saveAccess}
      />
    </div>
  );
};

export default SkillReviewAdminPanel;
