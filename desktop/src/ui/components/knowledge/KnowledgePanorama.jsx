import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  FileText,
  Image,
  StickyNote,
  Globe,
  Search,
  Plus,
  ChevronDown,
  Loader2,
  Tag,
  Layers,
  BarChart3,
  Clock,
  Inbox,
  ArrowRight,
  Edit3,
  Camera,
  AlertCircle,
  CheckCircle2,
  X,
  Briefcase,
  FolderKanban,
  Check,
  Layout,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Construction,
  Hammer,
  Wrench,
  HardHat,
  Sparkles,
} from 'lucide-react';
import KnowledgeItemCard from './KnowledgeItemCard.jsx';
import KnowledgeDetailPanel from './KnowledgeDetailPanel.jsx';
import NoteEditorPage from './NoteEditorPage.jsx';
import WabiBoardPage from './WabiBoardPage.jsx';

const VIEWS = [
  { id: 'overview', label: '总览' },
  { id: 'manage', label: '知识管理' },
];

const TYPE_TABS = [
  { id: '', label: '全部', icon: Layers },
  { id: 'snippet', label: '文本', icon: FileText },
  { id: 'screenshot', label: '截图', icon: Image },
  { id: 'note', label: '笔记', icon: StickyNote },
  { id: 'webclip', label: '网页', icon: Globe },
];

const STAT_CARDS_CONFIG = [
  { key: 'total', label: '知识总数', icon: BookOpen, color: 'text-indigo-600 bg-indigo-50' },
  { key: 'snippets', label: '文本碎片', icon: FileText, color: 'text-slate-600 bg-slate-100' },
  { key: 'screenshots', label: '截图', icon: Image, color: 'text-violet-600 bg-violet-50' },
  { key: 'notes', label: '笔记', icon: StickyNote, color: 'text-emerald-600 bg-emerald-50' },
  { key: 'webclips', label: '网页剪藏', icon: Globe, color: 'text-blue-600 bg-blue-50' },
  { key: 'drafts', label: '草稿', icon: Edit3, color: 'text-amber-600 bg-amber-50' },
];

function AnimatedNumber({ value, duration = 400 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const target = Number(value) || 0;
    const start = ref.current ?? 0;
    if (start === target) { setDisplay(target); return; }
    const t0 = performance.now();
    let raf;
    const step = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (target - start) * ease));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    ref.current = target;
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{display}</>;
}

export default function KnowledgePanorama({ onNavigateToProject }) {
  const [view, setView] = useState('overview');
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  const [activeType, setActiveType] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [groupByTag, setGroupByTag] = useState(false);

  const [activeItemId, setActiveItemId] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [noteEditId, setNoteEditId] = useState(null);

  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createSnippetOpen, setCreateSnippetOpen] = useState(false);
  const [createSnippetText, setCreateSnippetText] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [createNoteTitle, setCreateNoteTitle] = useState('');
  const [createWebclipOpen, setCreateWebclipOpen] = useState(false);
  const [webclipUrl, setWebclipUrl] = useState('');
  const [webclipLoading, setWebclipLoading] = useState(false);
  const [webclipResult, setWebclipResult] = useState(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignItemId, setAssignItemId] = useState(null);
  const [assignProjects, setAssignProjects] = useState([]);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSelected, setAssignSelected] = useState(null);
  const [assignBusy, setAssignBusy] = useState(false);

  const [boardOpen, setBoardOpen] = useState(false);
  const [studyKnowledgeOpen, setStudyKnowledgeOpen] = useState(false);

  const [appeared, setAppeared] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setAppeared(true)); }, []);

  const api = window.ipm?.knowledge;

  const loadStats = useCallback(async () => {
    if (!api?.statsGlobal) return;
    setStatsLoading(true);
    try {
      const res = await api.statsGlobal();
      if (res?.ok) setStats(res.stats);
    } catch { /* */ }
    setStatsLoading(false);
  }, [api]);

  const loadItems = useCallback(async () => {
    if (!api?.listGlobal) return;
    setLoading(true);
    try {
      const filters = {};
      if (activeType) filters.type = activeType;
      if (searchQuery.trim()) filters.search = searchQuery.trim();
      if (projectFilter) filters.projectName = projectFilter;
      if (domainFilter) filters.domain = domainFilter;
      if (domainFilter === 'draft') filters.draftsOnly = true;
      const res = await api.listGlobal(filters);
      if (res?.ok) {
        setItems(res.items || []);
        setTotalCount(res.total || 0);
      }
    } catch { /* */ }
    setLoading(false);
  }, [api, activeType, searchQuery, projectFilter, domainFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    if (!api?.subscribe) return;
    const unsub = api.subscribe(() => { loadItems(); loadStats(); });
    return unsub;
  }, [api, loadItems, loadStats]);

  const loadDetail = useCallback(async (item) => {
    if (!item) { setDetailItem(null); setActiveItemId(null); return; }
    setActiveItemId(item.id);
    if (item._domain === 'draft') {
      setDetailItem({ ...item, projectName: null, domain: 'draft' });
    } else {
      try {
        const res = await api?.get?.(item._projectName, item.id, item._domain ? { domain: item._domain } : {});
        if (res?.ok && res.item) {
          setDetailItem({ ...res.item, projectName: item._projectName, domain: item._domain, _projectDir: item._projectDir });
        } else {
          setDetailItem({ ...item, projectName: item._projectName, domain: item._domain });
        }
      } catch {
        setDetailItem({ ...item, projectName: item._projectName, domain: item._domain });
      }
    }
  }, [api]);

  const handleUpdate = useCallback(async (updated) => {
    if (!updated || !detailItem) return;
    const pn = detailItem.projectName || detailItem._projectName;
    const dm = detailItem.domain || detailItem._domain;
    if (dm === 'draft' || !pn) return;
    const patch = {};
    if (updated.title !== undefined) patch.title = updated.title;
    if (updated.content_text !== undefined) patch.content_text = updated.content_text;
    if (updated.content_json !== undefined) patch.content_json = updated.content_json;
    if (updated.importance !== undefined) patch.importance = updated.importance;
    if (updated.tags !== undefined) patch.tags = updated.tags;
    if (updated.pinned !== undefined) patch.pinned = updated.pinned;
    if (updated.archived !== undefined) patch.archived = updated.archived;
    try {
      await api?.update?.(pn, updated.id, patch, dm ? { domain: dm } : {});
      loadItems();
    } catch { /* */ }
  }, [api, detailItem, loadItems]);

  const handleDelete = useCallback(async (itemToDelete) => {
    if (!itemToDelete || !detailItem) return;
    const pn = detailItem.projectName || detailItem._projectName;
    const dm = detailItem.domain || detailItem._domain;
    if (!pn && dm !== 'draft') return;
    if (!window.confirm(`确定删除「${itemToDelete.title || '未命名'}」吗？`)) return;
    try {
      if (dm === 'draft') {
        await api?.delete?.(null, itemToDelete.id, { domain: 'study' });
      } else {
        await api?.delete?.(pn, itemToDelete.id, dm ? { domain: dm } : {});
      }
      setDetailItem(null);
      setActiveItemId(null);
      loadItems();
      loadStats();
    } catch { /* */ }
  }, [api, detailItem, loadItems, loadStats]);

  const handleTogglePin = useCallback(async (itemObj) => {
    if (!itemObj || !detailItem) return;
    const pn = detailItem.projectName || detailItem._projectName;
    const dm = detailItem.domain || detailItem._domain;
    if (dm === 'draft' || !pn) return;
    try { await api?.update?.(pn, itemObj.id, { pinned: !itemObj.pinned }, dm ? { domain: dm } : {}); loadItems(); } catch { /* */ }
  }, [api, detailItem, loadItems]);

  const handleToggleArchive = useCallback(async (itemObj) => {
    if (!itemObj || !detailItem) return;
    const pn = detailItem.projectName || detailItem._projectName;
    const dm = detailItem.domain || detailItem._domain;
    if (dm === 'draft' || !pn) return;
    try { await api?.update?.(pn, itemObj.id, { archived: !itemObj.archived }, dm ? { domain: dm } : {}); loadItems(); } catch { /* */ }
  }, [api, detailItem, loadItems]);

  const handleAddToTempBoard = useCallback(async (knowledgeItem) => {
    if (!knowledgeItem?.id) return;
    try {
      const boardApi = window.ipm?.board;
      if (!boardApi) return;
      const { boards } = await boardApi.list();
      let tempBoard = boards?.find((b) => b.name === '临时看板');
      if (!tempBoard) {
        const res = await boardApi.create('临时看板');
        tempBoard = res?.board;
      }
      if (!tempBoard?.id) return;
      const pn = knowledgeItem.projectName || knowledgeItem._projectName || '';
      const dm = knowledgeItem.domain || knowledgeItem._domain || '';
      await boardApi.addItem({
        boardId: tempBoard.id,
        knowledgeId: knowledgeItem.id,
        sourceProject: pn,
        sourceDomain: dm,
        x: 100 + Math.random() * 400,
        y: 100 + Math.random() * 300,
      });
    } catch (err) {
      console.error('Add to temp board failed:', err);
    }
  }, []);

  // Draft creation
  const handleCreateSnippet = useCallback(async () => {
    if (!createSnippetText.trim() || createBusy) return;
    setCreateBusy(true);
    try {
      await api?.createDraft?.({ type: 'snippet', content_text: createSnippetText });
      setCreateSnippetOpen(false);
      setCreateSnippetText('');
      loadItems(); loadStats();
    } catch { /* */ }
    setCreateBusy(false);
  }, [api, createSnippetText, createBusy, loadItems, loadStats]);

  const handleCreateNote = useCallback(async () => {
    if (!createNoteTitle.trim() || createBusy) return;
    setCreateBusy(true);
    try {
      const res = await api?.createDraft?.({ type: 'note', title: createNoteTitle, content_text: '' });
      setCreateNoteOpen(false);
      setCreateNoteTitle('');
      if (res?.ok && res.item) setNoteEditId(res.item.id);
      loadItems(); loadStats();
    } catch { /* */ }
    setCreateBusy(false);
  }, [api, createNoteTitle, createBusy, loadItems, loadStats]);

  const handleCreateWebclip = useCallback(async () => {
    if (!webclipUrl.trim() || webclipLoading) return;
    setWebclipLoading(true);
    setWebclipResult(null);
    try {
      const res = await api?.createDraft?.({ type: 'webclip', url: webclipUrl });
      if (res?.ok) {
        setWebclipResult({ ok: true });
        setTimeout(() => { setCreateWebclipOpen(false); setWebclipUrl(''); setWebclipResult(null); }, 1200);
      } else {
        setWebclipResult({ ok: false, error: res?.error || '创建失败' });
      }
      loadItems(); loadStats();
    } catch (e) {
      setWebclipResult({ ok: false, error: e.message });
    }
    setWebclipLoading(false);
  }, [api, webclipUrl, webclipLoading, loadItems, loadStats]);

  const handleCreateScreenshot = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp';
    input.onchange = async () => {
      if (!input.files?.length) return;
      try {
        const file = input.files[0];
        const arrayBuf = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuf);
        await api?.createDraft?.({ type: 'screenshot', pngBuffer: buffer });
        loadItems(); loadStats();
      } catch { /* */ }
    };
    input.click();
  }, [api, loadItems, loadStats]);

  // Assign draft
  const openAssign = useCallback(async (itemId) => {
    setAssignItemId(itemId);
    setAssignOpen(true);
    setAssignSearch('');
    setAssignSelected(null);
    try {
      const res = await api?.listProjects?.();
      if (res?.ok) setAssignProjects(res.projects || []);
    } catch { /* */ }
  }, [api]);

  const handleAssign = useCallback(async () => {
    if (!assignSelected || !assignItemId || assignBusy) return;
    setAssignBusy(true);
    try {
      await api?.assignDraft?.(assignItemId, assignSelected.name, assignSelected.domain);
      setAssignOpen(false);
      setDetailItem(null);
      setActiveItemId(null);
      loadItems(); loadStats();
    } catch { /* */ }
    setAssignBusy(false);
  }, [api, assignItemId, assignSelected, assignBusy, loadItems, loadStats]);

  // Grouped by tag
  const groupedItems = useMemo(() => {
    if (!groupByTag) return null;
    const groups = {};
    for (const it of items) {
      const tags = Array.isArray(it.tags) ? it.tags : [];
      if (tags.length === 0) {
        (groups['未标记'] = groups['未标记'] || []).push(it);
      } else {
        for (const t of tags) {
          (groups[t] = groups[t] || []).push(it);
        }
      }
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [items, groupByTag]);

  // Project list from stats for filter dropdown
  const projectOptions = useMemo(() => {
    if (!stats?.byProject) return [];
    return stats.byProject.filter((p) => p.total > 0);
  }, [stats]);

  // Recent items for overview
  const recentItems = useMemo(() => items.slice(0, 8), [items]);

  // Board full-page view with edit navigation support
  if (boardOpen) {
    return <WabiBoardPage onBack={(navData) => {
      setBoardOpen(false);
      if (navData?.navigate) {
        setView('manage');
        if (navData.navigate.project) setProjectFilter(navData.navigate.project);
        if (navData.navigate.domain) setDomainFilter(navData.navigate.domain);
        if (navData.navigate.search) setSearchQuery(navData.navigate.search);
      }
    }} />;
  }

  // Study knowledge management view
  if (studyKnowledgeOpen) {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="flex items-center gap-3 px-8 py-4 border-b border-slate-100">
          <button
            onClick={() => setStudyKnowledgeOpen(false)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition"
          >
            <ArrowRight size={14} className="rotate-180" />
            返回知识库
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <Edit3 size={14} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">学习分区知识管理</h2>
              <p className="text-[10px] text-slate-400">管理草稿和学习空间的知识碎片</p>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-8 py-5">
          <StudyKnowledgeList
            api={api}
            onClickItem={loadDetail}
            activeItemId={activeItemId}
          />
        </div>
      </div>
    );
  }

  // NoteEditor
  if (noteEditId) {
    return (
      <NoteEditorPage
        projectName={null}
        domain="study"
        itemId={noteEditId}
        onBack={() => { setNoteEditId(null); loadItems(); }}
        onAddToTempBoard={handleAddToTempBoard}
      />
    );
  }

  return (
    <div className={`flex flex-col h-full bg-white transition-opacity duration-300 ${appeared ? 'opacity-100' : 'opacity-0'}`}>
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-6 pb-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <BookOpen size={18} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">知识库</h1>
              <p className="text-xs text-slate-400 mt-0.5">跨项目知识中台 · 浏览、搜索、创建</p>
            </div>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`relative px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                view === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'overview' ? (
          <OverviewView
            stats={stats}
            statsLoading={statsLoading}
            recentItems={recentItems}
            onClickItem={loadDetail}
            onSwitchToManage={() => setView('manage')}
            onOpenBoard={() => setBoardOpen(true)}
          />
        ) : (
          <ManageView
            items={items}
            totalCount={totalCount}
            loading={loading}
            stats={stats}
            activeType={activeType}
            onTypeChange={setActiveType}
            projectFilter={projectFilter}
            domainFilter={domainFilter}
            onProjectFilterChange={(name, domain) => { setProjectFilter(name); setDomainFilter(domain); }}
            projectOptions={projectOptions}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchFocused={searchFocused}
            onSearchFocus={setSearchFocused}
            groupByTag={groupByTag}
            onGroupByTagChange={setGroupByTag}
            groupedItems={groupedItems}
            activeItemId={activeItemId}
            onClickItem={loadDetail}
            createMenuOpen={createMenuOpen}
            onCreateMenuToggle={setCreateMenuOpen}
            onCreateSnippet={() => { setCreateSnippetOpen(true); setCreateMenuOpen(false); }}
            onCreateNote={() => { setCreateNoteOpen(true); setCreateMenuOpen(false); }}
            onCreateWebclip={() => { setCreateWebclipOpen(true); setCreateMenuOpen(false); }}
            onCreateScreenshot={() => { handleCreateScreenshot(); setCreateMenuOpen(false); }}
            onNavigateToProject={onNavigateToProject}
            onStudyEntry={() => setStudyKnowledgeOpen(true)}
          />
        )}
      </div>

      {/* Detail Panel slide-in */}
      <KnowledgeDetailPanel
        item={detailItem}
        isOpen={!!detailItem}
        onClose={() => { setDetailItem(null); setActiveItemId(null); }}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        onEditNote={(id) => setNoteEditId(id)}
        onConvertToNote={async (id) => {
          if (!detailItem) return;
          const pn = detailItem.projectName || detailItem._projectName;
          const dm = detailItem.domain || detailItem._domain;
          if (!pn && dm !== 'draft') return;
          try {
            if (dm === 'draft') {
              await api?.update?.(null, id, { type: 'note' }, { domain: 'study' });
            } else {
              await api?.update?.(pn, id, { type: 'note' }, dm ? { domain: dm } : {});
            }
            loadItems();
            setNoteEditId(id);
          } catch { /* */ }
        }}
        projectName={detailItem?.projectName || detailItem?._projectName}
        domain={detailItem?.domain || detailItem?._domain}
        isDraft={detailItem?.source_kind === 'draft'}
        onAssignDraft={() => openAssign(detailItem?.id)}
        onAddToTempBoard={handleAddToTempBoard}
      />

      {/* Create Snippet Modal */}
      {createSnippetOpen && (
        <ModalOverlay onClose={() => setCreateSnippetOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">新建文本草稿</h3>
            <textarea
              autoFocus
              value={createSnippetText}
              onChange={(e) => setCreateSnippetText(e.target.value)}
              placeholder="输入文本内容..."
              className="w-full h-32 rounded-xl border border-slate-200 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setCreateSnippetOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">取消</button>
              <button onClick={handleCreateSnippet} disabled={!createSnippetText.trim() || createBusy} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition">
                {createBusy ? <Loader2 size={14} className="animate-spin" /> : '创建草稿'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Create Note Modal */}
      {createNoteOpen && (
        <ModalOverlay onClose={() => setCreateNoteOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">新建笔记草稿</h3>
            <input
              autoFocus
              value={createNoteTitle}
              onChange={(e) => setCreateNoteTitle(e.target.value)}
              placeholder="笔记标题..."
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNote(); }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setCreateNoteOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">取消</button>
              <button onClick={handleCreateNote} disabled={!createNoteTitle.trim() || createBusy} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition">
                {createBusy ? <Loader2 size={14} className="animate-spin" /> : '创建并编辑'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Create Webclip Modal */}
      {createWebclipOpen && (
        <ModalOverlay onClose={() => { if (!webclipLoading) { setCreateWebclipOpen(false); setWebclipResult(null); } }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">网页剪藏草稿</h3>
            <div className="flex gap-2">
              <input
                autoFocus
                value={webclipUrl}
                onChange={(e) => setWebclipUrl(e.target.value)}
                placeholder="输入网页 URL..."
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateWebclip(); }}
              />
              <button onClick={handleCreateWebclip} disabled={!webclipUrl.trim() || webclipLoading} className="px-4 py-2.5 text-sm bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50 transition shrink-0">
                {webclipLoading ? <Loader2 size={14} className="animate-spin" /> : '抓取'}
              </button>
            </div>
            {webclipResult && (
              <div className={`mt-3 flex items-center gap-2 text-sm ${webclipResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {webclipResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                {webclipResult.ok ? '已创建草稿' : webclipResult.error}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* Assign Draft Modal */}
      {assignOpen && (
        <ModalOverlay onClose={() => setAssignOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-1">将草稿归属到项目</h3>
            <p className="text-xs text-slate-400 mb-4">选择目标项目，草稿将转为正式知识碎片</p>
            <input
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              placeholder="搜索项目..."
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition mb-3"
            />
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {['projects', 'cases'].map((domain) => {
                const filtered = assignProjects
                  .filter((p) => p.domain === domain)
                  .filter((p) => !assignSearch || p.name.toLowerCase().includes(assignSearch.toLowerCase()));
                if (filtered.length === 0) return null;
                return (
                  <div key={domain}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1.5 mt-1">
                      {domain === 'projects' ? '项目' : '案件'}
                    </div>
                    {filtered.map((p) => (
                      <button
                        key={`${p.domain}-${p.name}`}
                        onClick={() => setAssignSelected(p)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                          assignSelected?.name === p.name && assignSelected?.domain === p.domain
                            ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                );
              })}
              {assignProjects.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-6">暂无项目</div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
              <button onClick={() => setAssignOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">取消</button>
              <button onClick={handleAssign} disabled={!assignSelected || assignBusy} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                {assignBusy ? <Loader2 size={14} className="animate-spin" /> : '确认归属'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal overlay helper                                               */
/* ------------------------------------------------------------------ */
function ModalOverlay({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Overview View                                                      */
/* ------------------------------------------------------------------ */
const PREVIEW_TYPE_COLORS = {
  snippet: '#F59E0B',
  note: '#10B981',
  screenshot: '#EC4899',
  webclip: '#4a9e8e',
  draft: '#D97706',
};

const PREVIEW_GROUP_COLORS = {
  default: 'rgba(74,158,142,0.12)',
  blackboard: 'rgba(35,40,44,0.18)',
  whiteboard: 'rgba(240,240,240,0.5)',
  macwindow: 'rgba(200,200,200,0.15)',
};

function BoardPreviewCard({ onOpenBoard }) {
  const [boards, setBoards] = useState([]);
  const [mainBoardItems, setMainBoardItems] = useState([]);
  const [mainBoardGroups, setMainBoardGroups] = useState([]);
  const [mainBoardConns, setMainBoardConns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await window.ipm.board.list();
        if (cancelled) return;
        const list = res?.boards || [];
        setBoards(list);
        const main = list.find((b) => b.is_main) || list[0];
        if (main) {
          const [itemsRes, groupsRes, connsRes] = await Promise.all([
            window.ipm.board.getItems(main.id),
            window.ipm.board.listGroups(main.id),
            window.ipm.board.listConnections(main.id),
          ]);
          if (!cancelled) {
            setMainBoardItems(itemsRes?.items || []);
            setMainBoardGroups(groupsRes?.groups || []);
            setMainBoardConns(connsRes?.connections || []);
          }
        }
      } catch { /* */ }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const mainBoard = boards.find((b) => b.is_main) || boards[0];

  const preview = useMemo(() => {
    const items = mainBoardItems;
    const groups = mainBoardGroups;
    const conns = mainBoardConns;
    if (items.length === 0 && groups.length === 0) return null;

    const groupsMap = {};
    for (const g of groups) groupsMap[g.id] = g;

    const absItems = items.map((it) => {
      const g = it.group_id ? groupsMap[it.group_id] : null;
      return { ...it, absX: g ? g.x + it.x : it.x, absY: g ? g.y + it.y : it.y };
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of absItems) {
      minX = Math.min(minX, it.absX);
      minY = Math.min(minY, it.absY);
      maxX = Math.max(maxX, it.absX + (it.width || 240));
      maxY = Math.max(maxY, it.absY + (it.height || 150));
    }
    for (const g of groups) {
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }

    const pad = 60;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;

    return { absItems, groups, conns, minX, minY, worldW, worldH, groupsMap };
  }, [mainBoardItems, mainBoardGroups, mainBoardConns]);

  const typeCounts = useMemo(() => {
    const m = { snippet: 0, note: 0, screenshot: 0, webclip: 0, draft: 0 };
    for (const it of mainBoardItems) {
      const k = it.knowledge;
      const t = k?.source_kind === 'draft' ? 'draft' : (k?.type || 'snippet');
      m[t] = (m[t] || 0) + 1;
    }
    return m;
  }, [mainBoardItems]);

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer group relative"
      style={{
        background: 'linear-gradient(135deg, #F8FAF9 0%, #F0F5F3 100%)',
        border: '1px solid rgba(74,158,142,0.15)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
      onClick={onOpenBoard}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 12px 32px -8px rgba(74,158,142,0.15)'; e.currentTarget.style.borderColor = 'rgba(74,158,142,0.3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = 'rgba(74,158,142,0.15)'; }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(74,158,142,0.12)', boxShadow: '0 2px 6px rgba(74,158,142,0.08)' }}>
            <Layout size={16} style={{ color: '#4a9e8e' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 leading-tight">Oryzae Board</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {mainBoard?.name || '暂无看板'} · {mainBoardItems.length} 碎片
              {mainBoardGroups.length > 0 && ` · ${mainBoardGroups.length} 分组`}
              {mainBoardConns.length > 0 && ` · ${mainBoardConns.length} 连线`}
            </p>
          </div>
        </div>
        <button
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200 opacity-0 group-hover:opacity-100"
          style={{ color: 'white', background: '#4a9e8e', boxShadow: '0 2px 8px rgba(74,158,142,0.3)' }}
          onClick={(e) => { e.stopPropagation(); onOpenBoard(); }}
        >
          打开看板 <ExternalLink size={11} />
        </button>
      </div>

      {/* SVG Preview */}
      <div style={{ height: 260, position: 'relative', overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={22} className="animate-spin" style={{ color: 'rgba(74,158,142,0.3)' }} />
          </div>
        ) : !preview ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(74,158,142,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layout size={22} style={{ color: 'rgba(74,158,142,0.25)' }} />
            </div>
            <p className="text-xs text-slate-400">看板是空的，点击开始整理知识碎片</p>
          </div>
        ) : (
          <svg
            viewBox={`${preview.minX} ${preview.minY} ${preview.worldW} ${preview.worldH}`}
            width="100%" height="100%"
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0 }}
          >
            <defs>
              <filter id="bp-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000" floodOpacity="0.06" />
              </filter>
              <linearGradient id="bp-conn-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(220,100,100,0.3)" />
                <stop offset="100%" stopColor="rgba(220,100,100,0.15)" />
              </linearGradient>
            </defs>

            {/* Groups */}
            {preview.groups.map((g) => (
              <rect
                key={g.id}
                x={g.x} y={g.y} width={g.width} height={g.height}
                rx={8} ry={8}
                fill={PREVIEW_GROUP_COLORS[g.frame_style] || PREVIEW_GROUP_COLORS.default}
                stroke={g.frame_style === 'blackboard' ? 'rgba(255,255,255,0.08)' : 'rgba(74,158,142,0.15)'}
                strokeWidth={2}
                strokeDasharray="8 4"
              />
            ))}

            {/* Connections */}
            {preview.conns.map((c) => {
              const fromItem = preview.absItems.find((it) => it.id === c.from_item_id);
              const toItem = preview.absItems.find((it) => it.id === c.to_item_id);
              const fromGroup = preview.groups.find((g) => g.id === c.from_item_id);
              const toGroup = preview.groups.find((g) => g.id === c.to_item_id);
              const from = fromItem ? { x: fromItem.absX + (fromItem.width || 240) / 2, y: fromItem.absY + (fromItem.height || 150) / 2 }
                : fromGroup ? { x: fromGroup.x + fromGroup.width / 2, y: fromGroup.y + fromGroup.height / 2 } : null;
              const to = toItem ? { x: toItem.absX + (toItem.width || 240) / 2, y: toItem.absY + (toItem.height || 150) / 2 }
                : toGroup ? { x: toGroup.x + toGroup.width / 2, y: toGroup.y + toGroup.height / 2 } : null;
              if (!from || !to) return null;
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2 - 30;
              return (
                <path
                  key={c.id}
                  d={`M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`}
                  fill="none" stroke="rgba(200,90,90,0.25)" strokeWidth={2.5}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Cards */}
            {preview.absItems.map((it) => {
              const type = it.knowledge?.source_kind === 'draft' ? 'draft' : (it.knowledge?.type || 'snippet');
              const color = PREVIEW_TYPE_COLORS[type] || '#9CA3AF';
              const w = it.width || 240;
              const h = it.height || 150;
              return (
                <g key={it.id} filter="url(#bp-shadow)">
                  <rect
                    x={it.absX} y={it.absY} width={w} height={h}
                    rx={6} ry={6}
                    fill="white" stroke={color} strokeWidth={1.5} opacity={0.92}
                  />
                  <rect
                    x={it.absX} y={it.absY} width={w} height={6}
                    rx={3} ry={3}
                    fill={color} opacity={0.7}
                  />
                  {it.knowledge?.title && (
                    <text
                      x={it.absX + 10} y={it.absY + 28}
                      fontSize={14} fill="#374151" fontWeight="500" fontFamily="system-ui, sans-serif"
                    >
                      {it.knowledge.title.length > 16 ? it.knowledge.title.slice(0, 16) + '…' : it.knowledge.title}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Hover overlay */}
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300"
          style={{ background: 'rgba(248,250,249,0.6)', backdropFilter: 'blur(2px)' }}
        >
          <span className="px-5 py-2.5 rounded-full text-sm font-medium transition-transform duration-200 group-hover:scale-105"
            style={{ background: '#4a9e8e', color: 'white', boxShadow: '0 4px 14px rgba(74,158,142,0.3)' }}>
            打开看板
          </span>
        </div>
      </div>

      {/* Bottom stats bar */}
      {mainBoardItems.length > 0 && (
        <div className="flex items-center gap-4 px-5 py-2.5" style={{ borderTop: '1px solid rgba(74,158,142,0.08)' }}>
          {Object.entries(typeCounts).filter(([, v]) => v > 0).map(([type, count]) => {
            const labels = { snippet: '文本', note: '笔记', screenshot: '截图', webclip: '网页', draft: '草稿' };
            return (
              <div key={type} className="flex items-center gap-1.5">
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: PREVIEW_TYPE_COLORS[type] }} />
                <span className="text-[10px] text-slate-400">{labels[type]} {count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Insight Carousel ---------- */
const CAROUSEL_BAR_COLORS = {
  snippets: { bar: 'linear-gradient(90deg, #F59E0B, #FBBF24)', dot: '#F59E0B' },
  screenshots: { bar: 'linear-gradient(90deg, #EC4899, #F472B6)', dot: '#EC4899' },
  notes: { bar: 'linear-gradient(90deg, #10B981, #34D399)', dot: '#10B981' },
  webclips: { bar: 'linear-gradient(90deg, #4a9e8e, #6DC5B4)', dot: '#4a9e8e' },
  drafts: { bar: 'linear-gradient(90deg, #D97706, #F59E0B)', dot: '#D97706' },
};

function InsightCarousel({ stats, statsLoading, recentItems, onClickItem, onSwitchToManage }) {
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [barAppeared, setBarAppeared] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);
  const panelCount = 4;

  const goTo = useCallback((idx) => {
    if (animating) return;
    setAnimating(true);
    setBarAppeared(false);
    setCurrent(idx);
    setTimeout(() => { setAnimating(false); setBarAppeared(true); }, 350);
  }, [animating]);

  const next = useCallback(() => goTo((current + 1) % panelCount), [current, goTo]);
  const prev = useCallback(() => goTo((current - 1 + panelCount) % panelCount), [current, goTo]);

  useEffect(() => { const t = setTimeout(() => setBarAppeared(true), 400); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (hovered) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => goTo((current + 1) % panelCount), 6000);
    return () => clearInterval(timerRef.current);
  }, [hovered, current, goTo]);

  const statBars = useMemo(() => {
    if (statsLoading || !stats) return [];
    const keys = ['snippets', 'screenshots', 'notes', 'webclips', 'drafts'];
    const labels = { snippets: '文本碎片', screenshots: '截图', notes: '笔记', webclips: '网页剪藏', drafts: '草稿' };
    const icons = { snippets: FileText, screenshots: Image, notes: StickyNote, webclips: Globe, drafts: Edit3 };
    const maxVal = Math.max(...keys.map((k) => stats[k] || 0), 1);
    return keys.map((k) => ({
      key: k, label: labels[k], Icon: icons[k],
      value: stats[k] || 0, pct: Math.round(((stats[k] || 0) / maxVal) * 100),
      colors: CAROUSEL_BAR_COLORS[k],
    }));
  }, [stats, statsLoading]);

  const panels = [
    /* Panel 0: Knowledge Distribution Bar Chart */
    <div key="dist" style={{ display: 'flex', gap: 24, height: '100%', alignItems: 'center', padding: '0 8px' }}>
      <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 80 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#1F2937', lineHeight: 1, letterSpacing: '-0.02em' }}>
          {statsLoading ? '—' : <AnimatedNumber value={stats?.total ?? 0} />}
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6, fontWeight: 500 }}>知识总数</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
        {statBars.map((b, i) => (
          <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
              <b.Icon size={13} style={{ color: b.colors.dot }} />
            </div>
            <div style={{ width: 48, fontSize: 11, color: '#6B7280', fontWeight: 500, textAlign: 'right' }}>{b.label}</div>
            <div style={{ flex: 1, height: 18, borderRadius: 9, background: 'rgba(0,0,0,0.03)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 9,
                background: b.colors.bar,
                width: barAppeared && current === 0 ? `${Math.max(b.pct, 3)}%` : '0%',
                transition: `width 0.8s cubic-bezier(0.25,0.46,0.45,0.94)`,
                transitionDelay: `${i * 80}ms`,
              }} />
            </div>
            <div style={{ width: 28, fontSize: 12, fontWeight: 700, color: '#374151', textAlign: 'right' }}>{b.value}</div>
          </div>
        ))}
      </div>
    </div>,

    /* Panel 1: Recent Items */
    <div key="recent" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={13} style={{ color: '#9CA3AF' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>最近新增</span>
        </div>
        <button onClick={onSwitchToManage} style={{ fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          全部 <ArrowRight size={10} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {recentItems.length > 0 ? recentItems.slice(0, 5).map((it, i) => {
          const Icon = TYPE_TABS.find((t) => t.id === it.type)?.icon || FileText;
          return (
            <div key={it.id} onClick={() => onClickItem(it)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                opacity: barAppeared && current === 1 ? 1 : 0,
                transform: barAppeared && current === 1 ? 'translateX(0)' : 'translateX(12px)',
                transition: `opacity 0.3s ease ${i * 60}ms, transform 0.3s ease ${i * 60}ms`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={13} style={{ color: '#9CA3AF', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#4B5563', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title || '未命名'}</span>
              <span style={{ fontSize: 10, color: '#CBD5E1', flexShrink: 0 }}>
                {it.created_at ? new Date(it.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : ''}
              </span>
            </div>
          );
        }) : <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', paddingTop: 40 }}>暂无知识碎片</div>}
      </div>
    </div>,

    /* Panel 2: Tag Distribution */
    <div key="tags" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Tag size={13} style={{ color: '#9CA3AF' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>标签分布</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
        {stats?.tagDistribution?.length > 0 ? stats.tagDistribution.slice(0, 5).map((t, i) => {
          const max = stats.tagDistribution[0].count || 1;
          const pct = Math.round((t.count / max) * 100);
          return (
            <div key={t.tag} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 56, fontSize: 11, color: '#6B7280', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tag}</span>
              <div style={{ flex: 1, height: 16, borderRadius: 8, background: 'rgba(0,0,0,0.03)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 8,
                  background: i < 2 ? 'linear-gradient(90deg, #818CF8, #6366F1)' : i < 4 ? 'linear-gradient(90deg, #A5B4FC, #818CF8)' : '#CBD5E1',
                  width: barAppeared && current === 2 ? `${Math.max(pct, 4)}%` : '0%',
                  transition: `width 0.7s cubic-bezier(0.25,0.46,0.45,0.94)`,
                  transitionDelay: `${i * 70}ms`,
                }} />
              </div>
              <span style={{ width: 24, fontSize: 11, fontWeight: 600, color: '#6B7280', textAlign: 'right' }}>{t.count}</span>
            </div>
          );
        }) : <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>暂无标签数据</div>}
      </div>
    </div>,

    /* Panel 3: Project Distribution */
    <div key="projects" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <BarChart3 size={13} style={{ color: '#9CA3AF' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>项目知识分布</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
        {stats?.byProject?.length > 0 ? stats.byProject.slice(0, 5).map((p, i) => {
          const max = Math.max(...stats.byProject.map((x) => x.total), 1);
          const pct = Math.round((p.total / max) * 100);
          const domainBars = { cases: 'linear-gradient(90deg, #A78BFA, #8B5CF6)', study: 'linear-gradient(90deg, #FBBF24, #F59E0B)' };
          return (
            <div key={`${p.domain}-${p.name}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 68, fontSize: 11, color: '#6B7280', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <div style={{ flex: 1, height: 16, borderRadius: 8, background: 'rgba(0,0,0,0.03)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 8,
                  background: domainBars[p.domain] || 'linear-gradient(90deg, #818CF8, #6366F1)',
                  width: barAppeared && current === 3 ? `${Math.max(pct, 4)}%` : '0%',
                  transition: `width 0.7s cubic-bezier(0.25,0.46,0.45,0.94)`,
                  transitionDelay: `${i * 70}ms`,
                }} />
              </div>
              <span style={{ width: 28, fontSize: 11, fontWeight: 600, color: '#6B7280', textAlign: 'right' }}>{p.total}</span>
            </div>
          );
        }) : <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>暂无项目数据</div>}
      </div>
    </div>,
  ];

  const panelTitles = ['知识分布', '最近新增', '标签分布', '项目分布'];

  return (
    <div
      style={{
        background: 'white', borderRadius: 18,
        border: '1px solid rgba(0,0,0,0.06)',
        overflow: 'hidden', position: 'relative',
        height: 340,
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Slide track */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          display: 'flex', width: `${panelCount * 100}%`, height: '100%',
          transform: `translateX(-${current * (100 / panelCount)}%)`,
          transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          {panels.map((panel, i) => (
            <div key={i} style={{ width: `${100 / panelCount}%`, height: '100%', padding: '16px 20px', boxSizing: 'border-box' }}>
              {panel}
            </div>
          ))}
        </div>

        {/* Left/Right arrows */}
        <button onClick={(e) => { e.stopPropagation(); prev(); }}
          style={{
            position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
            width: 28, height: 28, borderRadius: '50%', border: 'none',
            background: 'rgba(255,255,255,0.9)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: hovered ? 0.8 : 0, transition: 'opacity 0.2s',
          }}>
          <ChevronLeft size={14} style={{ color: '#6B7280' }} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); next(); }}
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            width: 28, height: 28, borderRadius: '50%', border: 'none',
            background: 'rgba(255,255,255,0.9)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: hovered ? 0.8 : 0, transition: 'opacity 0.2s',
          }}>
          <ChevronRight size={14} style={{ color: '#6B7280' }} />
        </button>
      </div>

      {/* Dot indicators + counter */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '8px 0 12px', flexShrink: 0,
      }}>
        {panels.map((_, i) => (
          <button key={i} onClick={() => goTo(i)}
            style={{
              width: current === i ? 20 : 6, height: 6, borderRadius: 3, border: 'none', cursor: 'pointer', padding: 0,
              background: current === i ? '#4a9e8e' : '#D1D5DB',
              transition: 'all 0.25s ease',
            }}
            title={panelTitles[i]}
          />
        ))}
        <span style={{ fontSize: 10, color: '#C0C4CC', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{current + 1}/{panelCount}</span>
      </div>
    </div>
  );
}

/* ---------- Under Construction Card ---------- */
function UnderConstructionCard() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 2500); return () => clearInterval(t); }, []);

  const icons = [Hammer, Wrench, HardHat, Construction];
  const CurIcon = icons[tick % icons.length];

  return (
    <div style={{
      height: 340, borderRadius: 18, position: 'relative', overflow: 'hidden',
      background: 'repeating-linear-gradient(45deg, #F8FAF9, #F8FAF9 14px, #F0F5F3 14px, #F0F5F3 28px)',
      border: '1.5px dashed rgba(74,158,142,0.3)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      {/* Subtle diagonal stripes overlay */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.025,
        backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 24px, #4a9e8e 24px, #4a9e8e 26px)',
      }} />

      {/* Icon */}
      <div style={{
        width: 60, height: 60, borderRadius: 18,
        background: 'rgba(74,158,142,0.06)',
        border: '1px solid rgba(74,158,142,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: `rotate(${tick % 2 === 0 ? -6 : 6}deg)`,
      }}>
        <CurIcon size={26} style={{ color: 'rgba(74,158,142,0.5)', transition: 'all 0.4s ease' }} />
      </div>

      <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#5E8A82', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <Sparkles size={13} style={{ color: 'rgba(74,158,142,0.45)' }} />
          更多功能开发中
          <Sparkles size={13} style={{ color: 'rgba(74,158,142,0.45)' }} />
        </div>
        <div style={{ fontSize: 11, color: '#94A3B1', lineHeight: 1.8 }}>
          知识图谱 · 智能推荐<br />协作空间 · 数据导出
        </div>
      </div>

      {/* Decorative corners */}
      <div style={{ position: 'absolute', top: 12, left: 12, width: 18, height: 18, borderTop: '2px solid rgba(74,158,142,0.2)', borderLeft: '2px solid rgba(74,158,142,0.2)', borderRadius: '3px 0 0 0' }} />
      <div style={{ position: 'absolute', top: 12, right: 12, width: 18, height: 18, borderTop: '2px solid rgba(74,158,142,0.2)', borderRight: '2px solid rgba(74,158,142,0.2)', borderRadius: '0 3px 0 0' }} />
      <div style={{ position: 'absolute', bottom: 12, left: 12, width: 18, height: 18, borderBottom: '2px solid rgba(74,158,142,0.2)', borderLeft: '2px solid rgba(74,158,142,0.2)', borderRadius: '0 0 0 3px' }} />
      <div style={{ position: 'absolute', bottom: 12, right: 12, width: 18, height: 18, borderBottom: '2px solid rgba(74,158,142,0.2)', borderRight: '2px solid rgba(74,158,142,0.2)', borderRadius: '0 0 3px 0' }} />
    </div>
  );
}

function OverviewView({ stats, statsLoading, recentItems, onClickItem, onSwitchToManage, onOpenBoard }) {
  const [appeared, setAppeared] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAppeared(true), 50); return () => clearTimeout(t); }, []);

  return (
    <div className={`px-8 py-6 transition-all duration-300 ${appeared ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Row 1: Board Preview — full width hero */}
      <BoardPreviewCard onOpenBoard={onOpenBoard} />

      {/* Row 2: Carousel (left ~55%) + Under Construction (right ~45%) */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: '1 1 55%', minWidth: 0 }}>
          <InsightCarousel
            stats={stats} statsLoading={statsLoading}
            recentItems={recentItems} onClickItem={onClickItem}
            onSwitchToManage={onSwitchToManage}
          />
        </div>
        <div style={{ flex: '1 1 42%', minWidth: 0 }}>
          <UnderConstructionCard />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Study Knowledge List (for studyKnowledgeOpen)                       */
/* ------------------------------------------------------------------ */
function StudyKnowledgeList({ api, onClickItem, activeItemId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api?.listGlobal?.({ domain: 'draft' })
      .then((res) => { if (res?.ok) setItems(res.items || []); })
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-slate-300" /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Inbox size={32} className="mb-2 text-slate-300" />
        <p className="text-sm">学习分区暂无知识碎片</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((it) => (
        <div key={it.id}>
          <KnowledgeItemCard
            item={it}
            isActive={activeItemId === it.id}
            onClick={() => onClickItem(it)}
            screenshotSrc={it._absolutePath ? `ipm-file:///${it._absolutePath.replace(/\\/g, '/')}` : undefined}
            projectLabel={it._projectName}
            projectDomain={it._domain}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Source Filter Dropdown (custom)                                     */
/* ------------------------------------------------------------------ */
function SourceFilterDropdown({ projectFilter, domainFilter, onProjectFilterChange, projectOptions, stats }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
    if (!open) setSearch('');
  }, [open]);

  const isAll = !projectFilter && !domainFilter;
  const isDraft = domainFilter === 'draft';

  const currentLabel = isDraft
    ? '草稿箱'
    : projectFilter
      ? projectFilter
      : '全部来源';

  const currentIcon = isDraft
    ? Edit3
    : projectFilter && projectOptions.find((p) => p.name === projectFilter && p.domain === 'cases')
      ? FolderKanban
      : projectFilter
        ? Briefcase
        : Layers;
  const CurIcon = currentIcon;

  const projects = projectOptions.filter((p) => p.domain === 'projects' && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  const cases = projectOptions.filter((p) => p.domain === 'cases' && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  const draftCount = stats?.drafts || 0;

  const handleSelect = (name, domain) => {
    onProjectFilterChange(name, domain);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 ${
          open
            ? 'border-indigo-300 ring-2 ring-indigo-100 bg-white text-slate-800'
            : isAll
              ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              : 'border-indigo-200 bg-indigo-50 text-indigo-700'
        }`}
      >
        <CurIcon size={13} className={isAll ? 'text-slate-400' : 'text-indigo-500'} />
        <span className="max-w-[100px] truncate">{currentLabel}</span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-xl border border-slate-200 shadow-xl z-30 overflow-hidden animate-fadeIn">
          {/* Search */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索项目..."
                className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {/* "All" option */}
            <button
              onClick={() => handleSelect('', '')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                isAll ? 'bg-indigo-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className={`w-6 h-6 rounded-md flex items-center justify-center ${isAll ? 'bg-indigo-100' : 'bg-slate-100'}`}>
                <Layers size={13} className={isAll ? 'text-indigo-600' : 'text-slate-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-medium ${isAll ? 'text-indigo-700' : 'text-slate-700'}`}>全部来源</span>
              </div>
              {isAll && <Check size={14} className="text-indigo-500 shrink-0" />}
            </button>

            {/* Draft box */}
            <button
              onClick={() => handleSelect('', 'draft')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                isDraft ? 'bg-indigo-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className={`w-6 h-6 rounded-md flex items-center justify-center ${isDraft ? 'bg-amber-100' : 'bg-amber-50'}`}>
                <Edit3 size={13} className={isDraft ? 'text-amber-600' : 'text-amber-400'} />
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className={`text-xs font-medium ${isDraft ? 'text-indigo-700' : 'text-slate-700'}`}>草稿箱</span>
                {draftCount > 0 && <span className="text-[10px] text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium">{draftCount}</span>}
              </div>
              {isDraft && <Check size={14} className="text-indigo-500 shrink-0" />}
            </button>

            {/* Divider + Projects section */}
            {projects.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">项目</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                {projects.map((p) => {
                  const active = projectFilter === p.name && domainFilter !== 'draft';
                  return (
                    <button
                      key={`projects:${p.name}`}
                      onClick={() => handleSelect(p.name, p.domain)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${active ? 'bg-indigo-100' : 'bg-indigo-50'}`}>
                        <Briefcase size={12} className={active ? 'text-indigo-600' : 'text-indigo-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium truncate block ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{p.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">{p.total}</span>
                      {active && <Check size={14} className="text-indigo-500 shrink-0" />}
                    </button>
                  );
                })}
              </>
            )}

            {/* Divider + Cases section */}
            {cases.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">案件</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                {cases.map((p) => {
                  const active = projectFilter === p.name && domainFilter !== 'draft';
                  return (
                    <button
                      key={`cases:${p.name}`}
                      onClick={() => handleSelect(p.name, p.domain)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${active ? 'bg-violet-100' : 'bg-violet-50'}`}>
                        <FolderKanban size={12} className={active ? 'text-violet-600' : 'text-violet-400'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-medium truncate block ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{p.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">{p.total}</span>
                      {active && <Check size={14} className="text-indigo-500 shrink-0" />}
                    </button>
                  );
                })}
              </>
            )}

            {/* Empty search state */}
            {search && projects.length === 0 && cases.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-4">无匹配项目</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Manage View                                                        */
/* ------------------------------------------------------------------ */
function ManageView({
  items, totalCount, loading, stats,
  activeType, onTypeChange,
  projectFilter, domainFilter, onProjectFilterChange, projectOptions,
  searchQuery, onSearchChange, searchFocused, onSearchFocus,
  groupByTag, onGroupByTagChange, groupedItems,
  activeItemId, onClickItem,
  createMenuOpen, onCreateMenuToggle,
  onCreateSnippet, onCreateNote, onCreateWebclip, onCreateScreenshot,
  onNavigateToProject,
  onStudyEntry,
}) {
  const [appeared, setAppeared] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAppeared(true), 50); return () => clearTimeout(t); }, []);
  const createRef = useRef(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const handle = (e) => { if (createRef.current && !createRef.current.contains(e.target)) onCreateMenuToggle(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [createMenuOpen, onCreateMenuToggle]);

  const statCounts = useMemo(() => {
    if (!stats) return {};
    return {
      snippet: stats.snippets || 0,
      screenshot: stats.screenshots || 0,
      note: stats.notes || 0,
      webclip: stats.webclips || 0,
    };
  }, [stats]);

  return (
    <div className={`px-8 py-5 flex flex-col h-full transition-all duration-300 ${appeared ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* Type filter tabs */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {TYPE_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => onTypeChange(t.id)}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  activeType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={12} />
                {t.label}
                {t.id && statCounts[t.id] != null && <span className="text-[10px] text-slate-400 ml-0.5">{statCounts[t.id]}</span>}
              </button>
            );
          })}
        </div>

        {/* Project filter (custom dropdown) */}
        <SourceFilterDropdown
          projectFilter={projectFilter}
          domainFilter={domainFilter}
          onProjectFilterChange={onProjectFilterChange}
          projectOptions={projectOptions}
          stats={stats}
        />

        {/* Group by tag toggle */}
        <button
          onClick={() => onGroupByTagChange(!groupByTag)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
            groupByTag ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
          }`}
        >
          <Tag size={12} /> 按标签聚合
        </button>

        {/* Study entry button (visible when in draft filter) */}
        {domainFilter === 'draft' && onStudyEntry && (
          <button
            onClick={onStudyEntry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition"
          >
            <Edit3 size={12} /> 管理学习碎片
          </button>
        )}

        <div className="flex-1" />

        {/* Search */}
        <div className={`flex items-center border rounded-lg transition-all duration-300 ${searchFocused ? 'w-64 border-indigo-300 ring-2 ring-indigo-100' : 'w-48 border-slate-200'}`}>
          <Search size={14} className="text-slate-400 ml-3 shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => onSearchFocus(true)}
            onBlur={() => onSearchFocus(false)}
            placeholder="搜索知识..."
            className="flex-1 px-2 py-1.5 text-xs bg-transparent focus:outline-none"
          />
        </div>

        {/* Create button */}
        <div className="relative" ref={createRef}>
          <button
            onClick={() => onCreateMenuToggle(!createMenuOpen)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition"
          >
            <Plus size={14} /> 新建
          </button>
          {createMenuOpen && (
            <div className="absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-20">
              <button onClick={onCreateSnippet} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition">
                <FileText size={14} className="text-slate-400" /> 文本碎片
              </button>
              <button onClick={onCreateNote} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition">
                <StickyNote size={14} className="text-emerald-500" /> 富文本笔记
              </button>
              <button onClick={onCreateWebclip} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition">
                <Globe size={14} className="text-blue-500" /> 网页剪藏
              </button>
              <button onClick={onCreateScreenshot} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition">
                <Camera size={14} className="text-violet-500" /> 上传截图
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={24} className="animate-spin text-slate-300" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-slate-400">
            <Inbox size={40} className="mb-3 text-slate-300" />
            <p className="text-sm font-medium">尚未创建知识碎片</p>
            <p className="text-xs mt-1">在项目中捕获内容，或直接新建草稿</p>
          </div>
        ) : groupByTag && groupedItems ? (
          <div className="space-y-6">
            {groupedItems.map(([tag, tagItems]) => (
              <div key={tag}>
                <div className="flex items-center gap-2 mb-3">
                  <Tag size={12} className="text-slate-400" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{tag}</span>
                  <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">{tagItems.length}</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {tagItems.map((it, i) => (
                    <div key={it.id} style={{ animationDelay: `${i * 30}ms` }} className="animate-fadeIn">
                      <KnowledgeItemCard
                        item={it}
                        isActive={activeItemId === it.id}
                        onClick={() => onClickItem(it)}
                        screenshotSrc={it._absolutePath ? `ipm-file:///${it._absolutePath.replace(/\\/g, '/')}` : undefined}
                        projectLabel={it._projectName}
                        projectDomain={it._domain}
                        onNavigateToProject={onNavigateToProject}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it, i) => (
              <div key={it.id} style={{ animationDelay: `${i * 30}ms` }} className="animate-fadeIn">
                <KnowledgeItemCard
                  item={it}
                  isActive={activeItemId === it.id}
                  onClick={() => onClickItem(it)}
                  screenshotSrc={it._absolutePath ? `ipm-file:///${it._absolutePath.replace(/\\/g, '/')}` : undefined}
                  projectLabel={it._projectName}
                  projectDomain={it._domain}
                  onNavigateToProject={onNavigateToProject}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex-shrink-0 pt-3 border-t border-slate-100 flex items-center gap-4 text-[11px] text-slate-400">
        <span>共 <span className="font-medium text-slate-600">{totalCount}</span> 条</span>
        {stats && (
          <>
            <span>文本 {stats.snippets || 0}</span>
            <span>截图 {stats.screenshots || 0}</span>
            <span>笔记 {stats.notes || 0}</span>
            <span>网页 {stats.webclips || 0}</span>
            <span>草稿 {stats.drafts || 0}</span>
          </>
        )}
      </div>
    </div>
  );
}
