import React, { useCallback, useEffect, useState } from 'react';
import {
  Cloud, UploadCloud, DownloadCloud, Check, Loader2, Flag, RefreshCw, AlertTriangle, FileWarning,
} from 'lucide-react';
import SyncPreviewModal from './SyncPreviewModal.jsx';
import MilestoneModal from './MilestoneModal.jsx';
import ConflictCopiesModal from './ConflictCopiesModal.jsx';

// C5: Per-project sync banner.
//
// Shown under the header when the current project is bound to the cloud. Polls
// the lightweight sync-status, surfaces "N unsynced changes / cloud has updates"
// and drives push (via SyncPreviewModal), pull-update, and milestone creation.

const SyncStatusBar = ({ projectName, domain, onAfterSync }) => {
  const [status, setStatus] = useState(null); // null until first load
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  const [showConflictCopies, setShowConflictCopies] = useState(false);
  const [conflictCopies, setConflictCopies] = useState([]);
  const [pullMsg, setPullMsg] = useState('');

  const refresh = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    try {
      const res = await window.ipm?.cloud?.getSyncStatus?.({ projectName, domain });
      if (res?.ok && res.bound) {
        setStatus(res);
      } else if (res?.bound === false) {
        setStatus({ bound: false });
      } else {
        // API error — mark it so the UI can show a warning rather than
        // silently displaying "已与云端同步".
        setStatus({ bound: true, error: res?.error || '同步状态检查失败', remoteCheckFailed: true });
      }
    } catch (err) {
      setStatus({ bound: true, error: err?.message || '同步状态检查失败', remoteCheckFailed: true });
    } finally {
      setLoading(false);
    }
  }, [projectName, domain]);

  useEffect(() => {
    setStatus(null);
    void refresh();
  }, [refresh]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    setPullMsg('');
    try {
      const res = await window.ipm?.cloud?.pullUpdate?.({ projectName, domain });
      if (res?.ok) {
        const c = res.conflicts?.length || 0;
        const copies = res.conflictCopies || [];
        setConflictCopies(copies);
        if (copies.length > 0) {
          setPullMsg(`已保留 ${copies.length} 个冲突副本`);
          setShowConflictCopies(true);
        } else {
          setPullMsg(c > 0 ? `已拉取，但有 ${c} 个冲突需手动处理` : '已拉取最新更新');
        }
        onAfterSync?.();
        await refresh();
      } else {
        setPullMsg(res?.error || '拉取失败');
      }
    } catch (err) {
      setPullMsg(err?.message || String(err));
    } finally {
      setPulling(false);
    }
  }, [projectName, domain, onAfterSync, refresh]);

  // Not bound, offline, or still loading first status → render nothing.
  if (!status || status.bound === false) return null;
  if (status.offline) return null;

  const isOwner = status.role === 'owner';
  const hasLocal = Boolean(status.hasLocalChanges);
  const hasRemote = Boolean(status.hasRemoteChanges);
  const hasError = Boolean(status.error) || Boolean(status.remoteCheckFailed);
  const clean = !hasLocal && !hasRemote && !hasError;

  return (
    <>
      <div
        className="flex items-center justify-between px-4 py-2 text-[12px]"
        style={{ background: clean ? '#f6f8fb' : '#eef1fb', borderBottom: '1px solid #e6e9f2' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cloud size={14} style={{ color: hasError ? '#b91c1c' : '#3e4b9c' }} />
          {hasError && !hasLocal && !hasRemote ? (
            <span className="flex items-center gap-1" style={{ color: '#b91c1c' }}>
              <AlertTriangle size={13} />云端状态检查失败
              <span className="text-[11px]" style={{ color: '#94a3b8' }}>（点击刷新重试）</span>
            </span>
          ) : clean ? (
            <span className="flex items-center gap-1" style={{ color: '#2d7a5f' }}>
              <Check size={13} />已与云端同步
              {status.localVersionNumber ? <span style={{ color: '#94a3b8' }}>· v{status.localVersionNumber}</span> : null}
            </span>
          ) : (
            <span className="truncate" style={{ color: '#3e4b9c' }}>
              {hasLocal && `${status.localChangeCount} 个本地变更待同步`}
              {hasLocal && hasRemote && ' · '}
              {hasRemote && '云端有新更新'}
            </span>
          )}
          {pullMsg && <span className="ml-2 truncate" style={{ color: '#64748b' }}>（{pullMsg}）</span>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {conflictCopies.length > 0 && (
            <button
              type="button"
              onClick={() => setShowConflictCopies(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium"
              style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}
            >
              <FileWarning size={12} />冲突副本
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="p-1 rounded-md"
            style={{ color: '#94a3b8' }}
            title="刷新同步状态"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          {hasRemote && (
            <button
              type="button"
              onClick={handlePull}
              disabled={pulling}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium"
              style={{ background: '#fff', border: '1px solid #c7cef0', color: '#3e4b9c', opacity: pulling ? 0.6 : 1 }}
            >
              {pulling ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
              拉取更新
            </button>
          )}
          {hasLocal && (
            <button
              type="button"
              onClick={() => setShowPush(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium"
              style={{ background: '#3e4b9c', color: '#fff' }}
            >
              <UploadCloud size={12} />同步到云端
            </button>
          )}
          {isOwner && clean && (
            <button
              type="button"
              onClick={() => setShowMilestone(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium"
              style={{ background: '#fff', border: '1px solid #e2d4bd', color: '#9c733e' }}
            >
              <Flag size={12} />发布版本
            </button>
          )}
        </div>
      </div>

      {showPush && (
        <SyncPreviewModal
          projectName={projectName}
          domain={domain}
          onClose={() => setShowPush(false)}
          onPushed={() => { onAfterSync?.(); void refresh(); }}
        />
      )}
      {showMilestone && (
        <MilestoneModal
          projectName={projectName}
          domain={domain}
          onClose={() => setShowMilestone(false)}
          onCreated={() => { setPullMsg('已发布里程碑版本'); void refresh(); }}
        />
      )}
      {showConflictCopies && (
        <ConflictCopiesModal
          copies={conflictCopies}
          onClose={() => setShowConflictCopies(false)}
        />
      )}
    </>
  );
};

export default SyncStatusBar;
