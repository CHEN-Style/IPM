import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, ArrowLeft, Plus, LayoutList, Folders, ListFilter, ChevronDown, ChevronRight, Info, X, Sparkles, Database, Timer, Wand2, Check, Ban } from 'lucide-react';
import ToastBubble from './ToastBubble.jsx';
import SnippetLinkerMockPage from './snippetlinker/SnippetLinkerMockPage.jsx';

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

const ProjectManager = ({ domain = 'projects', onBackHome = null }) => {
  const raw = String(domain || 'projects').toLowerCase();
  const normalizedDomain = raw === 'cases' ? 'cases' : raw === 'study' ? 'study' : 'projects';
  const isCases = normalizedDomain === 'cases';
  const isStudy = normalizedDomain === 'study';
  const entityLabel = isStudy ? '学习' : isCases ? '案件' : '项目';
  const entityLabelAll = isStudy ? '学习' : `所有${entityLabel}`;
  const domainOpts = useMemo(() => ({ domain: normalizedDomain }), [normalizedDomain]);
  const entityApi = isCases ? window.ipm?.cases : isStudy ? null : window.ipm?.projects;

  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [snippetLinkerCtx, setSnippetLinkerCtx] = useState(null); // { name, path } | null
  const [cwd, setCwd] = useState(() =>
    isStudy ? { type: 'project', name: '', relPath: '' } : { type: 'root' },
  ); // {type:'root'} | {type:'project', name, relPath} | {type:'local', rootPath, relPath}
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'explorer' (UI only for now)
  const [newProjectName, setNewProjectName] = useState('');
  const newProjectInputRef = useRef(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderBaseRelPath, setNewFolderBaseRelPath] = useState('');
  const [menu, setMenu] = useState(null); // {x,y, items:[{label,onClick, danger?}]}
  const [tree, setTree] = useState({}); // relPath -> { open, loading, entries }
  const [notice, setNotice] = useState(null); // {variant,message}
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameRelPath, setRenameRelPath] = useState('');
  const [renameOldName, setRenameOldName] = useState('');
  const [renameNewName, setRenameNewName] = useState('');
  const aiUploadInputRef = useRef(null);
  const [aiUpload, setAiUpload] = useState({ running: false, current: 0, total: 0, fileName: '' });

  // When coming back from floating window, the main window is shown again but cwd doesn't change,
  // so our normal "enter folder -> refresh" effect won't run. We refresh on window focus/visibility.
  const resumeRefreshTsRef = useRef(0);
  const resumeTimerRef = useRef(null);

  // AI ghost files (staging suggestions)
  const [ghosts, setGhosts] = useState([]); // suggestions[] from ai-storage.json (pending+others)
  const [ghostLoading, setGhostLoading] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState({}); // folderRelPath -> boolean

  // Imported local folders (only shown in root view; used as a lightweight file explorer)
  const [localFolders, setLocalFolders] = useState([]); // {path,name,exists,reason}[]

  // Detail overlay (folders only)
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null); // { entry, folderMeta }
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [descSaving, setDescSaving] = useState(false);

  useEffect(() => {
    const d = detail?.folderMeta?.description;
    setDescDraft(typeof d === 'string' ? d : '');
    setDescEditing(false);
    setDescSaving(false);
  }, [detail?.entry?.relPath, detail?.folderMeta?.description]);

  // Drag & drop (List/Explorer)
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverFolderRelPath, setDragOverFolderRelPath] = useState('');

  const isRoot = cwd.type === 'root';
  const isProjectCwd = cwd.type === 'project';
  const isLocalCwd = cwd.type === 'local';
  const setViewModeSafe = (next) => {
    setViewMode(next);
    if (isRoot) {
      setNotice({
        variant: 'info',
        message: `提示：视图切换仅在进入某个${entityLabel}后生效；当前为「${entityLabelAll}」视图。`,
      });
    }
  };
  const title = useMemo(() => {
    if (isRoot) return entityLabelAll;
    if (isProjectCwd) return cwd.name || entityLabel;
    if (isLocalCwd) return '本地文件夹';
    return `${entityLabel}文件`;
  }, [isRoot, isProjectCwd, isLocalCwd, cwd, entityLabelAll, entityLabel]);

  const refreshProjects = async () => {
    if (isStudy) return;
    if (!entityApi?.list) return;
    const list = await entityApi.list();
    setProjects(list);
    const cur = await entityApi.getCurrent();
    setCurrentProject(cur);
  };

  const refreshLocalFolders = async () => {
    const api = window.ipm?.localFolders?.list;
    if (!api) return;
    try {
      const res = await api();
      const arr = Array.isArray(res?.folders) ? res.folders : [];
      setLocalFolders(arr);
      const bad = arr.filter((x) => x && x.exists === false);
      if (bad.length) {
        setNotice({ variant: 'warn', message: `有 ${bad.length} 个导入的本地文件夹已失效（可能被移动/删除/重命名），请取消关联或重新导入。` });
      }
    } catch (e) {
      // best-effort; do not block projects page
      setLocalFolders([]);
    }
  };

  const PROJECT_STATUSES = ['active', 'pending', 'archived'];
  const statusLabel = (s) => {
    const v = String(s || '').toLowerCase();
    if (v === 'pending') return 'PENDING';
    if (v === 'archived') return 'ARCHIVED';
    return 'ACTIVE';
  };
  const rowStyleByStatus = (s) => {
    const v = String(s || '').toLowerCase();
    if (v === 'pending') return 'bg-amber-50/60 hover:bg-amber-50';
    if (v === 'archived') return 'bg-slate-100/60 hover:bg-slate-100 text-slate-400';
    return 'hover:bg-slate-50/50';
  };
  const badgeByStatus = (s) => {
    const v = String(s || '').toLowerCase();
    if (v === 'pending') return { dot: 'bg-amber-500', ring: 'ring-amber-500/20', on: 'bg-amber-500/15 text-amber-700 border-amber-300/40' };
    if (v === 'archived') return { dot: 'bg-slate-500', ring: 'ring-slate-500/20', on: 'bg-slate-500/10 text-slate-600 border-slate-300/60' };
    return { dot: 'bg-emerald-500', ring: 'ring-emerald-500/20', on: 'bg-emerald-500/15 text-emerald-700 border-emerald-300/40' };
  };

  const setProjectStatus = async (name, nextStatus) => {
    if (!entityApi?.setStatus) {
      setNotice({ variant: 'error', message: 'setStatus 未就绪：请重启应用（不要只刷新页面）' });
      return;
    }
    try {
      await entityApi.setStatus(name, nextStatus);
      await refreshProjects();
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const refreshEntries = async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setLoading(true);
    setErrorText('');
    try {
      if (cwd.type === 'project') {
        if (!window.ipm?.explorer?.list) {
          setEntries([]);
          setErrorText('explorer/list 未就绪：请重启应用（不要只刷新页面）');
          return;
        }
        const res = await window.ipm.explorer.list(cwd.name, cwd.relPath || '', domainOpts);
        setEntries(res.entries || []);
      } else {
        if (!window.ipm?.localExplorer?.list) {
          setEntries([]);
          setErrorText('localExplorer/list 未就绪：请重启应用（不要只刷新页面）');
          return;
        }
        const res = await window.ipm.localExplorer.list(cwd.rootPath, cwd.relPath || '');
        setEntries(res.entries || []);
      }
    } catch (e) {
      setEntries([]);
      setErrorText(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const refreshGhosts = async () => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.list;
    if (!api) return;
    setGhostLoading(true);
    try {
      const res = await api(cwd.name, { status: 'pending', ...domainOpts });
      setGhosts(Array.isArray(res?.suggestions) ? res.suggestions : []);
    } catch {
      // ignore
    } finally {
      setGhostLoading(false);
    }
  };

  const openFileByRelPath = async (relPath) => {
    try {
      if (cwd.type === 'project') {
        const api = window.ipm?.explorer?.open;
        if (!api) {
          setNotice({ variant: 'error', message: 'explorer/open 未就绪：请重启应用（不要只刷新页面）' });
          return;
        }
        await api(cwd.name, relPath, domainOpts);
        return;
      }
      if (cwd.type === 'local') {
        const api = window.ipm?.localExplorer?.open;
        if (!api) {
          setNotice({ variant: 'error', message: 'localExplorer/open 未就绪：请重启应用（不要只刷新页面）' });
          return;
        }
        await api(cwd.rootPath, relPath);
      }
    } catch (e) {
      const raw = e?.message || String(e);
      const cleaned = raw
        .replace(/^Error invoking remote method 'explorer\/open': Error:\s*/i, '')
        .replace(/^Error invoking remote method 'localExplorer\/open': Error:\s*/i, '');
      setNotice({ variant: 'error', message: cleaned });
    }
  };

  const openFolderDetail = async (entry) => {
    if (cwd.type !== 'project') return;
    if (!entry || entry.kind !== 'dir') return;
    setDetailOpen(true);
    setDetailVisible(false);
    setDetailLoading(true);
    const rp = String(entry?.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const inferredSystem = rp === 'snippets' || rp === 'meta' || rp === 'temp';
    setDetail({ entry, folderMeta: inferredSystem ? { system: true, description: '' } : null });
    // allow transition
    window.setTimeout(() => setDetailVisible(true), 0);
    try {
      const api = window.ipm?.meta?.getFolderInfo;
      if (!api) {
        setDetailLoading(false);
        return;
      }
      const res = await api(cwd.name, entry.relPath, domainOpts);
      setDetail({ entry, folderMeta: res?.folder || (inferredSystem ? { system: true, description: '' } : null) });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeFolderDetail = () => {
    setDetailVisible(false);
    window.setTimeout(() => {
      setDetailOpen(false);
      setDetailLoading(false);
      setDetail(null);
      setDescEditing(false);
      setDescDraft('');
      setDescSaving(false);
    }, 180);
  };

  const saveFolderDescription = async () => {
    if (cwd.type !== 'project') return;
    const relPath = detail?.entry?.relPath;
    if (!relPath) return;
    if (!window.ipm?.meta?.setFolderDescription) {
      setNotice({ variant: 'error', message: 'meta/setFolderDescription 未就绪：请重启应用（不要只刷新页面）' });
      return;
    }
    setDescSaving(true);
    try {
      const res = await window.ipm.meta.setFolderDescription(cwd.name, relPath, descDraft, domainOpts);
      setDetail((d) => (d ? { ...d, folderMeta: res?.folder || d.folderMeta } : d));
      setDescEditing(false);
      setNotice({ variant: 'success', message: '简介已保存' });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    } finally {
      setDescSaving(false);
    }
  };

  useEffect(() => {
    refreshProjects().catch(console.error);
    refreshLocalFolders().catch(() => {});
  }, [normalizedDomain]);

  // Reset navigation context when switching domain.
  useEffect(() => {
    if (isStudy) {
      setCwd({ type: 'project', name: '', relPath: '' });
      setEntries([]);
      setTree({});
      return;
    }
    setCwd({ type: 'root' });
    setEntries([]);
    setTree({});
  }, [isStudy, normalizedDomain]);

  useEffect(() => {
    const refreshOnResume = () => {
      // Debounce/throttle: focus can fire multiple times during window show/hide.
      const now = Date.now();
      if (now - (resumeRefreshTsRef.current || 0) < 800) return;
      resumeRefreshTsRef.current = now;

      // Root view: keep projects list reasonably fresh.
      if (cwd.type === 'root') {
        refreshProjects().catch(() => {});
        return;
      }
      if (cwd.type !== 'project') return;

      // Refresh current folder listing + AI ghosts (pending suggestions)
      refreshEntries().catch(() => {});
      refreshGhosts().catch(() => {});

      // AI classification / ai-storage write can lag behind file copy; do a small delayed refresh.
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        if (cwd.type !== 'project') return;
        refreshGhosts().catch(() => {});
        // If user is currently in temp/, also refresh entries once more to catch late filesystem updates.
        if (String(cwd.relPath || '').replace(/\\/g, '/') === 'temp') {
          refreshEntries().catch(() => {});
        }
      }, 700);
    };

    const onFocus = () => refreshOnResume();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOnResume();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath]);

  useEffect(() => {
    if (cwd.type === 'project' || cwd.type === 'local') refreshEntries().catch(console.error);
    if (cwd.type === 'root') setEntries([]);
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath]);

  // Explorer View: tree cache is currently keyed only by relPath, so it must be reset when switching projects.
  // Otherwise we can accidentally show previous project's children under the new project's root.
  useEffect(() => {
    if (viewMode !== 'explorer') return;
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    // Clear any cached tree nodes from previous project / local root.
    setTree({});
    // Best-effort: prime root node so Explorer View shows first-level immediately.
    // (ExplorerFolder will also auto-load when open; this just avoids any initial blank flash.)
    try {
      window.setTimeout(() => {
        ensureTreeNode('').catch(() => {});
      }, 0);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedDomain, viewMode, cwd.type, cwd.name, cwd.rootPath]);

  useEffect(() => {
    if (cwd.type !== 'project') return;
    refreshGhosts().catch(() => {});
    // Close overview when navigating away from project root
    if (cwd.relPath) {
      setOverviewOpen(false);
      setOverviewExpanded({});
    }
  }, [normalizedDomain, cwd.type, cwd.name, cwd.rootPath, cwd.relPath]);

  const pendingGhostsAll = useMemo(() => {
    if (cwd.type !== 'project') return [];
    return (ghosts || []).filter((g) => String(g?.status) === 'pending');
  }, [ghosts, cwd.type]);

  const pendingGhostGroups = useMemo(() => {
    const map = new Map(); // folderRelPath -> suggestions[]
    for (const g of pendingGhostsAll) {
      const k = String(g?.suggestedFolderRelPath || '');
      if (!k) continue;
      const arr = map.get(k) || [];
      arr.push(g);
      map.set(k, arr);
    }
    const groups = Array.from(map.entries())
      .map(([folderRelPath, items]) => ({ folderRelPath, items }))
      .sort((a, b) => b.items.length - a.items.length || a.folderRelPath.localeCompare(b.folderRelPath, 'zh-Hans-CN'));
    return groups;
  }, [pendingGhostsAll]);

  const pendingGhostCount = pendingGhostsAll.length;
  const pendingGhostFolderCount = pendingGhostGroups.length;
  const showOverviewBar = cwd.type === 'project' && !cwd.relPath && pendingGhostCount > 0;

  const pendingGhostsInCwd = useMemo(() => {
    if (cwd.type !== 'project') return [];
    const rel = String(cwd.relPath || '');
    return (ghosts || []).filter((g) => String(g?.status) === 'pending' && String(g?.suggestedFolderRelPath) === rel);
  }, [ghosts, cwd.type, cwd.relPath]);

  const acceptGhost = async (sourceRelPath) => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.accept;
    if (!api) return;
    try {
      await api(cwd.name, sourceRelPath, domainOpts);
      await refreshEntries();
      await refreshGhosts();
      setNotice({ variant: 'success', message: '已移动（AI 建议已接受）' });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const rejectGhost = async (sourceRelPath) => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.reject;
    if (!api) return;
    try {
      await api(cwd.name, sourceRelPath, domainOpts);
      await refreshGhosts();
      setNotice({ variant: 'info', message: '已放弃（暂存建议已拒绝）' });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const acceptAllGhostsHere = async () => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.acceptAll;
    if (!api) return;
    try {
      const res = await api(cwd.name, { folderRelPath: cwd.relPath || '', ...domainOpts });
      await refreshEntries();
      await refreshGhosts();
      setNotice({ variant: 'success', message: `已接受 ${res?.accepted || 0} 个，失败 ${res?.failed || 0} 个` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const rejectAllGhostsHere = async () => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.rejectAll;
    if (!api) return;
    try {
      const res = await api(cwd.name, { folderRelPath: cwd.relPath || '', ...domainOpts });
      await refreshGhosts();
      setNotice({ variant: 'info', message: `已放弃 ${res?.rejected || 0} 个` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const acceptAllGhostsProject = async () => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.acceptAll;
    if (!api) return;
    try {
      const res = await api(cwd.name, { ...domainOpts });
      await refreshEntries();
      await refreshGhosts();
      setNotice({ variant: 'success', message: `已接受 ${res?.accepted || 0} 个，失败 ${res?.failed || 0} 个` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const rejectAllGhostsProject = async () => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.rejectAll;
    if (!api) return;
    try {
      const res = await api(cwd.name, { ...domainOpts });
      await refreshGhosts();
      setNotice({ variant: 'info', message: `已放弃 ${res?.rejected || 0} 个` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const acceptGroup = async (folderRelPath) => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.acceptAll;
    if (!api) return;
    try {
      const res = await api(cwd.name, { folderRelPath, ...domainOpts });
      await refreshEntries();
      await refreshGhosts();
      setNotice({ variant: 'success', message: `已接受 ${res?.accepted || 0} 个，失败 ${res?.failed || 0} 个` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const rejectGroup = async (folderRelPath) => {
    if (cwd.type !== 'project') return;
    const api = window.ipm?.aiStorage?.rejectAll;
    if (!api) return;
    try {
      const res = await api(cwd.name, { folderRelPath, ...domainOpts });
      await refreshGhosts();
      setNotice({ variant: 'info', message: `已放弃 ${res?.rejected || 0} 个` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const enterProject = async (name) => {
    await entityApi?.setCurrent?.(name);
    setCurrentProject(name);
    setCwd({ type: 'project', name, relPath: '' });
  };

  const enterLocalFolder = async (rootPath) => {
    const rp = String(rootPath || '').trim();
    if (!rp) return;
    setCwd({ type: 'local', rootPath: rp, relPath: '' });
  };

  const goRoot = async () => {
    if (isStudy) {
      setCwd({ type: 'project', name: '', relPath: '' });
      return;
    }
    setCwd({ type: 'root' });
    await refreshProjects();
    await refreshLocalFolders().catch(() => {});
  };

  const importLocalFolder = async () => {
    const api = window.ipm?.localFolders?.import;
    if (!api) {
      setNotice({ variant: 'error', message: 'localFolders/import 未就绪：请重启应用（不要只刷新页面）' });
      return;
    }
    try {
      const res = await api();
      await refreshLocalFolders();
      if (res?.canceled) return;
      setNotice({ variant: 'success', message: '已导入本地文件夹（仅用于浏览/基础文件操作）' });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const goParent = async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const parts = String(cwd.relPath || '').split('/').filter(Boolean);
    parts.pop();
    setCwd({ ...cwd, relPath: parts.join('/') });
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) {
      setErrorText(`请输入${entityLabel}名称`);
      return;
    }
    if (!entityApi?.create) {
      setErrorText('create 未就绪：请重启应用（不要只刷新页面）');
      return;
    }
    setErrorText('');
    try {
      await entityApi.create(name);
      setNewProjectName('');
      await refreshProjects();
      setCwd({ type: 'root' });
    } catch (e) {
      setErrorText(e?.message || String(e));
    }
  };

  const deleteProject = async (name) => {
    if (!entityApi?.delete) {
      setErrorText('delete 未就绪：请重启应用（不要只刷新页面）');
      return;
    }
    if (!window.confirm(`确定删除${entityLabel}「${name}」吗？此操作将删除整个文件夹（不可恢复）。`)) return;
    setErrorText('');
    try {
      await entityApi.delete(name);
      await refreshProjects();
      setCwd({ type: 'root' });
    } catch (e) {
      setErrorText(e?.message || String(e));
    }
  };

  const openNewFolder = () => {
    setNewFolderName('');
    setNewFolderBaseRelPath(cwd.type === 'project' || cwd.type === 'local' ? (cwd.relPath || '') : '');
    setNewFolderOpen(true);
  };

  const openNewFolderAt = (baseRelPath, folderLabel) => {
    setNewFolderName('');
    setNewFolderBaseRelPath(String(baseRelPath || ''));
    setNewFolderOpen(true);
    setNotice(null);
    setErrorText('');
  };

  const createFolder = async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const name = newFolderName.trim();
    if (!name) {
      setErrorText('请输入文件夹名称');
      return;
    }
    setErrorText('');
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.mkdir(cwd.name, newFolderBaseRelPath || '', name, domainOpts)
          : await window.ipm.localExplorer.mkdir(cwd.rootPath, newFolderBaseRelPath || '', name);
      if (res?.ok === false && res?.conflict) {
        setNotice({ variant: 'warn', message: '已取消创建（存在重名）' });
        return;
      }
      setNewFolderOpen(false);
      await refreshEntries();
      setNotice({ variant: 'success', message: `已创建文件夹：${res?.createdName || name}` });
    } catch (e) {
      setErrorText(e?.message || String(e));
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const uploadFiles = async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setErrorText('');
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.upload(cwd.name, cwd.relPath || '', domainOpts)
          : await window.ipm.localExplorer.upload(cwd.rootPath, cwd.relPath || '');
      if (res?.ok === false && res?.conflict) {
        setNotice({ variant: 'warn', message: '已取消上传（存在重名）' });
        return;
      }
      await refreshEntries();
      setNotice({ variant: 'success', message: '上传完成' });
    } catch (e) {
      setErrorText(e?.message || String(e));
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const uploadFilesAndAiClassify = async (files) => {
    // Requirement: only files (no folders), allow multi-select, serial, reuse floating/copyToTemp
    if (cwd.type !== 'project') {
      setNotice({ variant: 'warn', message: '仅支持在项目/案件/学习中使用（不支持本地文件夹视图）' });
      return;
    }
    if (!window.ipm?.floating?.copyToTemp) {
      setNotice({ variant: 'error', message: 'floating/copyToTemp 未就绪：请重启应用（不要只刷新页面）' });
      return;
    }
    const arr = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!arr.length) return;

    setErrorText('');
    setAiUpload({ running: true, current: 0, total: arr.length, fileName: '' });
    try {
      for (let i = 0; i < arr.length; i += 1) {
        const f = arr[i];
        const name = String(f?.name || 'file');
        const srcPath = String(
          f?.path || (window.ipm?.files?.getPathForFile ? window.ipm.files.getPathForFile(f) : '') || '',
        );
        setAiUpload({ running: true, current: i + 1, total: arr.length, fileName: name });
        if (!srcPath) throw new Error('未获取到文件路径：请在桌面应用中重新选择文件（不要在浏览器里打开 UI 页面）');
        await window.ipm.floating.copyToTemp(cwd.name, srcPath, name, domainOpts);
      }

      setNotice({ variant: 'success', message: `已放入 temp 并触发 AI 分类（${arr.length} 个）。稍后可在「AI 暂存区」查看建议。` });
      await refreshEntries();
      // AI 推荐写入是异步的：做一次轻微延迟刷新
      window.setTimeout(() => refreshGhosts().catch(() => {}), 700);
      window.setTimeout(() => refreshGhosts().catch(() => {}), 1500);
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    } finally {
      setAiUpload({ running: false, current: 0, total: 0, fileName: '' });
    }
  };

  const pickFilesAndAiClassify = () => {
    if (aiUpload.running) return;
    aiUploadInputRef.current?.click?.();
  };

  const uploadFilesTo = async (destRelPath, folderName) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setErrorText('');
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.upload(cwd.name, destRelPath || '', domainOpts)
          : await window.ipm.localExplorer.upload(cwd.rootPath, destRelPath || '');
      if (res?.ok === false && res?.conflict) {
        setNotice({ variant: 'warn', message: `已取消上传（「${folderName}」中存在重名）` });
        return;
      }
      await refreshEntries();
      setNotice({ variant: 'success', message: `已上传到「${folderName}」` });
    } catch (e) {
      setErrorText(e?.message || String(e));
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const deleteEntry = async (entry) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const label = entry.kind === 'dir' ? '文件夹' : '文件';
    if (!window.confirm(`确定删除${label}「${entry.name}」吗？此操作不可恢复。`)) return;
    setErrorText('');
    try {
      if (cwd.type === 'project') {
        await window.ipm.explorer.delete(cwd.name, entry.relPath, domainOpts);
      } else {
        await window.ipm.localExplorer.delete(cwd.rootPath, entry.relPath);
      }
      await refreshEntries();
      await refreshGhosts().catch(() => {});
      // Explorer view: update tree cache so the deleted folder disappears immediately
      if (viewMode === 'explorer') {
        const parts = String(entry.relPath || '').split('/').filter(Boolean);
        parts.pop();
        const parent = parts.join('/');
        await refreshTreeDir(parent);
        setTree((t) => {
          const next = { ...t };
          delete next[entry.relPath];
          return next;
        });
      }
      setNotice({ variant: 'success', message: '已删除' });
    } catch (e) {
      const raw = e?.message || String(e);
      const cleaned = raw
        .replace(/^Error invoking remote method 'explorer\/delete': Error:\s*/i, '')
        .replace(/^Error invoking remote method 'localExplorer\/delete': Error:\s*/i, '');
      setErrorText(cleaned);
      setNotice({ variant: 'error', message: cleaned });
    }
  };

  const openMenu = (x, y, items) => setMenu({ x, y, items });
  const closeMenu = () => setMenu(null);

  const openRename = (entry) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setRenameRelPath(entry.relPath);
    setRenameOldName(entry.name);
    setRenameNewName(entry.name);
    setRenameOpen(true);
  };

  const doRename = async () => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const newName = renameNewName.trim();
    if (!newName) {
      setNotice({ variant: 'warn', message: '新名称不能为空' });
      return;
    }
    if (newName === renameOldName) {
      setRenameOpen(false);
      setNotice({ variant: 'info', message: '名称未变化' });
      return;
    }
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.rename(cwd.name, renameRelPath, newName, domainOpts)
          : await window.ipm.localExplorer.rename(cwd.rootPath, renameRelPath, newName);
      if (res?.ok === false && res?.conflict) {
        setNotice({ variant: 'warn', message: '已取消重命名（存在重名）' });
        return;
      }
      setRenameOpen(false);
      await refreshEntries();
      setNotice({ variant: 'success', message: `已重命名为：${res?.renamedTo || newName}` });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const getDragPayload = (e) => {
    try {
      const raw = e.dataTransfer.getData('application/x-ipm-entry') || e.dataTransfer.getData('text/plain');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const onDragStartEntry = (e, entry) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setIsDragging(true);
    setDragOverFolderRelPath('');
    const payload = { relPath: entry.relPath, kind: entry.kind, name: entry.name };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-ipm-entry', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
  };

  const onDragEndAny = () => {
    setIsDragging(false);
    setDragOverFolderRelPath('');
  };

  const moveEntryTo = async (srcRelPath, destDirRelPath) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.move(cwd.name, srcRelPath, destDirRelPath || '', domainOpts)
          : await window.ipm.localExplorer.move(cwd.rootPath, srcRelPath, destDirRelPath || '');
      if (res?.ok === false && res?.conflict) {
        setNotice({ variant: 'warn', message: '已取消移动（存在重名）' });
        return;
      }
      // refresh current dir list and explorer tree cache
      await refreshEntries();
      // Explorer view: keep open state; refresh affected folders only
      if (viewMode === 'explorer') {
        const srcParts = String(srcRelPath || '').split('/').filter(Boolean);
        srcParts.pop();
        const srcParent = srcParts.join('/');
        await refreshTreeDir(destDirRelPath || '');
        if (srcParent !== (destDirRelPath || '')) await refreshTreeDir(srcParent);
      }
      setNotice({ variant: 'success', message: '移动完成' });
    } catch (e) {
      const raw = e?.message || String(e);
      // Only for explorer/move errors: strip Electron IPC prefix
      const cleaned = raw
        .replace(/^Error invoking remote method 'explorer\/move': Error:\s*/i, '')
        .replace(/^Error invoking remote method 'localExplorer\/move': Error:\s*/i, '');
      setNotice({ variant: 'error', message: cleaned });
    }
  };

  const onDropOnFolder = async (e, folderEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderRelPath('');
    const payload = getDragPayload(e);
    if (!payload?.relPath) return;
    if (folderEntry.kind !== 'dir') return;

    // no-op: drop onto itself
    if (payload.relPath === folderEntry.relPath) return;
    // prevent moving a folder into itself/descendant (client-side precheck)
    if (payload.kind === 'dir') {
      const src = String(payload.relPath);
      const dest = String(folderEntry.relPath);
      if (dest.startsWith(src + '/')) {
        setNotice({ variant: 'warn', message: '不能将文件夹移动到其自身或子目录中' });
        return;
      }
    }
    await moveEntryTo(payload.relPath, folderEntry.relPath);
  };

  const onDragOverFolder = (e, folderEntry) => {
    if (folderEntry.kind !== 'dir') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverFolderRelPath(folderEntry.relPath);
  };

  const onDragLeaveFolder = (_e, folderEntry) => {
    if (dragOverFolderRelPath === folderEntry.relPath) setDragOverFolderRelPath('');
  };

  const refreshTreeDir = async (relPath) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const key = normalizeRelPathPosix(relPath);
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.list(cwd.name, key, domainOpts)
          : await window.ipm.localExplorer.list(cwd.rootPath, key);
      setTree((t) => {
        const prev = t[key] || {};
        return {
          ...t,
          [key]: {
            open: prev.open ?? true,
            loading: false,
            entries: res.entries || [],
          },
        };
      });
    } catch (e) {
      // keep previous tree state; surface error gently
      const msg = e?.message || String(e);
      setNotice({ variant: 'error', message: msg });
    }
  };

  const handleBlankContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (isRoot) {
      openMenu(e.clientX, e.clientY, [
        {
          label: `新建${entityLabel}`,
          onClick: () => {
            setErrorText('');
            // focus header input
            setTimeout(() => newProjectInputRef.current?.focus(), 0);
          },
        },
      ]);
      return;
    }

    openMenu(e.clientX, e.clientY, [
      { label: '新建文件夹', onClick: () => openNewFolder() },
      { label: '上传文件', onClick: () => uploadFiles() },
      { label: '上传并AI分类', onClick: () => pickFilesAndAiClassify() },
    ]);
  };

  const handleRowContextMenuRoot = (e, projectName) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, [
      { label: `删除${entityLabel}：${projectName}`, danger: true, onClick: () => deleteProject(projectName) },
    ]);
  };

  const removeLocalFolder = async (absPath) => {
    const api = window.ipm?.localFolders?.remove;
    if (!api) return;
    if (!window.confirm('确定取消关联该本地文件夹吗？')) return;
    try {
      await api(absPath);
      await refreshLocalFolders();
      setNotice({ variant: 'info', message: '已取消关联' });
    } catch (e) {
      setNotice({ variant: 'error', message: e?.message || String(e) });
    }
  };

  const handleRowContextMenuLocalFolder = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, [
      { label: `取消关联：${folder?.name || '本地文件夹'}`, danger: true, onClick: () => removeLocalFolder(folder?.path) },
    ]);
  };

  const handleRowContextMenuEntry = (e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRoot) return;
    if (entry.kind === 'dir') {
      openMenu(e.clientX, e.clientY, [
        { label: `上传文件到文件夹「${entry.name}」`, onClick: () => uploadFilesTo(entry.relPath, entry.name) },
        { label: `在「${entry.name}」中新建文件夹`, onClick: () => openNewFolderAt(entry.relPath, entry.name) },
        { label: `重命名：${entry.name}`, onClick: () => openRename(entry) },
        { label: `删除文件夹：${entry.name}`, danger: true, onClick: () => deleteEntry(entry) },
      ]);
      return;
    }
    openMenu(e.clientX, e.clientY, [
      { label: `重命名：${entry.name}`, onClick: () => openRename(entry) },
      { label: `删除文件：${entry.name}`, danger: true, onClick: () => deleteEntry(entry) },
    ]);
  };

  const enterRelDir = async (relPath) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    setCwd({ ...cwd, relPath: normalizeRelPathPosix(relPath) });
  };

  const ensureTreeNode = async (relPath) => {
    if (cwd.type !== 'project' && cwd.type !== 'local') return;
    const key = normalizeRelPathPosix(relPath);
    setTree((t) => ({
      ...t,
      [key]: { ...(t[key] || {}), loading: true, open: true },
    }));
    try {
      const res =
        cwd.type === 'project'
          ? await window.ipm.explorer.list(cwd.name, key, domainOpts)
          : await window.ipm.localExplorer.list(cwd.rootPath, key);
      setTree((t) => ({
        ...t,
        [key]: { open: true, loading: false, entries: res.entries || [] },
      }));
    } catch (e) {
      setErrorText(e?.message || String(e));
      setTree((t) => ({
        ...t,
        [key]: { ...(t[key] || {}), loading: false, open: true, entries: [] },
      }));
    }
  };

  const toggleTreeDir = async (relPath) => {
    const key = normalizeRelPathPosix(relPath);
    const node = tree[key];
    // open it (and lazy load if needed)
    if (!node) {
      await ensureTreeNode(key);
      return;
    }
    if (!node.open) {
      setTree((t) => ({
        ...t,
        [key]: { ...(t[key] || {}), open: true },
      }));
      if (!Array.isArray(node.entries)) {
        await ensureTreeNode(key);
      }
      return;
    }
    // close it
    setTree((t) => ({
      ...t,
      [key]: { ...(t[key] || {}), open: false },
    }));
  };

  // Knowledge snippet linker (mock) page
  if (snippetLinkerCtx) {
    return (
      <SnippetLinkerMockPage
        projectName={snippetLinkerCtx?.name}
        onBack={() => setSnippetLinkerCtx(null)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative" onClick={closeMenu}>
      <ToastBubble notice={notice} onClear={() => setNotice(null)} autoCloseMs={4000} />
      {/* Hidden file input for “Upload & AI classify” (Electron gives file.path) */}
      <input
        ref={aiUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const arr = Array.from(e.target.files || []);
          // reset so selecting same file twice still triggers change
          e.target.value = '';
          void uploadFilesAndAiClassify(arr);
        }}
      />
      {/* Header */}
      <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div className="min-w-0 flex items-center gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-800 tracking-tight truncate">
              {isStudy
                ? `学习${cwd.type === 'project' && cwd.relPath ? ` / ${cwd.relPath}` : ''}`
                : isRoot
                  ? entityLabelAll
                : cwd.type === 'local'
                  ? `本地文件夹：${String(cwd.rootPath || '').split(/[/\\]+/).filter(Boolean).slice(-1)[0] || String(cwd.rootPath || '')}`
                    : `${entityLabel}文件：${title}`}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isStudy
                ? `路径：userfile/study${cwd.type === 'project' && cwd.relPath ? ` / ${cwd.relPath}` : ''}`
                : isRoot
                  ? `共 ${projects.length} 个${entityLabel}`
                : cwd.type === 'local'
                  ? `路径：${cwd.rootPath || ''}${cwd.relPath ? ` / ${cwd.relPath}` : ''}`
                    : `当前${entityLabel}：${cwd.name}${cwd.relPath ? ` / ${cwd.relPath}` : ''}`}
            </p>
          </div>

          {typeof onBackHome === 'function' ? (
            <button
              type="button"
              onClick={() => onBackHome()}
              className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              title="返回我的资料"
            >
              <ArrowLeft size={14} /> 返回我的资料
            </button>
          ) : null}

          {!(isStudy ? cwd.type === 'project' && !cwd.relPath : isRoot) && (
            <button
              type="button"
              onClick={goRoot}
              className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft size={14} /> 返回{entityLabelAll}
            </button>
          )}

          {/* View Switcher (keep original header UI) */}
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setViewModeSafe('list')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="List View"
            >
              <LayoutList size={16} />
            </button>
            <button
              type="button"
              onClick={() => setViewModeSafe('explorer')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'explorer' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Explorer View"
            >
              <Folders size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isRoot ? (
            <button
              type="button"
              onClick={importLocalFolder}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-200 transition-colors"
              title="导入一个本地文件夹（仅用于浏览/基础文件操作）"
            >
              导入本地
            </button>
          ) : null}

          {!isRoot && cwd.relPath ? (
            <button
              type="button"
              onClick={goParent}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-200 transition-colors"
            >
              上一级
            </button>
          ) : null}

          <div className="h-6 w-[1px] bg-slate-200"></div>

          <button
            type="button"
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            title="暂未实现"
          >
            <ListFilter size={14} /> 筛选
          </button>

          {!isRoot && (
            <div className="flex items-center gap-2">
              {pendingGhostsInCwd.length ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={acceptAllGhostsHere}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
                    title="接受本目录所有 AI 建议并移动"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Check size={14} /> 接受全部（{pendingGhostsInCwd.length}）
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={rejectAllGhostsHere}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    title="放弃本目录所有 AI 建议"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Ban size={14} /> 放弃全部
                    </span>
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={openNewFolder}
                className="px-4 py-1.5 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              >
                新建文件夹
              </button>
              <button
                type="button"
                onClick={uploadFiles}
                className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
                disabled={aiUpload.running}
              >
                上传文件
              </button>
              <button
                type="button"
                onClick={pickFilesAndAiClassify}
                disabled={aiUpload.running || cwd.type !== 'project'}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-sm ${
                  aiUpload.running || cwd.type !== 'project'
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
                title="选择一个或多个文件，逐个放入 temp，并逐个触发 AI 分类推荐"
              >
                {aiUpload.running ? `上传并AI分类 ${aiUpload.current}/${aiUpload.total}` : '上传并AI分类'}
              </button>
            </div>
          )}

          {isRoot ? (
            <div className="flex items-center gap-2">
              <input
                ref={newProjectInputRef}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="输入项目名"
                className="px-3 py-1.5 border border-slate-200 rounded text-sm text-slate-700 w-48 focus:outline-none focus:border-slate-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createProject();
                }}
              />
              <button
                type="button"
                onClick={createProject}
                className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm flex items-center gap-2"
              >
                <Plus size={14} /> 新建{entityLabel}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" onContextMenu={handleBlankContextMenu}>
        {/* Project root overview bar for pending AI ghost files */}
        {!isRoot && showOverviewBar ? (
          <div className="px-8 pt-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                onClick={() => setOverviewOpen((v) => !v)}
              >
                <div className="min-w-0 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200/60">
                    <Wand2 size={16} className="text-amber-600" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm font-semibold text-slate-800 truncate">
                      AI 暂存区：待处理 {pendingGhostCount} 个
                      {ghostLoading ? <span className="ml-2 text-[11px] text-slate-400 font-medium">同步中...</span> : null}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">分布在 {pendingGhostFolderCount} 个文件夹（点击展开）</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      acceptAllGhostsProject();
                    }}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                    title="一键接受全部（移动）"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Check size={14} /> 全部接受
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      rejectAllGhostsProject();
                    }}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    title="一键放弃全部"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Ban size={14} /> 全部放弃
                    </span>
                  </button>
                  <div className="text-slate-400">{overviewOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
                </div>
              </button>

              {overviewOpen ? (
                <div className="border-t border-slate-200 bg-slate-50/50">
                  <div className="px-4 py-3 space-y-2">
                    {pendingGhostGroups.map((g) => {
                      const open = Boolean(overviewExpanded[g.folderRelPath]);
                      const preview = g.items.slice(0, 2).map((x) => x.fileName || 'file');
                      const rest = Math.max(0, g.items.length - preview.length);
                      return (
                        <div key={g.folderRelPath} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-3 py-2 flex items-center justify-between gap-3">
                            <button
                              type="button"
                              className="min-w-0 flex items-center gap-2 text-left"
                              onClick={() => setOverviewExpanded((m) => ({ ...m, [g.folderRelPath]: !open }))}
                              title="展开/收起"
                            >
                              <div className="text-slate-400">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate">
                                  {g.folderRelPath}
                                  <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                    {g.items.length}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400 truncate">
                                  {preview.join('，')}
                                  {rest ? ` 等 +${rest}` : ''}
                                </div>
                              </div>
                            </button>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                                onClick={() => setCwd({ ...cwd, relPath: g.folderRelPath })}
                                title="跳转到该文件夹"
                              >
                                进入
                              </button>
                              <button
                                type="button"
                                className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                                onClick={() => acceptGroup(g.folderRelPath)}
                                title="接受该文件夹下的全部建议并移动"
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <Check size={12} /> 接受
                                </span>
                              </button>
                              <button
                                type="button"
                                className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                                onClick={() => rejectGroup(g.folderRelPath)}
                                title="放弃该文件夹下的全部建议"
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <Ban size={12} /> 放弃
                                </span>
                              </button>
                            </div>
                          </div>

                          {open ? (
                            <div className="border-t border-slate-200">
                              {g.items.map((it) => (
                                <div key={it.sourceRelPath} className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50">
                                  <div className="min-w-0">
                                    <div className="text-sm text-slate-800 truncate">{it.fileName || it.sourceRelPath}</div>
                                    <div className="text-[11px] text-slate-400 truncate">{it.sourceRelPath}</div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                                      onClick={() => acceptGhost(it.sourceRelPath)}
                                    >
                                      <span className="inline-flex items-center gap-1.5">
                                        <Check size={12} /> 接受
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                                      onClick={() => rejectGhost(it.sourceRelPath)}
                                    >
                                      <span className="inline-flex items-center gap-1.5">
                                        <Ban size={12} /> 放弃
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isRoot ? (
          <div className="px-8 py-4">
            {errorText && (
              <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
                {errorText}
              </div>
            )}
            <table className="w-full text-left border-separate border-spacing-y-1">
              <thead>
                <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
                  <th className="pb-4 pl-4 font-bold">{entityLabel}名称</th>
                  <th className="pb-4 font-bold">路径</th>
                  <th className="pb-4 text-right font-bold">状态</th>
                  <th className="pb-4 text-right pr-4 font-bold">整理知识</th>
                </tr>
              </thead>
              <tbody>
                {(localFolders || []).map((f) => {
                  const exists = Boolean(f?.exists);
                  const name = String(f?.name || '本地文件夹');
                  const p = String(f?.path || '');
                  const rowCls = exists
                    ? 'hover:bg-slate-50/50'
                    : 'bg-rose-50/70 hover:bg-rose-50 border border-rose-200/60';
                  return (
                    <tr
                      key={`__local__${p}`}
                      onClick={() => {
                        if (!exists) return;
                        enterLocalFolder(p);
                      }}
                      onContextMenu={(e) => handleRowContextMenuLocalFolder(e, f)}
                      className={`group transition-all duration-200 ${exists ? 'cursor-pointer' : 'cursor-not-allowed'} ${rowCls}`}
                      title={exists ? '点击进入该本地文件夹' : '该路径已失效（可能被移动/删除/重命名），右键可取消关联'}
                    >
                      <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded ${exists ? 'bg-slate-100 group-hover:bg-white' : 'bg-rose-100'} transition-colors`}>
                            <FolderOpen size={16} className={exists ? 'text-slate-600' : 'text-rose-600'} />
                          </div>
                          <div className={`text-sm font-medium ${exists ? 'text-slate-800' : 'text-rose-700'}`}>
                            {name}
                            <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900/5 text-slate-600 border border-slate-200">
                              本地
                            </span>
                            {!exists ? (
                              <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                                已失效
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 text-xs text-slate-400 font-medium border-y border-transparent truncate max-w-[420px]">
                        {p}
                      </td>
                      <td className="py-3.5 text-right text-xs text-slate-500 font-medium border-y border-transparent">
                        <div className="flex items-center justify-end">
                          <span className="text-[10px] font-bold px-2 py-1 rounded bg-white border border-slate-200 text-slate-600">
                            LOCAL
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 text-right pr-4 rounded-r text-xs text-slate-300 font-medium border-y border-transparent">
                        -
                      </td>
                    </tr>
                  );
                })}
                {projects.map((p) => (
                  <tr
                    key={p.name}
                    onClick={() => enterProject(p.name)}
                    onContextMenu={(e) => handleRowContextMenuRoot(e, p.name)}
                    className={`group cursor-pointer transition-all duration-200 ${rowStyleByStatus(p.status)}`}
                  >
                    <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-100 rounded group-hover:bg-white transition-colors">
                          <FolderOpen size={16} className="text-blue-600" />
                        </div>
                        <div className={`text-sm font-medium ${String(p.status || '').toLowerCase() === 'archived' ? 'text-slate-500' : 'text-slate-800'}`}>
                          {p.name}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 text-xs text-slate-400 font-medium border-y border-transparent truncate max-w-[420px]">
                      {p.path}
                    </td>
                    <td className="py-3.5 text-right text-xs text-slate-500 font-medium border-y border-transparent">
                      <div className="flex items-center justify-end gap-3">
                        {/* 3-state switch */}
                        <div
                          className="inline-flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm"
                          onClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => e.stopPropagation()}
                        >
                          {PROJECT_STATUSES.map((s) => {
                            const isOn = String(p.status || 'active').toLowerCase() === s;
                            const badge = badgeByStatus(s);
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setProjectStatus(p.name, s)}
                                className={`px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider transition-all border ${
                                  isOn ? `${badge.on} shadow-sm` : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                }`}
                                title={statusLabel(s)}
                              >
                                <span className={`inline-flex items-center gap-1`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dot} ring-4 ${badge.ring}`} />
                                  {statusLabel(s)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 text-right pr-4 rounded-r text-xs text-slate-500 font-medium border-y border-transparent">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors shadow-sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSnippetLinkerCtx({ name: p.name, path: p.path });
                        }}
                        title="进入知识碎片关联与管理页面（Mock）"
                      >
                        <Sparkles size={14} />
                        整理知识
                      </button>
                    </td>
                  </tr>
                ))}
                {!projects.length && !(localFolders || []).length && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-sm text-slate-400">
                      暂无{entityLabel}，点击右上角「新建{entityLabel}」
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-8 py-4 relative">
            {errorText && (
              <div className="mb-4 px-4 py-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">
                {errorText}
              </div>
            )}
            {viewMode === 'list' ? (
              <table className="w-full text-left border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-[11px] text-slate-400 uppercase tracking-widest font-bold">
                    <th className="pb-4 pl-4 font-bold">名称</th>
                    <th className="pb-4 font-bold">类型</th>
                    <th className="pb-4 font-bold">修改时间</th>
                    <th className="pb-4 text-right font-bold">大小</th>
                    <th className="pb-4 text-right pr-4 font-bold">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                        正在加载...
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    [
                      ...entries,
                      // Ghost files: AI staging suggestions for current folder only
                      ...(pendingGhostsInCwd || []).map((g) => ({
                        kind: 'ghost',
                        name: g.fileName || 'file',
                        relPath: `__ghost__${g.sourceRelPath}`,
                        _ghost: g,
                      })),
                    ].map((e) => (
                      <tr
                        key={e.relPath}
                        onContextMenu={e.kind === 'ghost' ? undefined : (evt) => handleRowContextMenuEntry(evt, e)}
                        onClick={() => {
                          if (e.kind === 'dir') enterRelDir(e.relPath);
                        }}
                        onDoubleClick={(evt) => {
                          // Double-click to open file via OS default app
                          if (e.kind === 'file') {
                            evt.preventDefault();
                            evt.stopPropagation();
                            openFileByRelPath(e.relPath);
                          }
                          // Ghost: open source file (always under temp/) for preview
                          if (e.kind === 'ghost') {
                            const src = e._ghost?.sourceRelPath;
                            if (!src) return;
                            evt.preventDefault();
                            evt.stopPropagation();
                            openFileByRelPath(src);
                          }
                        }}
                        className={`transition-all duration-200 hover:bg-slate-50/50 cursor-pointer ${
                          e.kind === 'dir' && dragOverFolderRelPath === e.relPath ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''
                        } ${e.kind === 'ghost' ? 'opacity-80 bg-amber-50/40 hover:bg-amber-50/60' : ''}`}
                        draggable={e.kind !== 'ghost'}
                        onDragStart={e.kind === 'ghost' ? undefined : (evt) => onDragStartEntry(evt, e)}
                        onDragEnd={e.kind === 'ghost' ? undefined : onDragEndAny}
                        onDragOver={e.kind === 'ghost' ? undefined : (evt) => onDragOverFolder(evt, e)}
                        onDragLeave={e.kind === 'ghost' ? undefined : (evt) => onDragLeaveFolder(evt, e)}
                        onDrop={e.kind === 'ghost' ? undefined : (evt) => onDropOnFolder(evt, e)}
                      >
                        <td className="py-3.5 pl-4 rounded-l border-y border-transparent">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded ${e.kind === 'dir' ? folderDecor(e.relPath).boxClass : 'bg-slate-100'}`}>
                              {e.kind === 'dir' ? (
                                (() => {
                                  const { Icon, iconClass } = folderDecor(e.relPath);
                                  return <Icon size={16} className={iconClass} />;
                                })()
                              ) : e.kind === 'ghost' ? (
                                <Wand2 size={16} className="text-amber-600" />
                              ) : (
                                <Folder size={16} className="text-slate-400" />
                              )}
                            </div>
                            <div className="text-sm font-medium text-slate-800">{e.name}</div>
                            {e.kind === 'ghost' ? (
                              <span className="ml-2 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                AI 建议
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3.5 text-xs text-slate-500 border-y border-transparent">
                          {e.kind === 'ghost' ? '幽灵文件' : e.kind === 'dir' ? '文件夹' : e.kind === 'file' ? '文件' : '其他'}
                        </td>
                        <td className="py-3.5 text-xs text-slate-400 font-medium border-y border-transparent">
                          {e.kind === 'ghost' ? '-' : fmtTime(e.mtimeMs)}
                        </td>
                        <td className="py-3.5 text-right text-xs text-slate-500 font-medium border-y border-transparent">
                          {e.kind === 'file' ? fmtBytes(e.sizeBytes) : '-'}
                        </td>
                        <td className="py-3.5 text-right pr-4 rounded-r border-y border-transparent">
                          {e.kind === 'ghost' ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
                                onClick={(evt) => {
                                  evt.preventDefault();
                                  evt.stopPropagation();
                                  acceptGhost(e._ghost?.sourceRelPath);
                                }}
                                title="接受 AI 建议并移动"
                              >
                                <Check size={12} /> 接受
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition-colors"
                                onClick={(evt) => {
                                  evt.preventDefault();
                                  evt.stopPropagation();
                                  rejectGhost(e._ghost?.sourceRelPath);
                                }}
                                title="放弃该建议"
                              >
                                <Ban size={12} /> 放弃
                              </button>
                            </div>
                          ) : e.kind === 'dir' && cwd.type === 'project' ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 hover:text-slate-800 transition-colors"
                              onClick={(evt) => {
                                evt.preventDefault();
                                evt.stopPropagation();
                                openFolderDetail(e);
                              }}
                              title="查看文件夹详情"
                            >
                              <Info size={12} /> 详情
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  {!loading && !entries.length && !errorText && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                        目录为空（右键空白处可新建文件夹/上传文件）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <div className="p-2" onContextMenu={handleBlankContextMenu}>
                <ExplorerFolder
                  name={
                    cwd.relPath
                      ? cwd.relPath.split('/').slice(-1)[0]
                      : cwd.type === 'local'
                        ? String(cwd.rootPath || '').split(/[/\\]+/).filter(Boolean).slice(-1)[0] || String(cwd.rootPath || '本地文件夹')
                        : cwd.name
                  }
                  relPath={cwd.relPath || ''}
                  depth={0}
                  tree={tree}
                  onToggle={toggleTreeDir}
                  onLoad={ensureTreeNode}
                  onEntryContextMenu={handleRowContextMenuEntry}
                  onOpenFile={openFileByRelPath}
                  onDragStartEntry={onDragStartEntry}
                  onDragEndAny={onDragEndAny}
                  onDropOnFolder={onDropOnFolder}
                  onDragOverFolder={onDragOverFolder}
                  onDragLeaveFolder={onDragLeaveFolder}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Folder Detail Overlay (covers main area; click outside to close) */}
      {detailOpen ? (
        <div className="absolute inset-0 z-[80]" onClick={closeFolderDetail}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className={`absolute top-0 right-0 h-full w-[360px] bg-slate-50 border-l border-slate-200 shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
              detailVisible ? 'translate-x-0' : 'translate-x-full'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Info size={12} className="text-slate-400" /> 文件夹详情
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-800 truncate">{detail?.entry?.name || '文件夹'}</div>
                <div className="mt-1 text-[11px] text-slate-400 truncate">{detail?.entry?.relPath || ''}</div>
              </div>
              <button
                type="button"
                className="p-1.5 rounded border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={closeFolderDetail}
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Properties</div>
                {detailLoading ? (
                  <div className="text-xs text-slate-400">加载中...</div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">名称</span>
                      <span className="font-medium text-slate-700 truncate max-w-[200px]">{detail?.entry?.name || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">路径</span>
                      <span className="font-medium text-slate-700 truncate max-w-[200px]">{detail?.entry?.relPath || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">修改时间</span>
                      <span className="font-medium text-slate-700">{fmtTime(detail?.entry?.mtimeMs || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">System</span>
                      <span className="font-medium text-slate-700">{detail?.folderMeta?.system ? 'true' : 'false'}</span>
                    </div>
                  </div>
                )}
              </section>

              <section className="bg-white border border-slate-200 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Description</div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] text-slate-400">
                    {detail?.folderMeta?.system ? '系统目录（不可编辑）' : descEditing ? '编辑模式' : '查看模式'}
                  </div>
                  {!detail?.folderMeta?.system ? (
                    descEditing ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-semibold bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
                          disabled={descSaving}
                          onClick={saveFolderDescription}
                        >
                          {descSaving ? '保存中…' : '保存'}
                        </button>
                        <button
                          type="button"
                          className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
                          disabled={descSaving}
                          onClick={() => {
                            const d = detail?.folderMeta?.description;
                            setDescDraft(typeof d === 'string' ? d : '');
                            setDescEditing(false);
                          }}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="px-2.5 py-1 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50"
                        onClick={() => setDescEditing(true)}
                      >
                        编辑
                      </button>
                    )
                  ) : null}
                </div>

                {descEditing && !detail?.folderMeta?.system ? (
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="为该文件夹写一段简介（可用于 Agent 检索/标签化）..."
                    className="w-full min-h-[120px] px-3 py-2 border border-slate-200 rounded text-sm text-slate-700 focus:outline-none focus:border-slate-400 bg-white"
                    disabled={descSaving}
                  />
                ) : (
                  <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {detail?.folderMeta?.description ? detail.folderMeta.description : <span className="text-slate-400">（暂无描述）</span>}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {/* New folder modal */}
      {newFolderOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setNewFolderOpen(false)}>
          <div className="w-[420px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-2">新建文件夹</div>
            <div className="text-xs text-slate-500 mb-3">
              将在目录创建：{cwd.type === 'project' ? `${cwd.name}${newFolderBaseRelPath ? `/${newFolderBaseRelPath}` : ''}` : '-'}
            </div>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder();
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded" onClick={() => setNewFolderOpen(false)}>
                取消
              </button>
              <button type="button" className="px-3 py-2 text-sm bg-slate-900 text-white rounded hover:bg-slate-800" onClick={createFolder}>
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rename modal */}
      {renameOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30" onClick={() => setRenameOpen(false)}>
          <div className="w-[420px] bg-white rounded-xl border border-slate-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-800 mb-2">重命名</div>
            <div className="text-xs text-slate-500 mb-3">原名称：{renameOldName}</div>
            <input
              value={renameNewName}
              onChange={(e) => setRenameNewName(e.target.value)}
              placeholder="新名称"
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-slate-400"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') doRename();
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded" onClick={() => setRenameOpen(false)}>
                取消
              </button>
              <button type="button" className="px-3 py-2 text-sm bg-slate-900 text-white rounded hover:bg-slate-800" onClick={doRename}>
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Context menu */}
      {menu ? (
        <div className="fixed inset-0 z-[70]" onClick={closeMenu} onContextMenu={(e) => e.preventDefault()}>
          <div
            className="absolute min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.items.map((it) => (
              <button
                key={it.label}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                  it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700'
                }`}
                onClick={() => {
                  closeMenu();
                  it.onClick?.();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const ExplorerFolder = ({
  name,
  relPath,
  depth,
  tree,
  onToggle,
  onLoad,
  onEntryContextMenu,
  onOpenFile,
  onDragStartEntry,
  onDragEndAny,
  onDropOnFolder,
  onDragOverFolder,
  onDragLeaveFolder,
}) => {
  const rp = normalizeRelPathPosix(relPath);
  const node = tree[rp];
  // UX: only auto-expand the root node. Deeper folders start collapsed.
  const defaultOpen = depth === 0;
  const isOpen = node?.open ?? defaultOpen;
  const isLoading = node?.loading ?? false;
  const children = node?.entries ?? null;

  useEffect(() => {
    // Only auto-load children when the folder is open.
    if (isOpen && children === null) onLoad(rp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rp, isOpen]);

  return (
    <div className="select-none">
      <div
        onClick={() => onToggle(rp)}
        onContextMenu={(evt) => {
          // folder itself: allow delete folder via same menu
          if (rp) onEntryContextMenu(evt, { kind: 'dir', name: name || '文件夹', relPath: rp });
        }}
        draggable={Boolean(rp)}
        onDragStart={(evt) => {
          if (!rp) return;
          onDragStartEntry?.(evt, { kind: 'dir', name: name || '文件夹', relPath: rp });
        }}
        onDragEnd={onDragEndAny}
        onDragOver={(evt) => onDragOverFolder?.(evt, { kind: 'dir', relPath: rp })}
        onDragLeave={(evt) => onDragLeaveFolder?.(evt, { kind: 'dir', relPath: rp })}
        onDrop={(evt) => onDropOnFolder?.(evt, { kind: 'dir', relPath: rp, name: name || '文件夹' })}
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-50 rounded cursor-pointer group transition-colors"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <div className="text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
        {(() => {
          const { Icon, iconClass, boxClass } = folderDecor(rp);
          // Explorer tree uses a smaller icon container, keep consistent tint.
          return <Icon size={18} className={`${iconClass} ${Icon === Folder ? 'fill-blue-500/10' : ''}`} strokeWidth={1.5} />;
        })()}
        <span className="text-sm text-slate-700 font-medium">{name || '项目根目录'}</span>
        {isLoading ? <span className="text-[10px] text-slate-400 ml-2">加载中...</span> : null}
      </div>
      {isOpen ? (
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-slate-100" style={{ marginLeft: `${depth * 20 + 15}px` }} />
          {Array.isArray(children) &&
            children.map((e) => {
              if (e.kind === 'dir') {
                return (
                  <ExplorerFolder
                    key={e.relPath}
                    name={e.name}
                    relPath={e.relPath}
                    depth={depth + 1}
                    tree={tree}
                    onToggle={onToggle}
                    onLoad={onLoad}
                    onEntryContextMenu={onEntryContextMenu}
                    onDragStartEntry={onDragStartEntry}
                    onDragEndAny={onDragEndAny}
                    onDropOnFolder={onDropOnFolder}
                    onDragOverFolder={onDragOverFolder}
                    onDragLeaveFolder={onDragLeaveFolder}
                  />
                );
              }
              return (
                <div
                  key={e.relPath}
                  onContextMenu={(evt) => onEntryContextMenu(evt, e)}
                  onDoubleClick={(evt) => {
                    if (e.kind !== 'file') return;
                    evt.preventDefault();
                    evt.stopPropagation();
                    onOpenFile?.(e.relPath);
                  }}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 text-slate-600 transition-all cursor-default"
                  style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
                  draggable
                  onDragStart={(evt) => onDragStartEntry?.(evt, e)}
                  onDragEnd={onDragEndAny}
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-4 h-4 flex items-center justify-center text-slate-400">•</div>
                    <span className="text-sm truncate">{e.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium shrink-0 pr-2">{fmtBytes(e.sizeBytes)}</div>
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
};

export default ProjectManager;



