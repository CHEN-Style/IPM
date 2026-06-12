import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';

const SkillAccessModal = ({
  open,
  skill,
  orgUsers,
  initialGrants,
  onClose,
  onSave,
  saving,
}) => {
  const [mode, setMode] = useState('org');
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    const grants = Array.isArray(initialGrants) ? initialGrants : [];
    const hasOrg = grants.some((g) => g.grantType === 'org' || g.grant_type === 'org');
    setMode(hasOrg ? 'org' : 'users');
    setSelected(new Set(grants.map((g) => g.userId || g.user_id).filter(Boolean)));
  }, [open, initialGrants]);

  const users = useMemo(
    () => (Array.isArray(orgUsers) ? orgUsers : []).filter((u) => u?.id),
    [orgUsers],
  );

  if (!open || !skill) return null;

  const toggleUser = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = () => {
    const grants = mode === 'org'
      ? [{ grantType: 'org' }]
      : [...selected].map((userId) => ({ grantType: 'user', userId }));
    onSave?.(grants);
  };

  const canSave = mode === 'org' || selected.size > 0;

  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center"
      style={{ background: 'rgba(15, 23, 42, 0.35)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(520px,92vw)] max-h-[80vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold text-slate-800">设置可见范围</div>
            <div className="text-[12px] text-slate-500 mt-0.5 truncate">{skill.name}</div>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 cursor-pointer">
            <input type="radio" checked={mode === 'org'} onChange={() => setMode('org')} className="mt-1" />
            <span>
              <span className="block text-[13px] font-medium text-slate-800">全组织可见</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">组织内所有成员都能在市场中看到并安装。</span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 cursor-pointer">
            <input type="radio" checked={mode === 'users'} onChange={() => setMode('users')} className="mt-1" />
            <span>
              <span className="block text-[13px] font-medium text-slate-800">指定用户可见</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">只有被勾选的账号能看到并安装。</span>
            </span>
          </label>

          {mode === 'users' && (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              {users.length === 0 ? (
                <div className="px-3 py-4 text-[12px] text-slate-400">暂无可选组织成员。</div>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => toggleUser(u.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium text-slate-800 truncate">{u.displayName || u.email}</span>
                        <span className="block text-[10px] text-slate-400 truncate">{u.email} · {u.role}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-[12px] text-slate-600 hover:bg-slate-100">
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || saving}
            className="h-8 px-3 rounded-md text-[12px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 flex items-center gap-1.5"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SkillAccessModal;
