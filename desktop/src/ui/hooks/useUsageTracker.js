import { useEffect, useRef } from 'react';

const FLUSH_INTERVAL = 30_000;
const BUFFER_LIMIT = 100;
const CLICK_THROTTLE = 50;

function getTrackId(el) {
  if (!el || el === document || el === document.body) return '';
  if (el.dataset?.track) return el.dataset.track;
  if (el.id) return `#${el.id}`;
  let cur = el.parentElement;
  for (let i = 0; i < 5 && cur; i += 1) {
    if (cur.dataset?.track) return cur.dataset.track;
    if (cur.id) return `#${cur.id}`;
    cur = cur.parentElement;
  }
  return '';
}

function getElLabel(el) {
  if (!el) return '';
  const text = (el.innerText || el.textContent || '').trim();
  return text.length > 30 ? text.slice(0, 30) : text;
}

export default function useUsageTracker(page) {
  const bufferRef = useRef([]);
  const pageRef = useRef(page);
  const dwellStartRef = useRef(Date.now());
  const lastClickRef = useRef(0);
  const flushTimerRef = useRef(null);

  const push = (evt) => {
    bufferRef.current.push(evt);
    if (bufferRef.current.length >= BUFFER_LIMIT) flush();
  };

  const getUserName = () => {
    try { return window.localStorage.getItem('knowvault.user.name') || ''; } catch { return ''; }
  };

  const flush = () => {
    const batch = bufferRef.current.splice(0);
    if (!batch.length) return;
    try {
      window.ipm?.analytics?.flush(batch, getUserName());
    } catch { /* ignore */ }
  };

  // Track page change
  useEffect(() => {
    const prev = pageRef.current;
    const now = Date.now();
    if (prev && prev !== page) {
      push({ t: now, type: 'dwell', page: prev, ms: now - dwellStartRef.current });
      push({ t: now, type: 'nav', from: prev, to: page });
    }
    pageRef.current = page;
    dwellStartRef.current = now;
  }, [page]);

  useEffect(() => {
    push({ t: Date.now(), type: 'session_start', page: pageRef.current });

    const onClick = (e) => {
      const now = Date.now();
      if (now - lastClickRef.current < CLICK_THROTTLE) return;
      lastClickRef.current = now;
      const el = e.target;
      push({
        t: now,
        type: 'click',
        page: pageRef.current,
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        rx: +(e.clientX / window.innerWidth).toFixed(4),
        ry: +(e.clientY / window.innerHeight).toFixed(4),
        vw: window.innerWidth,
        vh: window.innerHeight,
        tag: (el.tagName || '').toLowerCase(),
        track: getTrackId(el),
        text: getElLabel(el),
      });
    };

    const onFocusIn = (e) => {
      const el = e.target;
      if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      push({
        t: Date.now(),
        type: 'input_focus',
        page: pageRef.current,
        tag: el.tagName.toLowerCase(),
        inputType: el.type || '',
        track: getTrackId(el),
        placeholder: (el.placeholder || '').slice(0, 40),
      });
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocusIn, true);

    flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL);

    const onBeforeUnload = () => {
      const now = Date.now();
      push({ t: now, type: 'dwell', page: pageRef.current, ms: now - dwellStartRef.current });
      push({ t: now, type: 'session_end' });
      flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      window.removeEventListener('beforeunload', onBeforeUnload);
      onBeforeUnload();
    };
  }, []);
}
