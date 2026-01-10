import React from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export const ToastContainer = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-in slide-in-from-right-10 fade-in duration-300 w-80 ${
            toast.type === 'success'
              ? 'bg-white border-green-200 text-green-800'
              : toast.type === 'error'
                ? 'bg-white border-red-200 text-red-800'
                : 'bg-white border-blue-200 text-blue-800'
          }`}
        >
          {toast.type === 'success' && <CheckCircle size={18} className="text-green-500 shrink-0" />}
          {toast.type === 'error' && <AlertCircle size={18} className="text-red-500 shrink-0" />}
          {toast.type === 'info' && <Info size={18} className="text-blue-500 shrink-0" />}

          <div className="flex-1 text-sm font-medium">{toast.message}</div>

          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                onDismiss(toast.id);
              }}
              className="text-xs font-bold underline hover:no-underline px-2"
            >
              {toast.actionLabel}
            </button>
          ) : null}

          <button type="button" onClick={() => onDismiss(toast.id)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};


