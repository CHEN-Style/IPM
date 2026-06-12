import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, UploadCloud, X } from 'lucide-react';

const versionRe = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;

const PublishSkillModal = ({
  open,
  skills,
  cwd,
  onClose,
  publishRegistrySkill,
  onPublished,
}) => {
  const publishable = useMemo(
    () => (Array.isArray(skills) ? skills : []).filter((s) => s.source !== 'builtin' && s.baseDir),
    [skills],
  );
  const [skillName, setSkillName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);

  const selected = publishable.find((s) => s.name === skillName) || publishable[0] || null;

  useEffect(() => {
    if (!open) return;
    setSkillName((prev) => prev || publishable[0]?.name || '');
    setVersion('1.0.0');
    setDescription(publishable[0]?.description || '');
    setPhase('idle');
    setError(null);
  }, [open, publishable]);

  useEffect(() => {
    if (selected) setDescription(selected.description || '');
  }, [selected?.name]);

  if (!open) return null;

  const canSubmit = selected?.baseDir && versionRe.test(version.trim()) && phase !== 'publishing';

  const submit = async () => {
    if (!canSubmit) return;
    setPhase('publishing');
    setError(null);
    const res = await publishRegistrySkill?.({
      skillDir: selected.baseDir,
      version: version.trim(),
      description: description.trim(),
      cwd: cwd || undefined,
    });
    if (res?.ok) {
      setPhase('success');
      setTimeout(() => {
        onPublished?.(res);
        onClose?.();
      }, 700);
      return;
    }
    setError(res?.error || '发布失败');
    setPhase('idle');
  };

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center"
      style={{ background: 'rgba(15, 23, 42, 0.35)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(520px,92vw)] bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <UploadCloud size={18} className="text-indigo-500" />
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-slate-800">提交 Skill 审核</div>
            <div className="text-[12px] text-slate-500 mt-0.5">管理员审核通过并设置可见范围后，成员才能在组织市场安装。</div>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {phase === 'success' ? (
          <div className="px-6 py-10 text-center">
            <CheckCircle2 size={34} className="mx-auto text-emerald-500 mb-3" />
            <div className="text-[14px] font-semibold text-slate-800">已提交审核</div>
            <div className="text-[12px] text-slate-500 mt-1">审核通过后，授权成员可在组织市场安装。</div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {publishable.length === 0 ? (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[12px] text-amber-800 flex gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                当前没有可发布的用户/导入/工作空间技能。内置技能不允许直接发布。
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="block text-[12px] font-medium text-slate-700 mb-1">选择本地 Skill</span>
                  <select
                    value={skillName || selected?.name || ''}
                    onChange={(e) => setSkillName(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-200 px-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  >
                    {publishable.map((s) => (
                      <option key={`${s.source}-${s.name}`} value={s.name}>
                        {s.name}（{s.source === 'workspace' ? '工作空间' : s.source === 'imported' ? '导入' : '用户'}）
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="block text-[12px] font-medium text-slate-700 mb-1">版本号</span>
                  <input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="例如 1.0.0"
                    className="w-full h-9 rounded-md border border-slate-200 px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  {!versionRe.test(version.trim()) && (
                    <div className="mt-1 text-[11px] text-rose-600">版本号只能包含字母、数字、点、下划线和连字符。</div>
                  )}
                </label>

                <label className="block">
                  <span className="block text-[12px] font-medium text-slate-700 mb-1">描述</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-slate-200 px-2 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
                  />
                </label>

                {error && (
                  <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] text-rose-700">
                    {error}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {phase !== 'success' && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-[12px] text-slate-600 hover:bg-slate-100">
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="h-8 px-3 rounded-md text-[12px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 flex items-center gap-1.5"
            >
              {phase === 'publishing' && <Loader2 size={13} className="animate-spin" />}
              提交审核
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublishSkillModal;
