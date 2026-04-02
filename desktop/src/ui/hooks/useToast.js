import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [queue, setQueue] = useState([]);

  const showToast = useCallback((message, variant = 'info') => {
    if (!message) return;
    setQueue((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), message: String(message), variant },
    ]);
  }, []);

  const dequeue = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  return React.createElement(
    ToastContext.Provider,
    { value: { queue, showToast, dequeue } },
    children,
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { queue: [], showToast: () => {}, dequeue: () => {} };
  }
  return ctx;
}
