import { useEffect, useRef } from 'react';

const useResumeRefresh = ({ normalizedDomain, cwd, refreshProjects, refreshEntries, refreshGhosts }) => {
  const resumeRefreshTsRef = useRef(0);
  const resumeTimerRef = useRef(null);

  useEffect(() => {
    const refreshOnResume = () => {
      const now = Date.now();
      if (now - (resumeRefreshTsRef.current || 0) < 800) return;
      resumeRefreshTsRef.current = now;

      if (cwd.type === 'root') {
        refreshProjects?.().catch(() => {});
        return;
      }
      if (cwd.type !== 'project') return;

      refreshEntries?.().catch(() => {});
      refreshGhosts?.().catch(() => {});

      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        if (cwd.type !== 'project') return;
        refreshGhosts?.().catch(() => {});
        if (String(cwd.relPath || '').replace(/\\/g, '/') === 'temp') {
          refreshEntries?.().catch(() => {});
        }
      }, 700);
    };

    const onFocus = () => refreshOnResume();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOnResume();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath, refreshEntries, refreshGhosts, refreshProjects]);
};

export default useResumeRefresh;


