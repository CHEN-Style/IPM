import { useCallback, useState } from 'react';

const useTraceView = ({ cwd, domainOpts }) => {
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceData, setTraceData] = useState(null); // { trace, suggestion }

  const openTrace = useCallback(
    async (sourceRelPath) => {
      if (cwd.type !== 'project') return;
      const api = window.ipm?.aiStorage?.getTrace;
      if (!api) return;
      setTraceLoading(true);
      setTraceOpen(true);
      setTraceData(null);
      try {
        const res = await api(cwd.name, sourceRelPath, domainOpts);
        setTraceData({
          trace: Array.isArray(res?.trace) ? res.trace : [],
          suggestion: res?.suggestion || null,
        });
      } catch (e) {
        setTraceData({
          trace: [],
          suggestion: null,
          error: e?.message || String(e),
        });
      } finally {
        setTraceLoading(false);
      }
    },
    [cwd, domainOpts],
  );

  const closeTrace = useCallback(() => {
    setTraceOpen(false);
    setTraceData(null);
  }, []);

  return { traceOpen, traceLoading, traceData, openTrace, closeTrace };
};

export default useTraceView;
