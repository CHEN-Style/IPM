import { Folder, Sparkles, Database, Timer } from 'lucide-react';

const normalizeRelPathPosix = (p) => {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
};

const folderDecor = (relPath) => {
  const rp = normalizeRelPathPosix(relPath);
  if (rp === 'temp') {
    return { Icon: Timer, iconClass: 'text-amber-600', boxClass: 'bg-amber-50 border border-amber-200/60' };
  }
  if (rp === 'snippets') {
    return { Icon: Sparkles, iconClass: 'text-emerald-600', boxClass: 'bg-emerald-50 border border-emerald-200/60' };
  }
  if (rp === 'meta') {
    return { Icon: Database, iconClass: 'text-violet-600', boxClass: 'bg-violet-50 border border-violet-200/60' };
  }
  return { Icon: Folder, iconClass: 'text-blue-600', boxClass: 'bg-slate-100' };
};

const fmtBytes = (n) => {
  if (!n) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const fmtTime = (ms) => {
  if (!ms) return '-';
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export { normalizeRelPathPosix, folderDecor, fmtBytes, fmtTime };


