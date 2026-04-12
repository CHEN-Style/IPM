import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Search,
  Settings,
  HardDrive,
  ChevronDown,
  Command,
  BookMarked,
  GraduationCap,
  Layers,
  Pin,
  PinOff,
  Brain,
  File,
  Folder,
  FolderKanban,
  X,
  CornerDownLeft,
} from 'lucide-react';
import appIconUrl from '../../../assets/icon.png';

const ACCENT = '#3e4b9c';
const DEBOUNCE_MS = 300;
const DOMAIN_LABEL = { cases: '案件', projects: '项目', study: '学习' };
const DOMAIN_COLOR = {
  cases: { bg: 'rgba(102,112,176,0.18)', text: '#8890c7' },
  projects: { bg: 'rgba(45,122,95,0.15)', text: '#5bb892' },
  study: { bg: 'rgba(156,115,62,0.15)', text: '#c9a46a' },
};
const EXT_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  ppt: '📑', pptx: '📑', jpg: '🖼️', jpeg: '🖼️', png: '🖼️',
  mp4: '🎬', mp3: '🎵', zip: '📦', rar: '📦', txt: '📃',
};
function getFileEmoji(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] || null;
}

const Sidebar = ({
  activeNav,
  onNavSelect,
  uiMode,
  onUiModeChange,
  pinned,
  collapsed,
  onPinnedChange,
  onCollapsedChange,
  onSearchNavigate,
  searchInputRef: externalSearchRef,
}) => {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const menuAnchorRef = useRef(null);
  const isPinned = Boolean(pinned);
  const isCollapsed = Boolean(collapsed) && !isPinned;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputInternalRef = useRef(null);
  const setSearchInputRef = useCallback((el) => {
    searchInputInternalRef.current = el;
    if (externalSearchRef) externalSearchRef.current = el;
  }, [externalSearchRef]);
  const searchInputRef = searchInputInternalRef;
  const searchDebounceRef = useRef(null);
  const searchDropdownRef = useRef(null);
  const searchWrapperRef = useRef(null);

  const searchOpen = searchFocused && (searchQuery.trim().length > 0 || searchResults.length > 0);

  const doSearch = useCallback(async (q) => {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults([]); setSearchTruncated(false); setSearchLoading(false); return; }
    setSearchLoading(true);
    try {
      const res = await window.ipm?.search?.global?.(trimmed);
      if (res?.ok) { setSearchResults(res.results || []); setSearchTruncated(!!res.truncated); }
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }, []);

  const handleSearchInput = useCallback((e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setSearchActiveIdx(0);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => doSearch(val), DEBOUNCE_MS);
  }, [doSearch]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchTruncated(false);
    setSearchActiveIdx(0);
  }, []);

  const selectResult = useCallback((item) => {
    onSearchNavigate?.(item);
    clearSearch();
    setSearchFocused(false);
    searchInputRef.current?.blur();
  }, [onSearchNavigate, clearSearch]);

  const handleSearchKeyDown = useCallback((e) => {
    if (!searchOpen) return;
    if (e.key === 'Escape') { clearSearch(); searchInputRef.current?.blur(); setSearchFocused(false); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchActiveIdx((i) => Math.min(i + 1, searchResults.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSearchActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && searchResults.length > 0) { e.preventDefault(); selectResult(searchResults[searchActiveIdx]); }
  }, [searchOpen, searchResults, searchActiveIdx, selectResult, clearSearch]);

  useEffect(() => () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); }, []);

  useEffect(() => {
    if (!searchFocused) return;
    const onClick = (e) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
        setSearchFocused(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [searchFocused]);

  useEffect(() => {
    const el = searchDropdownRef.current?.children?.[searchActiveIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [searchActiveIdx]);

  const displayName = userName || '用户';
  const avatarChar = userName ? userName[0].toUpperCase() : '我';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.prefs?.get?.();
        if (!cancelled && res?.prefs?.userName) setUserName(res.prefs.userName);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!workspaceMenuOpen) return;
      const anchor = menuAnchorRef.current;
      if (anchor && anchor.contains(e.target)) return;
      setWorkspaceMenuOpen(false);
    };
    const onBlur = () => setWorkspaceMenuOpen(false);
    window.addEventListener('click', onDocClick);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('click', onDocClick);
      window.removeEventListener('blur', onBlur);
    };
  }, [workspaceMenuOpen]);

  useEffect(() => {
    if (isCollapsed) setWorkspaceMenuOpen(false);
  }, [isCollapsed]);

  const requestExpand = () => onCollapsedChange?.(false);
  const safeNavSelect = (nav) => {
    if (isCollapsed) { requestExpand(); return; }
    onNavSelect?.(nav);
  };
  const navSelectDirect = (nav) => onNavSelect?.(nav);

  return (
    <div
      className={`h-full flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out select-none ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
      style={{ background: '#212121', color: '#a3a3a3' }}
      onMouseDownCapture={(e) => {
        if (!isCollapsed) return;
        const direct = e.target?.closest?.('[data-sidebar-nav-direct="1"]');
        if (direct) return;
        e.preventDefault();
        e.stopPropagation();
        requestExpand();
      }}
    >
      {/* ── Logo / workspace (top area is drag zone for frameless window) ── */}
      <div
        className={isCollapsed ? 'px-3 pt-[48px] pb-5' : 'px-5 pt-[48px] pb-6'}
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="relative" ref={menuAnchorRef}>
          <button
            type="button"
            onClick={() => {
              if (isCollapsed) { requestExpand(); return; }
              setWorkspaceMenuOpen((v) => !v);
            }}
            className={`flex items-center gap-2.5 group ${isCollapsed ? 'justify-center w-full' : ''}`}
            title="工作区"
            style={{ WebkitAppRegion: 'no-drag' }}
            data-tour="workspace-menu-btn"
            data-track="sidebar-workspace-menu"
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
              <img src={appIconUrl} alt="" className="w-9 h-9 object-cover" draggable={false} />
            </div>
            {!isCollapsed && (
              <>
                <span className="text-[15px] font-semibold" style={{ color: '#e8e8e8', letterSpacing: '-0.01em' }}>KnowVault</span>
                <ChevronDown size={12} className="ml-auto text-[#525252] group-hover:text-[#a3a3a3] transition-colors" />
              </>
            )}
          </button>

          {/* Workspace mode menu */}
          {!isCollapsed && workspaceMenuOpen && (
            <div className="absolute left-0 right-0 mt-2 z-50" style={{ WebkitAppRegion: 'no-drag' }}>
              <div className="rounded-lg shadow-2xl overflow-hidden border" style={{ background: '#1a1a1a', borderColor: '#2a2a2a' }}>
                <div className="px-3 py-2 text-[10px] uppercase tracking-[0.06em] font-medium" style={{ color: '#525252', borderBottom: '1px solid #2a2a2a' }}>模式</div>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    if (window?.ipm?.ui?.openFloating) {
                      window.ipm.ui.openFloating().catch(() => onUiModeChange?.('floating'));
                      return;
                    }
                    onUiModeChange?.('floating');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-white/[0.04]"
                  style={{ color: '#d4d4d4' }}
                  data-tour="floating-mode-btn"
                  data-track="sidebar-open-floating"
                >
                  <Layers size={14} style={{ color: '#737373' }} />
                  <span>悬浮模式</span>
                  {uiMode === 'floating' && (
                    <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${ACCENT}26`, color: ACCENT }}>当前</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setWorkspaceMenuOpen(false); onUiModeChange?.('main'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-white/[0.04]"
                  style={{ color: '#a3a3a3' }}
                  data-track="sidebar-main-mode"
                >
                  <LayoutDashboard size={14} style={{ color: '#737373' }} />
                  <span>中台模式</span>
                  {uiMode === 'main' && (
                    <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${ACCENT}26`, color: ACCENT }}>当前</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Search ── */}
      {!isCollapsed ? (
        <div className="px-4 mb-5 relative" ref={searchWrapperRef}>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none" size={13} style={{ color: searchFocused ? '#737373' : '#525252' }} />
            <input
              ref={setSearchInputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchInput}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索..."
              className="w-full rounded-md py-[7px] pl-8 pr-10 text-xs focus:outline-none transition-all placeholder:text-[#404040]"
              style={{
                background: searchFocused ? '#151515' : '#1a1a1a',
                border: `1px solid ${searchFocused ? '#3e4b9c55' : '#2a2a2a'}`,
                color: '#d4d4d4',
              }}
              autoComplete="off"
              spellCheck={false}
              data-track="sidebar-search"
            />
            {searchQuery ? (
              <button type="button" onClick={() => { clearSearch(); searchInputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 transition-colors">
                <X size={11} style={{ color: '#525252' }} />
              </button>
            ) : (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono pointer-events-none" style={{ background: '#2a2a2a', color: '#525252' }}>
                <Command size={8} /> K
              </div>
            )}
          </div>

          {/* Dropdown */}
          {searchOpen && (
            <div
              className="absolute left-4 right-4 mt-1 rounded-lg shadow-2xl overflow-hidden z-50"
              style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', maxHeight: '60vh' }}
            >
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(60vh - 28px)' }} ref={searchDropdownRef}>
                {searchLoading && searchResults.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px]" style={{ color: '#525252' }}>
                    <div className="inline-block w-3 h-3 border-[1.5px] border-[#333] border-t-[#3e4b9c] rounded-full animate-spin" />
                    <span className="ml-1.5">搜索中...</span>
                  </div>
                )}

                {!searchLoading && searchQuery.trim() && searchResults.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px]" style={{ color: '#525252' }}>
                    没有找到匹配的结果
                  </div>
                )}

                {searchResults.map((item, idx) => {
                  const isActive = idx === searchActiveIdx;
                  const domainStyle = DOMAIN_COLOR[item.domain] || DOMAIN_COLOR.projects;
                  const emoji = item.kind === 'dir' || item.kind === 'project' ? null : getFileEmoji(item.name);
                  return (
                    <div
                      key={`${item.domain}-${item.projectName}-${item.relPath}-${idx}`}
                      className="flex items-center gap-2.5 px-3 py-[7px] cursor-pointer transition-colors"
                      style={{ background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent' }}
                      onMouseEnter={() => setSearchActiveIdx(idx)}
                      onClick={() => selectResult(item)}
                    >
                      <div className="shrink-0 w-6 h-6 rounded flex items-center justify-center" style={{ background: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)' }}>
                        {item.kind === 'project' ? (
                          <FolderKanban size={12} style={{ color: '#8890c7' }} />
                        ) : emoji ? (
                          <span className="text-[11px] leading-none">{emoji}</span>
                        ) : item.kind === 'dir' ? (
                          <Folder size={12} style={{ color: '#737373' }} />
                        ) : (
                          <File size={12} style={{ color: '#737373' }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <SearchHighlight text={item.name} query={searchQuery.trim()} className="text-[12px] font-medium truncate block" style={{ color: '#d4d4d4' }} />
                        {item.parentPath && (
                          <div className="text-[10px] truncate" style={{ color: '#454545' }}>{item.parentPath}/</div>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        {item.projectName && (
                          <span className="text-[10px] px-1 py-[1px] rounded truncate max-w-[72px]" style={{ background: domainStyle.bg, color: domainStyle.text }}>{item.projectName}</span>
                        )}
                        <span className="text-[9px] px-1 py-[1px] rounded" style={{ background: 'rgba(255,255,255,0.05)', color: '#525252' }}>
                          {DOMAIN_LABEL[item.domain] || item.domain}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              {searchResults.length > 0 && (
                <div className="flex items-center justify-between px-3 py-1.5" style={{ borderTop: '1px solid #2a2a2a' }}>
                  <span className="text-[10px]" style={{ color: '#454545' }}>
                    {searchTruncated ? `${searchResults.length}+` : searchResults.length} 条结果
                  </span>
                  <span className="text-[10px] flex items-center gap-1" style={{ color: '#454545' }}>
                    <CornerDownLeft size={8} /> 打开
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-2 mb-4 flex justify-center">
          <button
            type="button"
            className="w-10 h-10 rounded-md flex items-center justify-center cursor-pointer"
            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}
            title="搜索 (⌘K)"
            onClick={() => { onCollapsedChange?.(false); setTimeout(() => searchInputRef.current?.focus(), 350); }}
            data-sidebar-nav-direct="1"
          >
            <Search size={15} style={{ color: '#525252' }} />
          </button>
        </div>
      )}

      {/* ── Navigation ── */}
      <div className={`flex-1 overflow-y-auto ${isCollapsed ? 'px-1' : 'px-2'}`}>
        <nav className="space-y-0.5">
          <NavItem icon={<HardDrive size={17} />} label="我的资料" active={activeNav === 'mydata'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('mydata')} dataTour="nav-mydata" dataTrack="nav-mydata" />
          <NavItem icon={<BookMarked size={17} />} label="知识库" active={activeNav === 'knowledge'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('knowledge')} dataTrack="nav-knowledge" />
          <NavItem icon={<Brain size={17} />} label="KnowClaw" active={activeNav === 'knowclaw'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('knowclaw')} dataTrack="nav-knowclaw" />
        </nav>

        <div className={isCollapsed ? 'mt-4' : 'mt-7'}>
          {!isCollapsed && (
            <div className="px-5 mb-2 text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: '#525252' }}>工具</div>
          )}
          <nav className="space-y-0.5">
            <NavItem icon={<Settings size={17} />} label="设置" active={activeNav === 'settings'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('settings')} dataTrack="nav-settings" />
            <NavItem icon={<GraduationCap size={17} />} label="教程" active={activeNav === 'tutorial'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('tutorial')} dataTrack="nav-tutorial" />
          </nav>
        </div>
      </div>

      {/* ── Bottom: pin + user ── */}
      <div className="px-3 pb-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Pin toggle */}
        <button
          type="button"
          onClick={() => onPinnedChange?.(!isPinned)}
          className={`w-full flex items-center gap-2 rounded-md transition-colors mb-3 ${isCollapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}
          style={{
            background: isPinned ? 'rgba(62,75,156,0.15)' : '#1a1a1a',
            border: `1px solid ${isPinned ? 'rgba(62,75,156,0.3)' : '#2a2a2a'}`,
            color: isPinned ? '#8890c7' : '#737373',
          }}
          title={isPinned ? '已固定：侧边栏将一直显示' : '未固定：点击主区域将自动折叠'}
          data-tour="sidebar-pin-btn"
          data-track="sidebar-pin-toggle"
        >
          {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          {!isCollapsed && (
            <span className="text-xs font-medium">{isPinned ? '取消固定' : '固定侧边栏'}</span>
          )}
        </button>

        {/* User */}
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 px-1'}`}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white shrink-0" style={{ background: ACCENT }}>
            {avatarChar}
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-medium truncate max-w-[120px]" style={{ color: '#d4d4d4' }}>{displayName}</span>
              <span className="text-[11px] truncate" style={{ color: '#525252' }}>内测版本</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Search highlight ── */

const SearchHighlight = ({ text, query, className, style }) => {
  if (!query) return <span className={className} style={style}>{text}</span>;
  const parts = [];
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let last = 0;
  while (true) {
    const idx = lower.indexOf(qLower, last);
    if (idx === -1) break;
    if (idx > last) parts.push({ t: text.slice(last, idx), h: false });
    parts.push({ t: text.slice(idx, idx + query.length), h: true });
    last = idx + query.length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), h: false });
  if (!parts.length) return <span className={className} style={style}>{text}</span>;
  return (
    <span className={className} style={style}>
      {parts.map((p, i) => p.h ? <span key={i} style={{ color: '#8890c7', fontWeight: 600 }}>{p.t}</span> : <span key={i}>{p.t}</span>)}
    </span>
  );
};

/* ── Nav item with left accent bar ── */

const NavItem = ({ icon, label, active, collapsed, navDirectWhenCollapsed, onClick, dataTour, dataTrack }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center transition-all relative ${
      collapsed ? 'justify-center px-2 py-2 rounded-md' : 'gap-2.5 px-5 py-[9px]'
    }`}
    style={{
      fontSize: '13.5px',
      fontWeight: active ? 500 : 400,
      color: active ? '#f5f5f5' : '#737373',
      background: active ? 'rgba(62,75,156,0.15)' : 'transparent',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#e8e8e8'; e.currentTarget.style.background = active ? 'rgba(62,75,156,0.15)' : 'rgba(255,255,255,0.04)'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#737373'; e.currentTarget.style.background = active ? 'rgba(62,75,156,0.15)' : 'transparent'; }}
    title={collapsed ? label : undefined}
    data-sidebar-nav-direct={collapsed && navDirectWhenCollapsed ? '1' : undefined}
    data-tour={dataTour}
    data-track={dataTrack}
  >
    {/* Left accent bar */}
    {active && !collapsed && (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-sm" style={{ background: ACCENT }} />
    )}
    <span style={{ opacity: active ? 0.9 : 0.6 }} className="shrink-0">{icon}</span>
    {!collapsed && <span className="truncate flex-1 text-left">{label}</span>}
  </button>
);

export default Sidebar;
