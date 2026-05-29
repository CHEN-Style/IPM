// desktop/src/ui/components/knowclaw-v2/ImportSkillModal.jsx
//
// SK2: external skill import dialog. Two tabs:
//
//   1. 本地目录   — native folder picker -> preview card -> import.
//                   On name conflict, the card morphs into a three-way
//                   picker (overwrite / rename / cancel).
//
//   2. 外部工具   — auto-scans Claude Code / Cursor skill roots,
//                   shows a multi-select list grouped by provider,
//                   batch-imports selected skills.
//
// The modal lives at z-2000 (above SkillDetailModal's z-index space —
// they never coexist) and exits on backdrop click, Escape key, or the
// X button. Mounting is controlled by the parent (`open` prop) so the
// modal can fade in / out without remounting state mid-import.
//
// Layout principle: header + tabbar + body, with the body being the
// only flex-1 region. Each tab is responsible for its own scroll, so
// the modal frame never scrolls itself.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  FolderOpen,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Folder,
  FileText,
  RefreshCw,
  ShieldAlert,
  ArrowLeft,
  Check,
  Sparkles,
} from 'lucide-react';

// ----------------------------------------------------------------------
// Helpers

function isValidSkillName(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
}

function classNames(...xs) {
  return xs.filter(Boolean).join(' ');
}

function truncate(text, max = 80) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max) + '…';
}

// Provider visual config. Anchored on the `provider` string returned by
// the main process `scanExternalSkills` IPC (currently 'claude' or
// 'cursor'). Unknown providers fall back to a neutral slate badge.
const PROVIDER_META = {
  claude: {
    label: 'Claude Code',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  cursor: {
    label: 'Cursor',
    badgeClass: 'bg-violet-50 text-violet-700 border border-violet-200',
  },
};

const PROVIDER_FALLBACK = {
  label: '其他',
  badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
};

function getProviderMeta(provider) {
  return PROVIDER_META[provider] || { ...PROVIDER_FALLBACK, label: provider || '未知' };
}

// ============================================================================
// Tab 1 — 本地目录
// ============================================================================
//
// State machine:
//   idle       -> no folder picked yet
//   loading    -> chooseDir IPC in flight
//   preview    -> have preview, awaiting confirm
//   importing  -> import IPC in flight
//   conflict   -> import returned conflict, show three-way picker
//   success    -> imported, show success card (auto-close after delay)

function LocalDirTab({ chooseSkillDir, importSkill, onDone }) {
  const [phase, setPhase] = useState('idle');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [conflictName, setConflictName] = useState('');
  const [renameInput, setRenameInput] = useState('');
  const [renameError, setRenameError] = useState(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setPreview(null);
    setError(null);
    setConflictName('');
    setRenameInput('');
    setRenameError(null);
  }, []);

  const handlePickFolder = useCallback(async () => {
    setError(null);
    setPhase('loading');
    const res = await chooseSkillDir();
    if (!res?.ok) {
      if (res?.canceled) {
        setPhase('idle');
        return;
      }
      setError(res?.error || '目录选择失败');
      setPhase('idle');
      return;
    }
    setPreview(res);
    setPhase('preview');
  }, [chooseSkillDir]);

  // Shared post-import handler (used by all three confirm paths).
  const handleImportResult = useCallback((res) => {
    if (res?.ok) {
      setPhase('success');
      // Notify parent after a short delay so the user sees the
      // success state for a beat.
      setTimeout(() => {
        onDone?.(res);
        reset();
      }, 900);
      return;
    }
    if (res?.conflict === 'exists') {
      setConflictName(res.conflictName || res.parsedName || preview?.name || '');
      // Pre-fill the rename input with the original name + a numeric
      // suffix so the user has a sensible starting point.
      const base = res.parsedName || preview?.name || '';
      setRenameInput(base ? `${base}-2` : '');
      setRenameError(null);
      setPhase('conflict');
      return;
    }
    if (res?.conflict === 'builtin') {
      setError(`内置技能已占用名称 "${res.conflictName || preview?.name}"，请改名后再导入。`);
      setPhase('preview');
      return;
    }
    setError(res?.error || '导入失败');
    setPhase('preview');
  }, [onDone, preview, reset]);

  const handleConfirmImport = useCallback(async () => {
    if (!preview?.dir) return;
    setError(null);
    setPhase('importing');
    const res = await importSkill(preview.dir, {});
    handleImportResult(res);
  }, [importSkill, preview, handleImportResult]);

  const handleOverwrite = useCallback(async () => {
    if (!preview?.dir) return;
    setError(null);
    setPhase('importing');
    const res = await importSkill(preview.dir, { overwrite: true });
    handleImportResult(res);
  }, [importSkill, preview, handleImportResult]);

  const handleRename = useCallback(async () => {
    if (!preview?.dir) return;
    const trimmed = renameInput.trim();
    if (!isValidSkillName(trimmed)) {
      setRenameError('名称只能包含小写字母、数字、连字符，长度 1-64');
      return;
    }
    setRenameError(null);
    setError(null);
    setPhase('importing');
    const res = await importSkill(preview.dir, { newName: trimmed });
    handleImportResult(res);
  }, [importSkill, preview, renameInput, handleImportResult]);

  // ----- Render -----

  if (phase === 'success') {
    return (
      <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
        <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
          <CheckCircle2 size={28} className="text-emerald-500" />
        </div>
        <div className="text-[15px] font-semibold text-slate-800 mb-1">导入成功</div>
        <div className="text-[12px] text-slate-500">下次新对话起生效</div>
      </div>
    );
  }

  if (phase === 'conflict') {
    return (
      <div className="px-6 py-5">
        <div className="mb-4 flex items-start gap-2">
          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-semibold text-slate-800">技能名称冲突</div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              用户目录下已存在名为「<span className="text-slate-700 font-medium">{conflictName}</span>」的技能。请选择处理方式：
            </div>
          </div>
        </div>

        {/* Overwrite */}
        <div className="rounded-lg border border-rose-100 bg-rose-50/40 p-3 mb-3">
          <div className="text-[12px] font-semibold text-rose-700 mb-1">覆盖现有技能</div>
          <div className="text-[11px] text-rose-600/80 mb-2">
            将删除现有同名技能目录，导入新版本。操作不可撤销。
          </div>
          <button
            type="button"
            onClick={handleOverwrite}
            className="h-8 px-3 text-[12px] font-medium rounded-md bg-rose-600 hover:bg-rose-700 text-white transition-colors"
          >
            覆盖导入
          </button>
        </div>

        {/* Rename */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-3">
          <div className="text-[12px] font-semibold text-slate-700 mb-1">使用新名称导入</div>
          <div className="text-[11px] text-slate-500 mb-2">
            将 SKILL.md 中的 name 字段更新为新名称后导入。
          </div>
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              value={renameInput}
              onChange={(e) => {
                setRenameInput(e.target.value);
                if (renameError) setRenameError(null);
              }}
              placeholder="小写字母 / 数字 / 连字符"
              className={classNames(
                'flex-1 h-8 px-2 text-[12px] rounded-md border bg-slate-50 focus:bg-white focus:outline-none focus:ring-2',
                renameError
                  ? 'border-rose-300 focus:ring-rose-200'
                  : 'border-slate-200 focus:ring-indigo-200 focus:border-indigo-300',
              )}
            />
            <button
              type="button"
              onClick={handleRename}
              disabled={!renameInput.trim()}
              className="h-8 px-3 text-[12px] font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white transition-colors"
            >
              重命名导入
            </button>
          </div>
          {renameError && (
            <div className="text-[11px] text-rose-600 mt-1">{renameError}</div>
          )}
        </div>

        {/* Cancel (go back to preview) */}
        <button
          type="button"
          onClick={() => {
            setPhase('preview');
            setError(null);
          }}
          className="w-full h-8 px-3 text-[12px] font-medium rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5"
        >
          <ArrowLeft size={13} />
          返回预览
        </button>
      </div>
    );
  }

  // idle / loading / preview / importing share the same layout
  return (
    <div className="px-6 py-5">
      {/* Pick folder button — always at the top so users can change
          selection from any state. */}
      <div className="mb-4">
        <button
          type="button"
          onClick={handlePickFolder}
          disabled={phase === 'loading' || phase === 'importing'}
          className="w-full h-10 px-4 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors text-[13px] font-medium text-slate-600 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FolderOpen size={14} />
          )}
          {preview ? '重新选择文件夹' : '选择文件夹...'}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-[12px] text-rose-700 flex items-start gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {/* Preview header */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-indigo-500 shrink-0" />
              <span className="text-[14px] font-semibold text-slate-800 truncate">
                {preview.name}
              </span>
              {!preview.nameValid && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 shrink-0"
                  title="名称不符合 Agent Skills 规范，导入时需要重命名"
                >
                  名称非法
                </span>
              )}
              {preview.disableModelInvocation && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                  manual-only
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 leading-snug">
              {preview.description || (
                <span className="text-rose-500">缺少 description 字段（导入将失败）</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5 truncate" title={preview.dir}>
              {preview.dir}
            </div>
          </div>

          {/* File listing (shallow) */}
          {Array.isArray(preview.files) && preview.files.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
                文件清单（仅一级）
              </div>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {preview.files.slice(0, 20).map((f) => (
                  <li
                    key={f.name}
                    className="text-[11px] text-slate-600 flex items-center gap-1 truncate"
                    title={f.name}
                  >
                    {f.isDir ? (
                      <Folder size={11} className="text-slate-400 shrink-0" />
                    ) : (
                      <FileText size={11} className="text-slate-400 shrink-0" />
                    )}
                    <span className="truncate">{f.name}</span>
                  </li>
                ))}
                {preview.files.length > 20 && (
                  <li className="text-[11px] text-slate-400">
                    ...及其他 {preview.files.length - 20} 项
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Confirm button */}
          <div className="px-4 py-3 bg-white">
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={
                phase === 'importing'
                || !preview.hasDescription
              }
              className="w-full h-9 px-4 flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white transition-colors"
            >
              {phase === 'importing' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  正在导入...
                </>
              ) : (
                <>
                  <Check size={14} />
                  确认导入
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {!preview && !error && phase !== 'loading' && (
        <div className="mt-4 px-4 py-6 rounded-lg border border-slate-100 bg-slate-50/50 text-center">
          <FolderOpen size={20} className="mx-auto text-slate-300 mb-2" />
          <div className="text-[12px] text-slate-500">
            选择一个包含 <code className="px-1 rounded bg-slate-200 text-slate-700">SKILL.md</code> 的文件夹
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            支持 Claude Code / Cursor 等 Agent Skills 规范的技能目录
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tab 2 — 外部工具
// ============================================================================

function ExternalToolsTab({ scanExternalSkills, importSkill, onDone }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Selection: Map<sourceIndex+name, { provider, srcDir, name }>
  // Keyed by a synthetic id so we can survive sources re-loading.
  const [selected, setSelected] = useState(() => new Map());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: [] });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Map());
    setProgress({ done: 0, total: 0, failed: [] });
    const res = await scanExternalSkills();
    if (!res?.ok) {
      setError(res?.error || '扫描失败');
      setSources([]);
    } else {
      setSources(Array.isArray(res.sources) ? res.sources : []);
    }
    setLoading(false);
  }, [scanExternalSkills]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Flatten the visible skills (excluding already-imported ones) so we
  // know the total count + can "select all" cleanly.
  const flatSkills = useMemo(() => {
    const out = [];
    for (const source of sources) {
      for (const skill of source.skills || []) {
        out.push({
          provider: source.provider,
          providerRoot: source.path,
          name: skill.name,
          description: skill.description,
          baseDir: skill.baseDir,
          alreadyImported: Boolean(skill.alreadyImported),
          disableModelInvocation: Boolean(skill.disableModelInvocation),
        });
      }
    }
    return out;
  }, [sources]);

  const selectableSkills = useMemo(
    () => flatSkills.filter((s) => !s.alreadyImported),
    [flatSkills],
  );

  const allSelected = selectableSkills.length > 0
    && selectableSkills.every((s) => selected.has(`${s.provider}::${s.baseDir}`));

  const toggleOne = useCallback((skill) => {
    if (skill.alreadyImported) return;
    const key = `${skill.provider}::${skill.baseDir}`;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, skill);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Map());
    } else {
      const next = new Map();
      for (const s of selectableSkills) {
        next.set(`${s.provider}::${s.baseDir}`, s);
      }
      setSelected(next);
    }
  }, [allSelected, selectableSkills]);

  const handleBatchImport = useCallback(async () => {
    const items = [...selected.values()];
    if (items.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: items.length, failed: [] });

    const failed = [];
    let succeededCount = 0;
    for (let i = 0; i < items.length; i += 1) {
      const skill = items[i];
      // Note: name conflicts in batch mode default to skipping the
      // skill (with `overwrite: false`). We surface failures at the end
      // so the user can deal with them one-by-one in Tab 1.
      // eslint-disable-next-line no-await-in-loop
      const res = await importSkill(skill.baseDir, {});
      if (res?.ok) {
        succeededCount += 1;
      } else {
        failed.push({ name: skill.name, reason: res?.conflict || res?.error || '失败' });
      }
      setProgress({ done: i + 1, total: items.length, failed: [...failed] });
    }

    setImporting(false);

    // If any succeeded, notify parent so it can refresh the panel.
    // We don't auto-close the modal because the user might want to
    // see the failure list.
    if (succeededCount > 0) {
      onDone?.({ ok: true, batch: true, count: succeededCount, failed });
    }

    // Clear selections for successfully imported skills + refresh the
    // list so newly-imported ones show "已导入".
    setSelected(new Map());
    await refresh();
  }, [selected, importSkill, onDone, refresh]);

  // ----- Render -----

  return (
    <div className="flex flex-col h-full">
      {/* Security banner */}
      <div className="shrink-0 mx-6 mt-4 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-700 flex items-start gap-2">
        <ShieldAlert size={13} className="shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">安全提示：</span>
          技能可指示 AI 执行任意操作。请仅导入可信来源的技能。
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 px-6 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          disabled={loading || importing}
          className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="重新扫描外部工具目录"
        >
          {loading
            ? <Loader2 size={11} className="animate-spin" />
            : <RefreshCw size={11} />}
          重新扫描
        </button>
        <div className="flex-1" />
        {selectableSkills.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            disabled={importing}
            className="h-7 px-2 text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-3">
        {loading ? (
          <div className="py-10 flex flex-col items-center text-slate-400 text-[12px]">
            <Loader2 size={18} className="animate-spin mb-2" />
            正在扫描外部工具目录...
          </div>
        ) : error ? (
          <div className="px-3 py-3 rounded-lg border border-rose-200 bg-rose-50 text-[12px] text-rose-700 flex items-start gap-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        ) : flatSkills.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-slate-400">
            <Folder size={20} className="mx-auto text-slate-300 mb-2" />
            <div className="font-medium text-slate-500 mb-1">未发现可导入的外部技能</div>
            <div className="text-[11px]">
              请确认 <code className="px-1 rounded bg-slate-100">~/.claude/skills/</code> 或{' '}
              <code className="px-1 rounded bg-slate-100">~/.cursor/skills-cursor/</code> 下存在合法技能。
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map((source) => {
              if (!source.skills?.length) return null;
              const meta = getProviderMeta(source.provider);
              return (
                <div key={source.path} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <span className={classNames('text-[10px] px-1.5 py-0.5 rounded font-medium', meta.badgeClass)}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate flex-1" title={source.path}>
                      {source.path}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {source.skills.length} 项
                    </span>
                  </div>
                  <ul>
                    {source.skills.map((skill) => {
                      const key = `${source.provider}::${skill.baseDir}`;
                      const isSelected = selected.has(key);
                      const disabled = Boolean(skill.alreadyImported) || importing;
                      return (
                        <li
                          key={key}
                          className={classNames(
                            'px-3 py-2 flex items-start gap-2 border-b border-slate-50 last:border-b-0 transition-colors',
                            disabled ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50',
                          )}
                          onClick={() => !disabled && toggleOne({
                            provider: source.provider,
                            providerRoot: source.path,
                            name: skill.name,
                            description: skill.description,
                            baseDir: skill.baseDir,
                            alreadyImported: skill.alreadyImported,
                            disableModelInvocation: skill.disableModelInvocation,
                          })}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={disabled}
                            readOnly
                            className="mt-0.5 shrink-0 h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-300"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[12px] font-medium text-slate-800 truncate">
                                {skill.name}
                              </span>
                              {skill.alreadyImported && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                  已导入
                                </span>
                              )}
                              {skill.disableModelInvocation && (
                                <span className="text-[10px] px-1 rounded bg-slate-100 text-slate-600 shrink-0">
                                  manual
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                              {truncate(skill.description, 100)}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {/* Progress / batch result summary */}
        {progress.total > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
            <div className="text-[11px] text-slate-600 mb-1">
              批量导入进度：{progress.done} / {progress.total}
            </div>
            <div className="h-1 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-1 bg-indigo-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            {progress.failed.length > 0 && (
              <div className="mt-2 text-[11px] text-rose-600">
                失败 {progress.failed.length} 项：
                {progress.failed.slice(0, 3).map((f) => f.name).join(', ')}
                {progress.failed.length > 3 && '...'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="shrink-0 px-6 py-3 border-t border-slate-100 bg-white flex items-center gap-2">
        <div className="text-[11px] text-slate-500">
          已选择 <span className="font-semibold text-slate-700">{selected.size}</span> 项
          {selectableSkills.length > 0 && (
            <span className="text-slate-400"> / 共 {selectableSkills.length} 项可导入</span>
          )}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleBatchImport}
          disabled={selected.size === 0 || importing}
          className="h-9 px-4 flex items-center justify-center gap-2 rounded-lg text-[12px] font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white transition-colors"
        >
          {importing ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              导入中 ({progress.done}/{progress.total})
            </>
          ) : (
            <>
              <Check size={13} />
              导入选中 ({selected.size})
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Modal shell
// ============================================================================

const TABS = [
  { key: 'local', label: '本地目录' },
  { key: 'external', label: '外部工具' },
];

const ImportSkillModal = ({
  open,
  onClose,
  onImported,
  importSkill,
  scanExternalSkills,
  chooseSkillDir,
}) => {
  const [activeTab, setActiveTab] = useState('local');

  // Reset to default tab whenever the modal opens, so the user always
  // starts from "本地目录" — the safer / more controlled path.
  useEffect(() => {
    if (open) setActiveTab('local');
  }, [open]);

  // Escape closes the modal. Matches every other modal in this app.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleDone = useCallback((res) => {
    onImported?.(res);
    // Local-dir tab auto-closes after success; external tab does NOT
    // (user might want to see failures or import more). We let each
    // tab decide via the callback contract.
  }, [onImported]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{
        background: 'rgba(15, 23, 42, 0.35)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        className="w-[min(680px,92vw)] h-[min(640px,85vh)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
            <FolderOpen size={16} className="text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-800">导入外部技能</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              从本地目录或 Claude Code / Cursor 等外部工具导入符合 Agent Skills 规范的技能
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            title="关闭（Esc）"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="shrink-0 px-6 border-b border-slate-100 bg-white">
          <div className="flex gap-1">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={classNames(
                    'relative h-9 px-3 text-[12px] font-medium transition-colors',
                    active
                      ? 'text-indigo-600'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {tab.label}
                  {active && (
                    <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-indigo-500 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body — each tab owns its scroll behaviour */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === 'local' && (
            <div className="h-full overflow-y-auto">
              <LocalDirTab
                chooseSkillDir={chooseSkillDir}
                importSkill={importSkill}
                onDone={handleDone}
              />
            </div>
          )}
          {activeTab === 'external' && (
            <ExternalToolsTab
              scanExternalSkills={scanExternalSkills}
              importSkill={importSkill}
              onDone={handleDone}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportSkillModal;
