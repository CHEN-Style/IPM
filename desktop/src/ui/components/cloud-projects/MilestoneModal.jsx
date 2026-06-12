import React, { useState } from 'react';
import { X, Flag, Loader2, AlertTriangle } from 'lucide-react';

// C5: Milestone version modal (owner only).
//
// Promotes the workspace's current version into a named milestone snapshot.

const MilestoneModal = ({ projectName, domain, onClose, onCreated }) => {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    const value = label.trim();
    if (!value) {
      setError('请填写版本名称');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await window.ipm?.cloud?.createMilestone?.({ projectName, domain, label: value });
      if (res?.ok) {
        onCreated?.(res);
        onClose?.();
      } else {
        setError(res?.error || '创建版本失败');
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.45)' }}>
      <div className="w-[440px] rounded-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 20px 60px rgba(15,23,42,0.25)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #eef0f4' }}>
          <div className="flex items-center gap-2.5">
            <Flag size={18} style={{ color: '#9c733e' }} />
            <div>
              <div className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>发布版本</div>
              <div className="text-[12px]" style={{ color: '#94a3b8' }}>{projectName}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: '#94a3b8' }}><X size={18} /></button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[12px] mb-3" style={{ color: '#64748b' }}>
            将当前云端状态标记为一个里程碑版本，所有协作者会看到这个命名快照，便于对齐进度与回溯。
          </p>
          <label className="text-[12px] block mb-1" style={{ color: '#475569' }}>版本名称</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：v2 - 庭前准备完成"
            autoFocus
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none"
            style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#1e293b' }}
          />
          {error && (
            <div className="mt-3 flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              <AlertTriangle size={14} />{error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 flex items-center justify-end gap-2" style={{ borderTop: '1px solid #eef0f4' }}>
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg text-[13px]" style={{ background: '#f1f5f9', color: '#475569' }}>取消</button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium"
            style={{ background: '#9c733e', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />}
            发布版本
          </button>
        </div>
      </div>
    </div>
  );
};

export default MilestoneModal;
