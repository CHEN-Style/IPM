import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY = { queued: [], classifying: [], classified: [], failed: [] };

const useClassifyPipeline = ({ cwd, refreshGhosts, refreshEntries }) => {
  const [pipeline, setPipeline] = useState(EMPTY);
  const prevClassifiedCountRef = useRef(0);

  const projectName = cwd?.type === 'project' ? cwd.name : '';

  useEffect(() => {
    prevClassifiedCountRef.current = 0;

    if (!projectName && cwd?.type !== 'project') {
      setPipeline(EMPTY);
      return;
    }

    const api = window.ipm?.classify;
    if (!api) return;

    api.getSnapshot(projectName).then((res) => {
      if (res) {
        const snap = { queued: res.queued || [], classifying: res.classifying || [], classified: res.classified || [], failed: res.failed || [] };
        prevClassifiedCountRef.current = snap.classified.length;
        setPipeline(snap);
      }
    }).catch(() => {});

    const cleanup = api.onStatusChanged((data) => {
      if (data?.projectName !== projectName) return;
      const next = {
        queued: data.queued || [],
        classifying: data.classifying || [],
        classified: data.classified || [],
        failed: data.failed || [],
      };

      if (next.classified.length > prevClassifiedCountRef.current) {
        refreshGhosts?.();
        refreshEntries?.();
      }
      prevClassifiedCountRef.current = next.classified.length;

      setPipeline(next);
    });

    return cleanup;
  }, [projectName, cwd?.type, refreshGhosts, refreshEntries]);

  const clearCompleted = useCallback(() => {
    const api = window.ipm?.classify;
    if (!api || !projectName) return;
    api.clearCompleted(projectName).catch(() => {});
  }, [projectName]);

  const totalActive = pipeline.queued.length + pipeline.classifying.length + pipeline.classified.length + pipeline.failed.length;
  const isActive = totalActive > 0;

  return { ...pipeline, totalActive, isActive, clearCompleted };
};

export default useClassifyPipeline;
