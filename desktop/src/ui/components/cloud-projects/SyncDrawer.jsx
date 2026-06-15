import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Check, RefreshCw, UploadCloud, DownloadCloud, Flag, AlertTriangle, Loader2,
  FilePlus, FileEdit, Trash2, FileWarning, Clock, History,
} from 'lucide-react';
import SyncPreviewModal from './SyncPreviewModal.jsx';
import MilestoneModal from './MilestoneModal.jsx';

// H4.5: unified cloud-sync drawer.
//
// Single surface for everything the old SyncStatusBar banner + scattered
// buttons used to express: current sync state (with the detailed change list
// from the plan), pull / push / milestone actions, conflict guidance, readable
// errors, and the project's version history. Opens from the header cloud chip.

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

const BTN = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium transition-colors whitespace-nowrap';
const BTN_GHOST = `${BTN} bg-white text-slate-700 border border-slate-200 hover:bg-slate-50`;
const BTN_PRIMARY = `${BTN} bg-[#3e4b9c] text-white hover:bg-[#4e5bab]`;

function StateCard({ dotColor, titleColor, title, children }) {
  return (
    <div className="rounded-xl px-3.5 py-3 mb-3" style={{ border: '1px solid #e2e8f0', background: '#fff' }}>
      <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: titleColor }}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
        {title}
      </div>
      {children}
    </div>
  );
}

function VersionRow({ status }) {
  if (!status) return null;
  const items = [];
  if (status.localVersionNumber != null) items.push(['本地', `v${status.localVersionNumber}${status.hasLocalChanges ? ` +${status.localChangeCount}` : ''}`]);
  if (status.remoteVersionNumber != null) items.push(['云端', `v${status.remoteVersionNumber}`]);
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-4 mt-2 text-[11.5px] text-slate-500">
      {items.map(([k, v]) => (
        <span key={k}>{k} <b className="font-medium text-slate-700" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{v}</b></span>
      ))}
    </div>
  );
}

function ChangeRow({ icon: Icon, color, path, meta }) {
  const name = String(path || '').split('/').filter(Boolean).slice(-1)[0] || path;
  const dir = String(path || '').replace(/^\//, '').split('/').slice(0, -1).join('/');
  return (
    <div className="flex items-center gap-2 py-1.5 text-[12px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
      <Icon size={13} className="shrink-0" style={{ color }} />
      <span className="flex-1 min-w-0 truncate text-slate-700" title={path}>
        {name}
        {dir ? <span className="text-slate-400"> · {dir}/</span> : null}
      </span>
      {meta ? <span className="text-[11px] text-slate-400 shrink-0">{meta}</span> : null}
    </div>
  );
}

function SectionLabel({ children, count }) {
  return (
    <div className="flex items-center justify-between text-[11.5px] font-medium text-slate-500 pb-1.5 mt-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
      <span>{children}</span>
      {count != null ? <span className="text-slate-400 font-normal">{count}</span> : null}
    </div>
  );
}

const DRAWER_WIDTH = 372;

const SyncDrawer = ({
  open,
  projectName,
  domain,
  status,
  statusLoading,
  plan,
  planLoading,
  onRefresh,
  onAfterSync,
  onClose,
}) => {
  const [tab, setTab] = useState('status'); // 'status' | 'versions'
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(null);
  const [pullMsg, setPullMsg] = useState('');
  const [conflictCopies, setConflictCopies] = useState([]);
  const [showPush, setShowPush] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  const [versions, setVersions] = useState(null); // null until first load
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');

  // Reset transient state when switching projects.
  useEffect(() => {
    setTab('status');
    setPullMsg('');
    setConflictCopies([]);
    setVersions(null);
  }, [projectName]);

  // Drawer stays mounted while closed (for the width animation) — make sure
  // its modals don't linger after closing.
  useEffect(() => {
    if (!open) {
      setShowPush(false);
      setShowMilestone(false);
    }
  }, [open]);

  // Pull progress stream.
  useEffect(() => {
    const off = window.ipm?.cloud?.onSyncProgress?.((data) => {
      if (data?.direction === 'pull' && data?.projectName === projectName) setPullProgress(data);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [projectName]);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    setVersionsError('');
    try {
      const res = await window.ipm?.cloud?.listVersions?.({ projectName, domain });
      if (res?.ok) setVersions(res.versions || []);
      else setVersionsError(res?.error || '加载版本历史失败');
    } catch (err) {
      setVersionsError(err?.message || String(err));
    } finally {
      setVersionsLoading(false);
    }
  }, [projectName, domain]);

  useEffect(() => {
    if (tab === 'versions' && versions === null && !versionsLoading) void loadVersions();
  }, [tab, versions, versionsLoading, loadVersions]);

  const handleRefresh = useCallback(() => {
    setPullMsg('');
    onRefresh?.();
    if (tab === 'versions') void loadVersions();
  }, [onRefresh, tab, loadVersions]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    setPullMsg('');
    setPullProgress(null);
    try {
      const res = await window.ipm?.cloud?.pullUpdate?.({ projectName, domain });
      if (res?.ok) {
        const copies = res.conflictCopies || [];
        setConflictCopies(copies);
        if (copies.length > 0) {
          setPullMsg(`已拉取更新；双方修改过的 ${copies.length} 个文件已为云端版本保留副本，请对照后二选一。`);
        } else {
          setPullMsg('已拉取最新更新。');
        }
        setVersions(null); // force re-fetch on next versions view
        onAfterSync?.();
        onRefresh?.();
      } else {
        setPullMsg(res?.error || '拉取失败');
      }
    } catch (err) {
      setPullMsg(err?.message || String(err));
    } finally {
      setPulling(false);
      setPullProgress(null);
    }
  }, [projectName, domain, onAfterSync, onRefresh]);

  // ── Derived state ────────────────────────────────────────────────
  const offline = Boolean(status?.offline);
  const hasError = Boolean(status?.error) || Boolean(status?.remoteCheckFailed);
  const hasLocal = Boolean(status?.hasLocalChanges);
  const hasRemote = Boolean(status?.hasRemoteChanges);
  const archived = status?.workspaceStatus === 'archived';
  const isViewer = status?.role === 'viewer';
  const isOwner = status?.role === 'owner';
  const conflicts = plan?.conflicts || [];
  const clean = !hasLocal && !hasRemote && !hasError && !offline;

  const stateCard = useMemo(() => {
    if (!status) {
      return (
        <StateCard dotColor="#cbd5e1" titleColor="#64748b" title="正在检查云端状态…" />
      );
    }
    if (offline) {
      return (
        <StateCard dotColor="#cbd5e1" titleColor="#64748b" title="离线模式">
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">当前未登录云端，同步与版本功能不可用。登录后这里会恢复正常。</p>
        </StateCard>
      );
    }
    if (hasError && !hasLocal && !hasRemote) {
      return (
        <div className="rounded-xl px-3.5 py-3 mb-3" style={{ border: '1px solid #fecaca', background: '#fffafa' }}>
          <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: '#b91c1c' }}>
            <AlertTriangle size={14} />同步状态检查失败
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-600 break-all">{status.error || status.remoteError || '无法连接云端服务'}</p>
          <p className="mt-1 text-[12px] text-slate-500">你的本地文件不受影响。请检查网络后重试。</p>
          <div className="mt-2.5">
            <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
              <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />重试
            </button>
          </div>
        </div>
      );
    }
    if (conflicts.length > 0) {
      return (
        <StateCard dotColor="#b45309" titleColor="#b45309" title={`本地与云端同时修改了 ${conflicts.length} 个文件`}>
          <VersionRow status={status} />
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
            拉取更新会保留你的本地版本，并把云端版本另存为「冲突副本」文件；两个文件都在原目录，对照后保留其一（或改名都保留）即可。
          </p>
          <div className="flex items-center gap-1.5 mt-2.5">
            <button type="button" className={BTN_PRIMARY} onClick={handlePull} disabled={pulling}>
              {pulling ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}先拉取更新
            </button>
            <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
              <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />重新检查
            </button>
          </div>
        </StateCard>
      );
    }
    if (hasLocal && hasRemote) {
      return (
        <StateCard dotColor="#3e4b9c" titleColor="#3e4b9c" title="本地与云端均有变更">
          <VersionRow status={status} />
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">需先拉取云端更新，再推送本地变更。文件不重叠时会自动合并。</p>
          <div className="flex items-center gap-1.5 mt-2.5">
            <button type="button" className={BTN_PRIMARY} onClick={handlePull} disabled={pulling}>
              {pulling ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}先拉取更新
            </button>
          </div>
        </StateCard>
      );
    }
    if (hasRemote) {
      return (
        <StateCard dotColor="#3e4b9c" titleColor="#3e4b9c" title={`云端有新版本${status.remoteVersionNumber ? ` v${status.remoteVersionNumber}` : ''}`}>
          <VersionRow status={status} />
          <div className="flex items-center gap-1.5 mt-2.5">
            <button type="button" className={BTN_PRIMARY} onClick={handlePull} disabled={pulling}>
              {pulling ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}拉取更新
            </button>
            <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
              <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />重新检查
            </button>
          </div>
        </StateCard>
      );
    }
    if (hasLocal) {
      return (
        <StateCard dotColor="#3e4b9c" titleColor="#3e4b9c" title={`${status.localChangeCount} 个本地变更待同步`}>
          <VersionRow status={status} />
          {(archived || isViewer) ? (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: '#b45309' }}>
              {archived ? '项目已被企业归档（只读），本地变更无法推送到云端。' : '你是只读成员，本地变更无法推送到云端；协作权限需项目 Owner 开通。'}
            </p>
          ) : (
            <div className="flex items-center gap-1.5 mt-2.5">
              <button type="button" className={BTN_PRIMARY} onClick={() => setShowPush(true)}>
                <UploadCloud size={12} />同步到云端
              </button>
              <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
                <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />重新检查
              </button>
            </div>
          )}
        </StateCard>
      );
    }
    if (archived) {
      return (
        <StateCard dotColor="#b45309" titleColor="#b45309" title="已归档 · 只读">
          <VersionRow status={status} />
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">项目已被企业归档：可浏览与拉取更新，无法推送。如需恢复编辑，请联系企业管理员。</p>
          <div className="flex items-center gap-1.5 mt-2.5">
            <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
              <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />检查更新
            </button>
          </div>
        </StateCard>
      );
    }
    if (isViewer) {
      return (
        <StateCard dotColor="#94a3b8" titleColor="#475569" title={`只读成员${status.localVersionNumber ? ` · v${status.localVersionNumber}` : ''}`}>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">你可以浏览文件并拉取更新；需要编辑权限时请联系项目 Owner。</p>
          <div className="flex items-center gap-1.5 mt-2.5">
            <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
              <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />检查更新
            </button>
          </div>
        </StateCard>
      );
    }
    return (
      <StateCard dotColor="#2d7a5f" titleColor="#2d7a5f" title="已与云端同步">
        <VersionRow status={status} />
        <div className="flex items-center gap-1.5 mt-2.5">
          <button type="button" className={BTN_GHOST} onClick={handleRefresh} disabled={statusLoading}>
            <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />检查更新
          </button>
          {isOwner && (
            <button type="button" className={`${BTN} bg-white border hover:bg-amber-50/60`} style={{ borderColor: '#e2d4bd', color: '#9c733e' }} onClick={() => setShowMilestone(true)}>
              <Flag size={12} />发布里程碑
            </button>
          )}
        </div>
      </StateCard>
    );
  }, [status, offline, hasError, hasLocal, hasRemote, archived, isViewer, isOwner, conflicts.length, pulling, statusLoading, handlePull, handleRefresh]);

  const pullProgressText = pulling && pullProgress
    ? (pullProgress.step === 'downloading'
      ? `下载中 ${pullProgress.current || 0}/${pullProgress.total || 0}`
      : pullProgress.step === 'preparing' ? '准备中…' : '')
    : '';

  return (
    <>
      {/* Squeeze layout: animated-width flex child (not a floating overlay).
          The inner panel keeps a fixed width so text doesn't reflow while the
          container width animates. */}
      <div
        className="h-full shrink-0 overflow-hidden"
        style={{ width: open ? DRAWER_WIDTH : 0, transition: 'width 0.26s cubic-bezier(0.4, 0, 0.2, 1)' }}
        aria-hidden={!open}
      >
      <aside
        className="h-full flex flex-col bg-white"
        style={{ width: DRAWER_WIDTH, borderLeft: '1px solid #e2e4eb' }}
      >
        {/* Head */}
        <div className="flex items-center justify-between px-4 h-11 shrink-0" style={{ borderBottom: '1px solid #eef0f4' }}>
          <span className="text-[13px] font-semibold text-slate-800">云端同步</span>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" title="收起">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid #f1f5f9' }}>
          {[['status', '状态'], ['versions', '版本']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${tab === k ? 'bg-[#eceef7] text-[#3e4b9c] font-medium' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5">
          {tab === 'status' ? (
            <>
              {stateCard}

              {(pullMsg || pullProgressText) && (
                <div className="mb-3 px-3 py-2 rounded-lg text-[12px] leading-relaxed" style={{ background: '#f6f8fb', border: '1px solid #e6e9f2', color: '#475569' }}>
                  {pullProgressText || pullMsg}
                </div>
              )}

              {conflictCopies.length > 0 && (
                <div className="mb-3 rounded-xl px-3.5 py-3" style={{ border: '1px solid #fde9c8', background: '#fffdf8' }}>
                  <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#b45309' }}>
                    <FileWarning size={13} />已保留 {conflictCopies.length} 个冲突副本
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {conflictCopies.map((c) => (
                      <div key={c.conflictPath} className="text-[11.5px] text-slate-600 truncate" title={c.conflictPath}>· {String(c.conflictPath || '').replace(/^\//, '')}</div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">原文件保持你的本地版本；对照副本后删除多余文件即可（两个都保留也可以，把副本改名即可）。</p>
                </div>
              )}

              {/* Change lists from the plan */}
              {planLoading && (
                <div className="flex items-center gap-2 py-3 text-[12px] text-slate-400">
                  <Loader2 size={13} className="animate-spin" />正在计算变更清单…
                </div>
              )}
              {!planLoading && plan && conflicts.length > 0 && (
                <>
                  <SectionLabel count={conflicts.length}>冲突文件</SectionLabel>
                  {conflicts.map((c) => (
                    <ChangeRow
                      key={c.path}
                      icon={AlertTriangle}
                      color="#b45309"
                      path={c.path}
                      meta={c.kind === 'local_edit_remote_delete' ? '本地改 / 云端删'
                        : c.kind === 'local_delete_remote_edit' ? '本地删 / 云端改'
                          : '双方修改'}
                    />
                  ))}
                </>
              )}
              {!planLoading && plan && (plan.toPush?.newFiles?.length || 0) + (plan.toPush?.updatedFiles?.length || 0) + (plan.toPush?.softDeleted?.length || 0) > 0 && (
                <>
                  <SectionLabel count={(plan.toPush.newFiles.length || 0) + (plan.toPush.updatedFiles.length || 0) + (plan.toPush.softDeleted.length || 0)}>本地变更</SectionLabel>
                  {plan.toPush.newFiles.map((f) => (
                    <ChangeRow key={f.path} icon={FilePlus} color="#2d7a5f" path={f.path} meta={`新增${f.sizeBytes != null ? ` · ${fmtSize(f.sizeBytes)}` : ''}`} />
                  ))}
                  {plan.toPush.updatedFiles.map((f) => (
                    <ChangeRow key={f.path} icon={FileEdit} color="#3e4b9c" path={f.path} meta={`修改${f.sizeBytes != null ? ` · ${fmtSize(f.sizeBytes)}` : ''}`} />
                  ))}
                  {plan.toPush.softDeleted.map((f) => (
                    <ChangeRow key={f.path} icon={Trash2} color="#b91c1c" path={f.path} meta="删除" />
                  ))}
                </>
              )}
              {!planLoading && plan && (plan.toPull?.updatedFiles?.length || 0) + (plan.toPull?.newFiles?.length || 0) + (plan.toPull?.remoteDeleted?.length || 0) > 0 && (
                <>
                  <SectionLabel count={(plan.toPull.newFiles?.length || 0) + (plan.toPull.updatedFiles?.length || 0) + (plan.toPull.remoteDeleted?.length || 0)}>云端变更（拉取后生效）</SectionLabel>
                  {(plan.toPull.newFiles || []).map((f) => (
                    <ChangeRow key={f.path} icon={FilePlus} color="#2d7a5f" path={f.path} meta="云端新增" />
                  ))}
                  {(plan.toPull.updatedFiles || []).map((f) => (
                    <ChangeRow key={f.path} icon={FileEdit} color="#3e4b9c" path={f.path} meta="云端修改" />
                  ))}
                  {(plan.toPull.remoteDeleted || []).map((f) => (
                    <ChangeRow key={f.path} icon={Trash2} color="#94a3b8" path={f.path} meta={f.deletedBy ? `${f.deletedBy} 已删除` : '云端已删除'} />
                  ))}
                </>
              )}

              {clean && status && !statusLoading && (
                <p className="text-[11.5px] leading-relaxed text-slate-400 mt-1">
                  同步是显式操作：你的修改不会自动上传。文件历史与恢复在文件右键菜单中。
                </p>
              )}
            </>
          ) : (
            <>
              {versionsLoading && (
                <div className="flex items-center gap-2 py-4 text-[12px] text-slate-400">
                  <Loader2 size={13} className="animate-spin" />加载版本历史…
                </div>
              )}
              {!versionsLoading && versionsError && (
                <div className="px-3 py-2 rounded-lg text-[12px]" style={{ background: '#fffafa', border: '1px solid #fecaca', color: '#b91c1c' }}>
                  {versionsError}
                </div>
              )}
              {!versionsLoading && !versionsError && (versions || []).length === 0 && (
                <div className="py-8 text-center text-[12px] text-slate-400">还没有版本记录</div>
              )}
              {!versionsLoading && (versions || []).map((v) => {
                const isCurrent = status?.localVersionNumber != null && v.versionNumber === status.localVersionNumber;
                const isMilestone = v.type === 'milestone';
                return (
                  <div key={v.id} className="flex items-start gap-2.5 py-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <span
                      className="shrink-0 mt-0.5 text-[11.5px] w-9"
                      style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: isMilestone ? '#9c733e' : '#94a3b8' }}
                    >
                      v{v.versionNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isMilestone && <Flag size={11} className="shrink-0" style={{ color: '#9c733e' }} />}
                        <span className="text-[12px] text-slate-700 truncate" title={v.label || v.message}>
                          {v.label || v.message || '同步更新'}
                        </span>
                        {isCurrent && (
                          <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 rounded-full" style={{ color: '#2d7a5f', border: '1px solid #cfe7db' }}>
                            <Check size={9} />本地
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-400">
                        <Clock size={10} />
                        {v.authorName || '未知用户'} · {fmtWhen(v.createdAt)}{v.entryCount != null ? ` · ${v.entryCount} 个文件` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!versionsLoading && (versions || []).length > 0 && (
                <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-slate-400 mt-3">
                  <History size={12} className="shrink-0 mt-0.5" />
                  要恢复单个文件到某个历史版本：在文件上右键 →「查看历史/恢复文件」。
                </p>
              )}
            </>
          )}
        </div>
      </aside>
      </div>

      {showPush && (
        <SyncPreviewModal
          projectName={projectName}
          domain={domain}
          onClose={() => setShowPush(false)}
          onPushed={() => {
            setPullMsg('已同步到云端。');
            setVersions(null);
            onAfterSync?.();
            onRefresh?.();
          }}
        />
      )}
      {showMilestone && (
        <MilestoneModal
          projectName={projectName}
          domain={domain}
          onClose={() => setShowMilestone(false)}
          onCreated={() => {
            setPullMsg('已发布里程碑版本。');
            setVersions(null);
            onRefresh?.();
          }}
        />
      )}
    </>
  );
};

export default SyncDrawer;
