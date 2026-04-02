import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './useToast.js';

const POLL_INTERVAL_MS = 30_000;
const EXTRACTION_CHECK_DELAY_MS = 3_000;

export default function useSupervisorNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);

  const [extractionPrompt, setExtractionPrompt] = useState(null);
  const extractionChecked = useRef(false);
  const timerRef = useRef(null);
  const prevUnreadRef = useRef(0);

  const { showToast } = useToast();

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await window.ipm?.supervisor?.getNotifications?.({ limit: 20 });
      if (res?.ok) {
        setNotifications(res.notifications || []);
        setUnreadCount(res.unreadCount || 0);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchCandidates = useCallback(async () => {
    try {
      const res = await window.ipm?.supervisor?.listPreferenceCandidates?.({ status: 'pending' });
      if (res?.ok) setCandidates(res.candidates || []);
    } catch { /* ignore */ }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await window.ipm?.supervisor?.getNotifications?.({ onlyUnread: true, limit: 1 });
      if (res?.ok) {
        const newCount = res.unreadCount || 0;
        if (newCount > prevUnreadRef.current && newCount > 0) {
          const latest = res.notifications?.[0];
          if (latest) {
            showToast(latest.title || latest.content, latest.type === 'warning' ? 'warn' : 'info');
          }
        }
        prevUnreadRef.current = newCount;
        setUnreadCount(newCount);
      }
    } catch { /* ignore */ }
  }, [showToast]);

  useEffect(() => {
    fetchUnreadCount();
    timerRef.current = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (extractionChecked.current) return;
    extractionChecked.current = true;

    const timer = setTimeout(async () => {
      try {
        const res = await window.ipm?.supervisor?.checkPreferenceExtraction?.();
        if (res?.ok && res.needed) {
          setExtractionPrompt({
            needed: true,
            summary: res.summary,
            projects: res.projects,
            totalEvents: res.totalEvents,
          });
        }
      } catch { /* ignore */ }
    }, EXTRACTION_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  const acceptExtraction = useCallback(async () => {
    setExtractionPrompt('running');
    try {
      const res = await window.ipm?.supervisor?.runPreferenceExtraction?.();
      setExtractionPrompt('done');
      if (res?.ok && res.totalCandidates > 0) {
        await fetchCandidates();
        await fetchNotifications();
      }
      return res;
    } catch {
      setExtractionPrompt('done');
      return { ok: false };
    }
  }, [fetchCandidates, fetchNotifications]);

  const rejectExtraction = useCallback(async () => {
    setExtractionPrompt(null);
    try {
      await window.ipm?.supervisor?.rejectPreferenceExtraction?.();
    } catch { /* ignore */ }
  }, []);

  const dismissExtractionDone = useCallback(() => {
    setExtractionPrompt(null);
  }, []);

  const markRead = useCallback(async (id) => {
    try {
      await window.ipm?.supervisor?.markNotificationRead?.(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await window.ipm?.supervisor?.markNotificationRead?.(null, true);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  }, []);

  const acceptCandidate = useCallback(async (id) => {
    try {
      const res = await window.ipm?.supervisor?.acceptPreferenceCandidate?.(id);
      if (res?.ok) setCandidates((prev) => prev.filter((c) => c.id !== id));
      return res;
    } catch { return { ok: false }; }
  }, []);

  const dismissCandidate = useCallback(async (id) => {
    try {
      const res = await window.ipm?.supervisor?.dismissPreferenceCandidate?.(id);
      if (res?.ok) setCandidates((prev) => prev.filter((c) => c.id !== id));
      return res;
    } catch { return { ok: false }; }
  }, []);

  const loadFull = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchNotifications(), fetchCandidates()]);
    setLoading(false);
  }, [fetchNotifications, fetchCandidates]);

  return {
    notifications,
    unreadCount,
    loading,
    candidates,
    extractionPrompt,
    markRead,
    markAllRead,
    acceptCandidate,
    dismissCandidate,
    acceptExtraction,
    rejectExtraction,
    dismissExtractionDone,
    loadFull,
    refresh: fetchNotifications,
  };
}
