import { useCallback, useState } from 'react';

const useExplorerEntries = ({ isStudy, domainOpts }) => {
  const [cwd, setCwd] = useState(() => (isStudy ? { type: 'project', name: '', relPath: '' } : { type: 'root' }));
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  const refreshEntries = useCallback(async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setLoading(true);
    setErrorText('');
    try {
      if (cwd.type === 'project') {
        if (!window.ipm?.explorer?.list) {
          setEntries([]);
          setErrorText('explorer/list 未就绪：请重启应用（不要只刷新页面）');
          return;
        }
        const res = await window.ipm.explorer.list(cwd.name, cwd.relPath || '', domainOpts);
        setEntries(res.entries || []);
      } else {
        if (!window.ipm?.localExplorer?.list) {
          setEntries([]);
          setErrorText('localExplorer/list 未就绪：请重启应用（不要只刷新页面）');
          return;
        }
        const res = await window.ipm.localExplorer.list(cwd.rootPath, cwd.relPath || '');
        setEntries(res.entries || []);
      }
    } catch (e) {
      setEntries([]);
      setErrorText(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, domainOpts]);

  const enterRelDir = useCallback(
    (relPath) => {
      if (cwd.type !== 'project' && cwd.type !== 'local') return;
      setCwd({ ...cwd, relPath: String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/') });
    },
    [cwd],
  );

  const goParent = useCallback(() => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const parts = String(cwd.relPath || '').split('/').filter(Boolean);
    parts.pop();
    setCwd({ ...cwd, relPath: parts.join('/') });
  }, [cwd]);

  return {
    cwd,
    setCwd,
    entries,
    setEntries,
    loading,
    errorText,
    setErrorText,
    refreshEntries,
    enterRelDir,
    goParent,
  };
};

export default useExplorerEntries;


