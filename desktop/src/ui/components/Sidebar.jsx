import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Search,
  Settings,
  HardDrive,
  ChevronDown,
  Command,
  Clock,
  BookMarked,
  Layers,
  Pin,
  PinOff,
  Brain,
} from 'lucide-react';
import appIconUrl from '../../../assets/icon.png';

const ACCENT = '#3e4b9c';

const Sidebar = ({
  activeNav,
  onNavSelect,
  uiMode,
  onUiModeChange,
  pinned,
  collapsed,
  onPinnedChange,
  onCollapsedChange,
}) => {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const menuAnchorRef = useRef(null);
  const isPinned = Boolean(pinned);
  const isCollapsed = Boolean(collapsed) && !isPinned;

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
        className={isCollapsed ? 'px-3 pt-[42px] pb-5' : 'px-5 pt-[42px] pb-6'}
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
        <div className="px-4 mb-5">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors" size={13} style={{ color: '#525252' }} />
            <input
              type="text"
              placeholder="搜索..."
              className="w-full rounded-md py-[7px] pl-8 pr-10 text-xs focus:outline-none transition-all placeholder:text-[#404040]"
              style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#d4d4d4' }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ background: '#2a2a2a', color: '#525252' }}>
              <Command size={8} /> K
            </div>
          </div>
        </div>
      ) : (
        <div className="px-2 mb-4 flex justify-center">
          <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }} title="搜索">
            <Search size={15} style={{ color: '#525252' }} />
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <div className={`flex-1 overflow-y-auto ${isCollapsed ? 'px-1' : 'px-2'}`}>
        <nav className="space-y-0.5">
          <NavItem icon={<LayoutDashboard size={17} />} label="协作中心" active={activeNav === 'overview'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('overview')} />
          <NavItem icon={<HardDrive size={17} />} label="我的资料" active={activeNav === 'mydata'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('mydata')} />
          <NavItem icon={<BookMarked size={17} />} label="知识库" active={activeNav === 'knowledge'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('knowledge')} />
          <NavItem icon={<Brain size={17} />} label="KnowClaw" active={activeNav === 'knowclaw'} collapsed={isCollapsed} navDirectWhenCollapsed onClick={() => navSelectDirect('knowclaw')} />
        </nav>

        {!isCollapsed && (
          <div className="mt-7">
            <div className="px-5 mb-2 text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: '#525252' }}>工具</div>
            <nav className="space-y-0.5">
              <NavItem icon={<Settings size={17} />} label="偏好设置" active={activeNav === 'settings'} collapsed={isCollapsed} onClick={() => safeNavSelect('settings')} />
              <NavItem icon={<Clock size={17} />} label="系统日志" collapsed={isCollapsed} onClick={() => safeNavSelect('logs')} />
            </nav>
          </div>
        )}
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
        >
          {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          {!isCollapsed && (
            <span className="text-xs font-medium">{isPinned ? '取消固定' : '固定侧边栏'}</span>
          )}
        </button>

        {/* User */}
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 px-1'}`}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white shrink-0" style={{ background: ACCENT }}>
            李
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] font-medium truncate" style={{ color: '#d4d4d4' }}>用户</span>
              <span className="text-[11px] truncate" style={{ color: '#525252' }}>本地模式</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Nav item with left accent bar ── */

const NavItem = ({ icon, label, active, collapsed, navDirectWhenCollapsed, onClick }) => (
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
