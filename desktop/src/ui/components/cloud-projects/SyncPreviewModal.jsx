import React, { useEffect, useMemo, useState } from 'react';
import {
  X, UploadCloud, FilePlus, FileEdit, Trash2, AlertTriangle, EyeOff, Loader2,
} from 'lucide-react';

// C5: Sync preview + confirm modal.
//
// Shows the computed SyncPlan (push deltas, conflicts, ignored changes) and
// lets the user confirm an upload. Pull is handled separately (auto-applied),
// so this modal focuses on the push direction. Conflicts block the push.

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Row({ icon, color, name, path, meta }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: '#f8f9fb' }}>
      <span style={{ color }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] truncate" style={{ color: '#1e293b' }}>{name}</div>
        <div className="text-[11px] truncate" style={{ color: '#94a3b8' }}>{path}</div>
      </div>
      {meta && <span className="text-[11px] shrink-0" style={{ color: '#94a3b8' }}>{meta}</span>}
    </div>
  );
}

function Section({ title, count, children }) {
  if (!count) return null;
  return (
    <div className="mb-3">
      <div className="text-[12px] font-medium mb-1.5" style={{ color: '#475569' }}>{title}（{count}）</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

const SyncPreviewModal = ({ projectName, domain, onClose, onPushed }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState(null);
  const [remoteAhead, setRemoteAhead] = useState(false);
  const [message, setMessage] = useState('');
  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await window.ipm?.cloud?.computeSyncPlan?.({ projectName, domain });
        if (!alive) return;
        if (res?.ok) {
          setPlan(res.plan);
          setRemoteAhead(Boolean(res.remoteAhead));
        } else {
          setError(res?.error || '计算同步计划失败');
        }
      } catch (err) {
        if (alive) setError(err?.message || String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectName, domain]);

  useEffect(() => {
    const off = window.ipm?.cloud?.onSyncProgress?.((data) => {
      if (data?.direction === 'push' && data?.projectName === projectName) setProgress(data);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [projectName]);

  const hasConflict = (plan?.conflicts?.length || 0) > 0;
  const canPush = useMemo(() => {
    if (!plan || remoteAhead || hasConflict) return false;
    return (plan.summary?.pushCount || 0) > 0;
  }, [plan, remoteAhead, hasConflict]);

  const handlePush = async () => {
    setPushing(true);
    setError('');
    try {
      const res = await window.ipm?.cloud?.pushSync?.({ projectName, domain, message });
      if (res?.ok) {
        onPushed?.(res);
        onClose?.();
      } else {
        setError(res?.error || '同步失败');
        if (res?.code === 'REMOTE_AHEAD') setRemoteAhead(true);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.45)' }}>
      <div className="w-[min(560px,calc(100vw-32px))] max-h-[80vh] rounded-2xl flex flex-col overflow-hidden" style={{ background: '#fff', boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #eef0f4' }}>
          <div className="flex items-center gap-2.5">
            <UploadCloud size={18} style={{ color: '#3e4b9c' }} />
            <div>
              <div className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>同步到云端</div>
              <div className="text-[12px]" style={{ color: '#94a3b8' }}>{projectName}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: '#94a3b8' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12" style={{ color: '#94a3b8' }}>
              <Loader2 size={18} className="animate-spin mr-2" />计算变更中…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-[13px] px-3 py-2 rounded-lg" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              <AlertTriangle size={14} />{error}
            </div>
          ) : (
            <>
              {remoteAhead && (
                <div className="mb-3 flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                  <AlertTriangle size={14} />云端有新的更新，请先「拉取更新」再同步。
                </div>
              )}
              {hasConflict && (
                <div className="mb-3 px-3 py-2 rounded-lg" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: '#b91c1c' }}>
                    <AlertTriangle size={14} />存在 {plan.conflicts.length} 个冲突文件（双方都修改了），需先手动处理：
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {plan.conflicts.map((c) => (
                      <div key={c.path} className="text-[11px] truncate" style={{ color: '#b91c1c' }}>· {c.path}</div>
                    ))}
                  </div>
                </div>
              )}

              <Section title="新增文件" count={plan.toPush.newFiles.length}>
                {plan.toPush.newFiles.map((f) => (
                  <Row key={f.path} icon={<FilePlus size={14} />} color="#2d7a5f" name={f.name} path={f.path} meta={fmtSize(f.sizeBytes)} />
                ))}
              </Section>
              <Section title="修改文件" count={plan.toPush.updatedFiles.length}>
                {plan.toPush.updatedFiles.map((f) => (
                  <Row key={f.path} icon={<FileEdit size={14} />} color="#9c733e" name={f.name} path={f.path} meta={fmtSize(f.sizeBytes)} />
                ))}
              </Section>
              <Section title="标记删除" count={plan.toPush.softDeleted.length}>
                {plan.toPush.softDeleted.map((f) => (
                  <Row key={f.path} icon={<Trash2 size={14} />} color="#b91c1c" name={f.name} path={f.path} />
                ))}
              </Section>
              {plan.ignored.newFolderFiles.length > 0 && (
                <Section title="已忽略（新文件夹需管理者创建）" count={plan.ignored.newFolderFiles.length}>
                  {plan.ignored.newFolderFiles.map((f) => (
                    <Row key={f.path} icon={<EyeOff size={14} />} color="#94a3b8" name={f.name} path={f.path} />
                  ))}
                </Section>
              )}

              {plan.summary.pushCount === 0 && !hasConflict && !remoteAhead && (
                <div className="py-8 text-center text-[13px]" style={{ color: '#94a3b8' }}>没有需要上传的本地变更</div>
              )}

              {plan.summary.pushCount > 0 && (
                <div className="mt-3">
                  <label className="text-[12px] block mb-1" style={{ color: '#475569' }}>同步说明（可选）</label>
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="例如：补充庭前证据材料"
                    className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
                    style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#1e293b' }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderTop: '1px solid #eef0f4' }}>
          <div className="text-[11px]" style={{ color: '#94a3b8' }}>
            {progress && pushing ? (progress.step === 'uploading' ? `上传中 ${progress.current || 0}/${progress.total || 0}` : progress.step) : ''}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg text-[13px]" style={{ background: '#f1f5f9', color: '#475569' }}>取消</button>
            <button
              type="button"
              onClick={handlePush}
              disabled={!canPush || pushing}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium"
              style={{ background: '#3e4b9c', color: '#fff', opacity: !canPush || pushing ? 0.5 : 1 }}
            >
              {pushing ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
              确认同步
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SyncPreviewModal;
