import {
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  Presentation,
  Sparkles,
  Timer,
} from 'lucide-react';

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
  return { Icon: Folder, iconClass: 'text-[#3e4b9c]', boxClass: 'bg-[#eceef7]' };
};

const fileDecor = (fileName) => {
  const name = String(fileName || '');
  const parts = name.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
  const isMatch = (list) => list.includes(ext);

  if (isMatch(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'heic'])) {
    return { Icon: FileImage, iconClass: 'text-cyan-600', boxClass: 'bg-cyan-50 border border-cyan-200/60' };
  }
  if (isMatch(['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'm4v'])) {
    return { Icon: FileVideo, iconClass: 'text-indigo-600', boxClass: 'bg-indigo-50 border border-indigo-200/60' };
  }
  if (isMatch(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'])) {
    return { Icon: FileAudio, iconClass: 'text-sky-600', boxClass: 'bg-sky-50 border border-sky-200/60' };
  }
  if (isMatch(['ppt', 'pptx', 'key', 'odp'])) {
    return { Icon: Presentation, iconClass: 'text-orange-600', boxClass: 'bg-orange-50 border border-orange-200/60' };
  }
  if (isMatch(['xls', 'xlsx', 'csv', 'ods'])) {
    return { Icon: FileSpreadsheet, iconClass: 'text-green-600', boxClass: 'bg-green-50 border border-green-200/60' };
  }
  if (isMatch(['doc', 'docx', 'rtf', 'odt'])) {
    return { Icon: FileText, iconClass: 'text-blue-600', boxClass: 'bg-blue-50 border border-blue-200/60' };
  }
  if (isMatch(['pdf'])) {
    return { Icon: FileType, iconClass: 'text-rose-600', boxClass: 'bg-rose-50 border border-rose-200/60' };
  }
  if (isMatch(['txt', 'md', 'markdown', 'log'])) {
    return { Icon: FileText, iconClass: 'text-slate-600', boxClass: 'bg-slate-100 border border-slate-200/60' };
  }
  if (isMatch(['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'css', 'scss', 'less', 'sql', 'sh', 'bat', 'ps1', 'json', 'yml', 'yaml'])) {
    return { Icon: FileCode, iconClass: 'text-violet-600', boxClass: 'bg-violet-50 border border-violet-200/60' };
  }
  if (isMatch(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'tgz'])) {
    return { Icon: FileArchive, iconClass: 'text-amber-600', boxClass: 'bg-amber-50 border border-amber-200/60' };
  }
  return { Icon: File, iconClass: 'text-slate-500', boxClass: 'bg-slate-100 border border-slate-200/60' };
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

const HIDDEN_SYSTEM_DIRS = new Set(['snippets', 'meta']);

const isHiddenSystemDir = (entry) => {
  if (entry?.kind !== 'dir') return false;
  const rp = normalizeRelPathPosix(entry.relPath || entry.name);
  return HIDDEN_SYSTEM_DIRS.has(rp);
};

const folderTooltip = (relPath) => {
  const rp = normalizeRelPathPosix(relPath);
  if (rp === 'temp') return '本文件夹用来临时存放未分类的文件';
  return undefined;
};

export { normalizeRelPathPosix, folderDecor, fileDecor, fmtBytes, fmtTime, HIDDEN_SYSTEM_DIRS, isHiddenSystemDir, folderTooltip };


