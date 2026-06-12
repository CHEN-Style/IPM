import React, { useEffect, useMemo, useState } from 'react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';

const FileHistoryRestoreModal = ({ projectName, domain, entry, onClose, onRestored }) => {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [busyVersionId, setBusyVersionId] = useState(null);
  const [message, setMessage] = useState('');

  const relPath = entry?.relPath || '';
  const restorable = useMemo(() => history.filter((h) => h.restorable), [history]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await window.ipm?.cloud?.listFileHistory?.({ projectName, domain, relPath });
        if (cancelled) return;
        if (res?.ok) setHistory(res.history || []);
        else setError(res?.error || '加载文件历史失败');
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (projectName && relPath) void load();
    return () => { cancelled = true; };
  }, [projectName, domain, relPath]);

  const handleRestore = async (version) => {
    setBusyVersionId(version.versionId);
    setError('');
    setMessage('');
    try {
      const res = await window.ipm?.cloud?.restoreFileFromVersion?.({
        projectName,
        domain,
        relPath,
        versionId: version.versionId,
      });
      if (res?.ok) {
        setMessage(res.restoredAsPlaceholder ? '已恢复为大文件占位文件，本地原文件已备份。' : '已恢复到本地，本地原文件已备份。');
        onRestored?.(res);
      } else {
        setError(res?.error || '恢复失败');
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyVersionId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.32)' }}>
      <div className="w-[680px] max-w-[calc(100vw-32px)] rounded-2xl shadow-2xl" style={{ background: '#fff', border: '1px solid #e2e8f0' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #eef2f7' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <History size={18} style={{ color: '#3e4b9c' }} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold truncate" style={{ color: '#1e293b' }}>历史版本与恢复</div>
              <div className="text-[12px] truncate" style={{ color: '#64748b' }}>{relPath}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg" style={{ color: '#94a3b8' }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[460px] overflow-y-auto">
          <p className="text-[12px] mb-3" style={{ color: '#64748b' }}>
            恢复会先写入本地文件，并自动备份当前本地文件；不会立刻同步到云端。
          </p>
          {error ? (
            <div className="mb-3 px-3 py-2 rounded-lg text-[12px]" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mb-3 px-3 py-2 rounded-lg text-[12px]" style={{ background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#047857' }}>
              {message}
            </div>
          ) : null}
          {loading ? (
            <div className="py-10 flex items-center justify-center text-[13px]" style={{ color: '#94a3b8' }}>
              <Loader2 size={16} className="animate-spin mr-2" />加载历史中…
            </div>
          ) : restorable.length === 0 ? (
            <div className="py-8 text-center text-[13px]" style={{ color: '#94a3b8' }}>
              没有可恢复的历史版本。
            </div>
          ) : (
            <div className="space-y-2">
              {restorable.map((version) => (
                <div key={version.versionId} className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ border: '1px solid #e2e8f0', background: '#fff' }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px] font-medium" style={{ color: '#1e293b' }}>
                      <span>v{version.versionNumber}</span>
                      {version.label ? <span className="truncate">· {version.label}</span> : null}
                      {version.type === 'milestone' ? <span className="text-[11px]" style={{ color: '#9c733e' }}>里程碑</span> : null}
                    </div>
                    <div className="mt-1 text-[11px] truncate" style={{ color: '#94a3b8' }}>
                      {version.authorName || '未知用户'} · {version.createdAt ? new Date(version.createdAt).toLocaleString() : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(busyVersionId)}
                    onClick={() => handleRestore(version)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
                    style={{ background: '#3e4b9c', color: '#fff', opacity: busyVersionId ? 0.6 : 1 }}
                  >
                    {busyVersionId === version.versionId ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    恢复到本地
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end" style={{ borderTop: '1px solid #eef2f7' }}>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-[13px] font-medium" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileHistoryRestoreModal;
