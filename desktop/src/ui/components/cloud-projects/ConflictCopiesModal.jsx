import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

const kindLabel = {
  both_modified: '双方都修改了同一个文件',
  local_delete_remote_edit: '本地删除，但云端有新修改',
  local_edit_remote_delete: '本地修改，但云端已标记删除',
};

const ConflictCopiesModal = ({ copies = [], onClose }) => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.28)' }}>
    <div className="w-[620px] max-w-[calc(100vw-32px)] rounded-2xl shadow-2xl" style={{ background: '#fff', border: '1px solid #e2e8f0' }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #eef2f7' }}>
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={18} style={{ color: '#b45309' }} />
          <div>
            <div className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>已保留冲突副本</div>
            <div className="text-[12px]" style={{ color: '#64748b' }}>系统没有覆盖你的本地文件，云端版本已另存为副本。</div>
          </div>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg" style={{ color: '#94a3b8' }}>
          <X size={16} />
        </button>
      </div>

      <div className="px-5 py-4 max-h-[420px] overflow-y-auto">
        {copies.length === 0 ? (
          <div className="text-[13px]" style={{ color: '#64748b' }}>暂无冲突副本。</div>
        ) : (
          <div className="space-y-3">
            {copies.map((copy) => (
              <div key={`${copy.path}-${copy.conflictPath}`} className="rounded-xl p-3" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                <div className="text-[12px] font-medium truncate" style={{ color: '#9a3412' }}>
                  {kindLabel[copy.kind] || '文件冲突'}
                </div>
                <div className="mt-2 space-y-1 text-[12px]" style={{ color: '#475569' }}>
                  <div className="truncate">本地原文件：{copy.path}</div>
                  <div className="truncate">云端副本：{copy.conflictPath}</div>
                  {copy.versionNumber ? <div>来源版本：v{copy.versionNumber}</div> : null}
                  {copy.placeholder ? <div>大文件已保存为占位文件，打开时再下载。</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-3 flex justify-end" style={{ borderTop: '1px solid #eef2f7' }}>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: '#3e4b9c', color: '#fff' }}
        >
          知道了
        </button>
      </div>
    </div>
  </div>
);

export default ConflictCopiesModal;
