import React, { useEffect, useRef, useState } from 'react';
import { Ban } from 'lucide-react';

const RejectPopover = ({ sourceRelPath, onConfirm, onCancel }) => {
  const [feedback, setFeedback] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = () => {
    onConfirm(sourceRelPath, feedback.trim() || null);
  };

  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-slate-200 rounded-lg shadow-xl p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-medium text-slate-600 mb-2">分错了？简单说一下原因（可选）</div>
      <textarea
        ref={inputRef}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="例如：这个文件应该归到交付成果"
        className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40"
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleConfirm();
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="px-3 py-1 text-[11px] font-semibold bg-[#3e4b9c] text-white rounded hover:bg-[#4e5bab] transition-colors inline-flex items-center gap-1.5"
        >
          <Ban size={11} />
          确认放弃
        </button>
      </div>
    </div>
  );
};

export default RejectPopover;
