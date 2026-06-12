import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Search, UploadCloud } from 'lucide-react';

function truncate(text, max = 72) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function isValidSkillName(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
}

const SkillMarketplacePanel = ({
  listRegistrySkills,
  installRegistrySkill,
  onPublish,
  onInstalled,
  cwd,
}) => {
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [rename, setRename] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listRegistrySkills?.({ q: query.trim() });
    if (res?.ok) setSkills(Array.isArray(res.skills) ? res.skills : []);
    else setError(res?.error || '组织市场加载失败');
    setLoading(false);
  }, [listRegistrySkills, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Array.isArray(skills) ? skills : [];
    if (!q) return list;
    return list.filter((s) =>
      String(s.name || '').toLowerCase().includes(q)
      || String(s.description || '').toLowerCase().includes(q)
      || String(s.slug || '').toLowerCase().includes(q)
    );
  }, [skills, query]);

  const installOne = useCallback(async (skill, opts = {}) => {
    const versionId = skill.latestVersionId;
    if (!skill?.id || !versionId) return;
    setBusyId(skill.id);
    setError(null);
    const res = await installRegistrySkill?.({
      id: skill.id,
      versionId,
      cwd,
      overwrite: Boolean(opts.overwrite),
      newName: opts.newName || undefined,
    });
    setBusyId(null);
    if (res?.ok) {
      setConflict(null);
      setRename('');
      await refresh();
      onInstalled?.(res);
      return;
    }
    if (res?.conflict === 'exists') {
      setConflict({ skill, conflictName: res.conflictName, parsedName: res.parsedName });
      setRename(res.parsedName ? `${res.parsedName}-2` : '');
      return;
    }
    setError(res?.error || '安装失败');
  }, [cwd, installRegistrySkill, onInstalled, refresh]);

  const confirmRename = useCallback(() => {
    const next = rename.trim();
    if (!conflict?.skill || !isValidSkillName(next)) return;
    void installOne(conflict.skill, { newName: next });
  }, [conflict, installOne, rename]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-2 bg-white border-b border-slate-100 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索组织市场..."
              className="w-full h-8 pl-7 pr-2 text-[12px] rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="h-8 w-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            title="刷新市场"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
        <button
          type="button"
          onClick={onPublish}
          className="w-full h-8 px-3 flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
        >
          <UploadCloud size={13} />
          发布本地技能到组织市场
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      {conflict && (
        <div className="mx-3 mt-2 p-3 rounded-lg bg-amber-50 border border-amber-100">
          <div className="flex gap-2 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div>
              本地已存在「{conflict.conflictName}」。请选择覆盖安装或改名安装。
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => installOne(conflict.skill, { overwrite: true })}
              className="h-7 px-2 rounded-md bg-rose-600 text-white text-[11px] font-medium hover:bg-rose-700"
            >
              覆盖安装
            </button>
            <input
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              className="min-w-0 flex-1 h-7 px-2 rounded-md border border-amber-200 text-[11px] bg-white"
            />
            <button
              type="button"
              onClick={confirmRename}
              disabled={!isValidSkillName(rename.trim())}
              className="h-7 px-2 rounded-md bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700 disabled:bg-slate-200"
            >
              改名安装
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {loading && visible.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-slate-400 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            正在加载组织市场...
          </div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-slate-400 leading-relaxed">
            暂无已审核且对你可见的 Skill。你可以提交本地技能，等待管理员审核。
          </div>
        ) : (
          <ul className="space-y-1">
            {visible.map((s) => {
              const installed = Boolean(s.installedVersionId);
              const canUpdate = Boolean(s.updateAvailable);
              const buttonLabel = canUpdate ? '更新' : installed ? '已安装' : '安装';
              return (
                <li key={s.id} className="p-2 rounded-lg border border-slate-100 bg-white hover:border-slate-200">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">{s.name}</span>
                        {s.latestVersion && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            {s.latestVersion}
                          </span>
                        )}
                        {installed && !canUpdate && <CheckCircle2 size={12} className="text-emerald-500" />}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{truncate(s.description)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        发布者：{s.publisherName || s.publisherId || '未知'}
                        {canUpdate && <span className="ml-2 text-amber-600">可更新：{s.installedVersion} → {s.latestVersion}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => installOne(s)}
                      disabled={busyId === s.id || (installed && !canUpdate)}
                      className={`h-7 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 ${
                        canUpdate
                          ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                          : installed
                            ? 'bg-slate-50 text-slate-400 cursor-default'
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      }`}
                    >
                      {busyId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      {buttonLabel}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SkillMarketplacePanel;
