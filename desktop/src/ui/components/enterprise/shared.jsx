// Shared UI primitives for the enterprise console (H2 members page and
// H3 workspaces page). Visual language follows the confirmed mockups in
// desktop/design/enterprise-*-mockup.html.

import React from 'react';
import { AlertTriangle } from 'lucide-react';

const AVATAR_COLORS = ['#3e4b9c', '#0e7490', '#7c3aed', '#b45309', '#be185d', '#15803d', '#b91c1c', '#4d7c0f'];

export function avatarColor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtRelative(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return fmtDate(iso);
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const FIELD_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

export function Modal({ open, width = 440, onClose, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.32)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-white rounded-xl overflow-hidden" style={{ width, boxShadow: '0 24px 64px rgba(15,23,42,0.24)' }}>
        {children}
      </div>
    </div>
  );
}

export function WarnBox({ children }) {
  return (
    <div className="flex gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed"
      style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function InfoBox({ icon, children }) {
  return (
    <div className="flex gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed"
      style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#b45309' }}>
      {icon || <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
      <div>{children}</div>
    </div>
  );
}
