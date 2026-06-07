// C3: Global cloud-publish state.
//
// Owns the lifecycle of every in-flight publish so the flow survives the user
// closing the modal (it keeps running and is reflected in the sidebar activity
// panel). A single subscription to `cloud:publishProgress` fans events out to
// per-workspace activities keyed by `${domain}:${projectName}`.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import PublishModal from '../components/project-manager/PublishModal.jsx';

const CloudPublishContext = createContext(null);

export const PUBLISH_STEP_ORDER = ['scanning', 'creating', 'checking', 'uploading', 'committing'];

const STEP_LABELS = {
  scanning: '扫描本地文件',
  creating: '创建云端项目',
  checking: '比对已有文件',
  uploading: '上传文件',
  committing: '提交版本',
};

export function keyOf(projectName, domain) {
  return `${domain || 'projects'}:${projectName}`;
}

function freshSteps() {
  const steps = {};
  for (const s of PUBLISH_STEP_ORDER) steps[s] = 'pending';
  return steps;
}

function initActivity(projectName, domain) {
  return {
    projectName,
    domain: domain || 'projects',
    cloudName: projectName,
    phase: 'preview', // preview | publishing | done | error
    steps: freshSteps(),
    upload: { current: 0, total: 0, currentFile: '' },
    scanStats: null,
    error: null,
    code: null,
    result: null,
  };
}

function applyProgress(activity, data) {
  const next = {
    ...activity,
    steps: { ...activity.steps },
    upload: { ...activity.upload },
  };
  const { step, status } = data;

  if (step === 'error') {
    next.phase = 'error';
    next.error = data.error || '发布失败';
    next.code = data.code || null;
    // Mark the currently-running step as errored.
    for (const s of PUBLISH_STEP_ORDER) {
      if (next.steps[s] === 'running') next.steps[s] = 'error';
    }
    return next;
  }

  if (step === 'done') {
    for (const s of PUBLISH_STEP_ORDER) next.steps[s] = 'done';
    next.phase = 'done';
    next.result = {
      workspaceId: data.workspaceId,
      versionId: data.versionId,
      versionNumber: data.versionNumber,
    };
    return next;
  }

  if (PUBLISH_STEP_ORDER.includes(step)) {
    next.steps[step] = status === 'done' ? 'done' : 'running';
    // Mark all earlier steps done once we've moved on.
    const idx = PUBLISH_STEP_ORDER.indexOf(step);
    for (let i = 0; i < idx; i += 1) next.steps[PUBLISH_STEP_ORDER[i]] = 'done';

    if (step === 'scanning' && status === 'done') {
      next.scanStats = {
        totalFiles: data.totalFiles,
        totalFolders: data.totalFolders,
        totalSizeBytes: data.totalSizeBytes,
      };
    }
    if (step === 'uploading') {
      next.upload = {
        current: typeof data.current === 'number' ? data.current : next.upload.current,
        total: typeof data.total === 'number' ? data.total : next.upload.total,
        currentFile: data.currentFile || next.upload.currentFile,
      };
    }
  }
  return next;
}

export function CloudPublishProvider({ children, onPublished }) {
  const [activities, setActivities] = useState({});
  const [modalKey, setModalKey] = useState(null);
  const onPublishedRef = useRef(onPublished);
  onPublishedRef.current = onPublished;

  useEffect(() => {
    const off = window.ipm?.cloud?.onPublishProgress?.((data) => {
      if (!data?.projectName) return;
      const k = keyOf(data.projectName, data.domain);
      setActivities((prev) => {
        const a = prev[k];
        if (!a) return prev;
        return { ...prev, [k]: applyProgress(a, data) };
      });
    });
    return () => {
      try { off?.(); } catch { /* ignore */ }
    };
  }, []);

  const openPublishModal = useCallback((projectName, domain) => {
    const k = keyOf(projectName, domain);
    setActivities((prev) => {
      const existing = prev[k];
      // Re-opening a finished/idle one resets to preview; keep an in-flight one.
      if (existing && existing.phase === 'publishing') return prev;
      return { ...prev, [k]: initActivity(projectName, domain) };
    });
    setModalKey(k);
  }, []);

  const reopenModal = useCallback((k) => setModalKey(k), []);
  const closeModal = useCallback(() => setModalKey(null), []);

  const startPublish = useCallback(async ({ projectName, domain, cloudName, description, message }) => {
    const k = keyOf(projectName, domain);
    setActivities((prev) => ({
      ...prev,
      [k]: {
        ...(prev[k] || initActivity(projectName, domain)),
        cloudName: cloudName || projectName,
        phase: 'publishing',
        steps: freshSteps(),
        upload: { current: 0, total: 0, currentFile: '' },
        error: null,
        code: null,
        result: null,
      },
    }));

    try {
      const res = await window.ipm.cloud.publish({ projectName, domain, cloudName, description, message });
      setActivities((prev) => ({
        ...prev,
        [k]: {
          ...(prev[k] || initActivity(projectName, domain)),
          phase: res?.ok ? 'done' : 'error',
          error: res?.ok ? null : (res?.error || '发布失败'),
          code: res?.code || null,
          result: res?.ok ? res : (prev[k]?.result || null),
        },
      }));
      if (res?.ok && typeof onPublishedRef.current === 'function') {
        onPublishedRef.current({ projectName, domain, result: res });
      }
      return res;
    } catch (e) {
      const msg = e?.message || String(e);
      setActivities((prev) => ({
        ...prev,
        [k]: { ...(prev[k] || initActivity(projectName, domain)), phase: 'error', error: msg },
      }));
      return { ok: false, error: msg };
    }
  }, []);

  const cancelPublish = useCallback(async (projectName, domain) => {
    try {
      await window.ipm?.cloud?.cancelPublish?.({ projectName, domain });
    } catch { /* ignore */ }
  }, []);

  const dismissActivity = useCallback((k) => {
    setActivities((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
    setModalKey((cur) => (cur === k ? null : cur));
  }, []);

  const activityList = useMemo(() => Object.entries(activities).map(([k, a]) => ({ key: k, ...a })), [activities]);
  const lockedKeys = useMemo(
    () => new Set(activityList.filter((a) => a.phase === 'publishing').map((a) => a.key)),
    [activityList],
  );

  const value = useMemo(
    () => ({
      activities,
      activityList,
      lockedKeys,
      modalKey,
      openPublishModal,
      reopenModal,
      closeModal,
      startPublish,
      cancelPublish,
      dismissActivity,
      stepLabels: STEP_LABELS,
    }),
    [activities, activityList, lockedKeys, modalKey, openPublishModal, reopenModal, closeModal, startPublish, cancelPublish, dismissActivity],
  );

  const activeModalActivity = modalKey ? activities[modalKey] : null;

  return (
    <CloudPublishContext.Provider value={value}>
      {children}
      {activeModalActivity ? (
        <PublishModal
          activity={activeModalActivity}
          activityKey={modalKey}
          onClose={closeModal}
          onStart={startPublish}
          onCancel={cancelPublish}
          onDismiss={dismissActivity}
          stepLabels={STEP_LABELS}
        />
      ) : null}
    </CloudPublishContext.Provider>
  );
}

export function useCloudPublish() {
  const ctx = useContext(CloudPublishContext);
  if (!ctx) {
    // Safe no-op fallback so components don't crash if used outside provider.
    return {
      activities: {},
      activityList: [],
      lockedKeys: new Set(),
      modalKey: null,
      openPublishModal: () => {},
      reopenModal: () => {},
      closeModal: () => {},
      startPublish: async () => ({ ok: false, error: 'cloud publish unavailable' }),
      cancelPublish: async () => {},
      dismissActivity: () => {},
      stepLabels: STEP_LABELS,
    };
  }
  return ctx;
}
