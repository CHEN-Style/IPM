// H5: organization market skill detail modal.
//
// Opened by clicking a row in SkillMarketplacePanel. Loads the full skill
// record (version history with manifests) via `getRegistrySkill` and the
// latest SKILL.md body via `previewRegistrySkill` (downloads the package
// without installing). Version history rows show a client-computed diff
// summary against the previous version (per-file sha256 when available).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, History, Loader2, Puzzle, X } from 'lucide-react';
import { marked } from 'marked';
import { diffManifests, diffSummaryText } from './skillDiff.js';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch {
    return String(text).replace(/\n/g, '<br/>');
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SkillMarketDetailModal = ({
  open,
  skill,
  getRegistrySkill,
  previewRegistrySkill,
  onClose,
  onInstall,
  installBusy,
}) => {
  const [detail, setDetail] = useState(null);
  const [versions, setVersions] = useState([]);
  const [skillMd, setSkillMd] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!skill?.id) return;
    setLoading(true);
    setError(null);
    setSkillMd('');
    const res = await getRegistrySkill?.(skill.id);
    if (!res?.ok) {
      setError(res?.error || '加载详情失败');
      setLoading(false);
      return;
    }
    setDetail(res.skill || skill);
    const vers = Array.isArray(res.versions) ? res.versions : [];
    setVersions(vers);
    setLoading(false);

    const latestId = res.skill?.latestVersionId || vers[0]?.id;
    if (latestId && previewRegistrySkill) {
      setPreviewLoading(true);
      const preview = await previewRegistrySkill({ id: skill.id, versionId: latestId });
      if (preview?.ok) setSkillMd(preview.skillMd || '');
      setPreviewLoading(false);
    }
  }, [skill?.id, getRegistrySkill, previewRegistrySkill]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Version rows annotated with a diff against the chronologically previous
  // version. `versions` arrives newest-first from the API.
  const versionRows = useMemo(() => versions.map((v, i) => {
    const prev = versions[i + 1];
    const diff = prev ? diffManifests(prev.manifest, v.manifest) : null;
    return { ...v, diffText: diff ? diffSummaryText(diff) : '首个版本' };
  }), [versions]);

  if (!open || !skill) return null;

  const data = detail || skill;
  const installed = Boolean(data.installedVersionId);
  const canUpdate = Boolean(data.updateAvailable);
  const html = renderMarkdown(skillMd);

  return (
    <div
      className="fixed inset-0 z-[2150] flex items-center justify-center"
      style={{ background: 'rgba(15, 23, 42, 0.35)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-[min(680px,94vw)] max-h-[86vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
            <Puzzle size={18} className="text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-slate-800 truncate">{data.name}</span>
              {data.latestVersion && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                  {data.latestVersion}
                </span>
              )}
              {installed && !canUpdate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 shrink-0">已安装</span>
              )}
              {canUpdate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">
                  可更新 {data.installedVersion} → {data.latestVersion}
                </span>
              )}
            </div>
            <div className="text-[12px] text-slate-500 mt-0.5 leading-snug">{data.description}</div>
            <div className="text-[10px] text-slate-400 mt-1">
              发布者：{data.publisherName || data.publisherId || '未知'}
              {data.latestVersionCreatedAt && ` · 最近更新 ${fmtDate(data.latestVersionCreatedAt)}`}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(!installed || canUpdate) && (
              <button
                type="button"
                onClick={() => onInstall?.(data)}
                disabled={installBusy}
                className={`h-8 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 ${
                  canUpdate
                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                } disabled:opacity-60`}
              >
                {installBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {canUpdate ? '更新' : '安装'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && (
            <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-[12px] text-rose-700">
              {error}
            </div>
          )}
          {loading ? (
            <div className="px-5 py-10 text-[12px] text-slate-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              正在加载详情...
            </div>
          ) : (
            <>
              {/* SKILL.md preview */}
              <div className="px-5 py-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-2">SKILL.md</div>
                {previewLoading ? (
                  <div className="text-[12px] text-slate-400 flex items-center gap-2 py-4">
                    <Loader2 size={13} className="animate-spin" />
                    正在下载预览...
                  </div>
                ) : skillMd ? (
                  <div
                    className="prose prose-sm prose-slate max-w-none text-[13px] [&_pre]:bg-slate-50 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-[12px]"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <div className="text-[12px] text-slate-400 py-2">无法获取 SKILL.md 预览。</div>
                )}
              </div>

              {/* Version history */}
              <div className="px-5 pb-5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
                  <History size={12} />
                  版本历史
                </div>
                {versionRows.length === 0 ? (
                  <div className="text-[12px] text-slate-400">暂无版本记录。</div>
                ) : (
                  <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                    {versionRows.map((v) => (
                      <li key={v.id} className="px-3 py-2 bg-white flex items-center gap-3">
                        <span className="text-[12px] font-semibold text-slate-700 w-20 shrink-0 truncate">{v.version}</span>
                        <span className="text-[11px] text-slate-500 flex-1 min-w-0 truncate">{v.diffText}</span>
                        {v.id === data.installedVersionId && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 shrink-0">当前安装</span>
                        )}
                        <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(v.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkillMarketDetailModal;
