import { useCallback, useEffect, useRef, useState } from 'react';

// H4.5: shared sync-state for one bound project.
//
// Lifts the status polling that used to live inside the SyncStatusBar banner so
// three consumers can share one source of truth:
//   * the header cloud chip (state + colour),
//   * the per-file inline badges in the entry table (derived from the plan),
//   * the sync drawer (status card, change lists, actions).
//
// The lightweight summary (mtime/size walk + one sync-status call) runs on
// project entry and on demand. The full sync plan (hashing scan) only runs
// when the summary reports a difference, so a clean project never pays for it.

export default function useSyncStatus({ projectName, domain, enabled }) {
  const [status, setStatus] = useState(null); // null until first load
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const seqRef = useRef(0);

  const refreshPlan = useCallback(async () => {
    if (!enabled || !projectName) return;
    const seq = ++seqRef.current;
    setPlanLoading(true);
    try {
      const res = await window.ipm?.cloud?.computeSyncPlan?.({ projectName, domain });
      if (seqRef.current !== seq) return;
      setPlan(res?.ok ? res.plan : null);
    } catch {
      if (seqRef.current === seq) setPlan(null);
    } finally {
      if (seqRef.current === seq) setPlanLoading(false);
    }
  }, [enabled, projectName, domain]);

  const refresh = useCallback(async () => {
    if (!enabled || !projectName) return;
    setLoading(true);
    try {
      const res = await window.ipm?.cloud?.getSyncStatus?.({ projectName, domain });
      if (res?.ok && res.bound) {
        setStatus(res);
      } else if (res?.bound === false) {
        setStatus({ bound: false });
      } else {
        setStatus({ bound: true, error: res?.error || '同步状态检查失败', remoteCheckFailed: true });
      }
    } catch (err) {
      setStatus({ bound: true, error: err?.message || '同步状态检查失败', remoteCheckFailed: true });
    } finally {
      setLoading(false);
    }
  }, [enabled, projectName, domain]);

  useEffect(() => {
    seqRef.current += 1; // invalidate any in-flight plan for the old project
    setStatus(null);
    setPlan(null);
    if (enabled && projectName) void refresh();
  }, [refresh, enabled, projectName]);

  // Compute the detailed plan only when the cheap summary says something
  // differs (otherwise the badges/drawer have nothing to show anyway).
  useEffect(() => {
    if (!status?.bound || status.offline) { setPlan(null); return; }
    if (status.hasLocalChanges || status.hasRemoteChanges) void refreshPlan();
    else setPlan(null);
  }, [status, refreshPlan]);

  return { status, loading, plan, planLoading, refresh, refreshPlan };
}

/**
 * Map (binding + summary + plan) onto a single chip descriptor.
 * tone: 'green' | 'indigo' | 'amber' | 'red' | 'slate'
 */
export function deriveCloudChip({ bound, publishing, status, plan }) {
  if (publishing) return { key: 'publishing', tone: 'indigo', text: '发布中…', spin: true };
  if (!bound) return { key: 'unbound', tone: 'slate', text: '发布到云端' };
  if (!status) return { key: 'checking', tone: 'slate', text: '云端', spin: true };
  if (status.offline) return { key: 'offline', tone: 'slate', text: '云端 · 离线' };

  const ver = status.localVersionNumber ? ` · v${status.localVersionNumber}` : '';
  if (status.error || status.remoteCheckFailed) {
    return { key: 'error', tone: 'red', text: '同步状态异常' };
  }
  const conflictCount = plan?.conflicts?.length || 0;
  if (conflictCount > 0) {
    return { key: 'conflict', tone: 'amber', text: `${conflictCount} 个冲突待处理` };
  }
  const hasLocal = Boolean(status.hasLocalChanges);
  const hasRemote = Boolean(status.hasRemoteChanges);
  if (hasLocal && hasRemote) return { key: 'both', tone: 'indigo', text: '本地与云端均有变更' };
  if (hasLocal) return { key: 'local', tone: 'indigo', text: `${status.localChangeCount} 个变更待同步` };
  if (hasRemote) {
    const rv = status.remoteVersionNumber ? ` · v${status.remoteVersionNumber}` : '';
    return { key: 'remote', tone: 'indigo', text: `云端有更新${rv}` };
  }
  if (status.workspaceStatus === 'archived') return { key: 'archived', tone: 'amber', text: `已归档 · 只读${ver}` };
  if (status.role === 'viewer') return { key: 'viewer', tone: 'slate', text: `只读${ver}` };
  return { key: 'synced', tone: 'green', text: `已与云端同步${ver}` };
}
