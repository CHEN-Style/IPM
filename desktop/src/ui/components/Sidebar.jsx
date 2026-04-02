import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Search,
  Settings,
  ShieldCheck,
  HardDrive,
  ChevronDown,
  Command,
  Star,
  Clock,
  BookMarked,
  Layers,
  Pin,
  PinOff,
  Brain,
} from 'lucide-react';

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
    if (isCollapsed) {
      requestExpand();
      return;
    }
    onNavSelect?.(nav);
  };
  const navSelectDirect = (nav) => {
    // 折叠态：核心入口（概览/所有项目/知识库）允许直接导航，不触发展开
    onNavSelect?.(nav);
  };

  return (
    <div
      className={`bg-[#0f172a] h-full flex flex-col text-slate-400 border-r border-slate-800/50 overflow-hidden transition-[width] duration-300 ease-in-out select-none ${
        isCollapsed ? 'w-16' : 'w-72'
      }`}
      onMouseDownCapture={(e) => {
        // 缩略态：
        // - 点击核心导航 icon：直接导航（不展开）
        // - 点击其它区域：展开
        if (!isCollapsed) return;
        const direct = e.target?.closest?.('[data-sidebar-nav-direct="1"]');
        if (direct) return;
        e.preventDefault();
        e.stopPropagation();
        requestExpand();
      }}
    >
      {/* Workspace Switcher */}
      <div className={isCollapsed ? 'p-3' : 'p-4'}>
        <div className="relative" ref={menuAnchorRef}>
          <button
            type="button"
            onClick={() => {
              if (isCollapsed) {
                requestExpand();
                return;
              }
              setWorkspaceMenuOpen((v) => !v);
            }}
            className={`w-full flex items-center justify-between bg-slate-800/40 hover:bg-slate-800/60 transition-colors rounded-lg border border-slate-700/50 group ${
              isCollapsed ? 'px-2.5 py-2' : 'px-3 py-2'
            }`}
            title="工作区"
          >
            <div className={`flex items-center ${isCollapsed ? 'justify-center w-full' : 'gap-3'}`}>
              <div className="w-6 h-6 bg-indigo-500 rounded flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              {!isCollapsed ? (
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-sm font-semibold text-slate-100">KnowVault</span>
                  <span className="text-[10px] text-slate-500 font-medium tracking-tight">您的知识财产管理库</span>
                </div>
              ) : null}
            </div>
            {!isCollapsed ? <ChevronDown size={14} className="text-slate-500 group-hover:text-slate-300 transition-colors" /> : null}
          </button>

          {!isCollapsed && workspaceMenuOpen ? (
            <div className="absolute left-0 right-0 mt-2 z-50">
              <div className="bg-slate-900/95 backdrop-blur border border-slate-700/60 rounded-lg shadow-2xl overflow-hidden">
                <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800/60">模式</div>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    // 优先走主进程：打开无标题栏浮窗；否则降级为同窗口 UI 预览
                    if (window?.ipm?.ui?.openFloating) {
                      window.ipm.ui.openFloating().catch(() => onUiModeChange?.('floating'));
                      return;
                    }
                    onUiModeChange?.('floating');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 active:bg-slate-700 transition-colors"
                >
                  <Layers size={14} className="text-slate-300" />
                  <div className="flex flex-col items-start">
                    <span>悬浮模式</span>
                    <span className="text-[10px] text-slate-500">打开悬浮窗（仅 UI 预览）</span>
                  </div>
                  {uiMode === 'floating' ? (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">当前</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    onUiModeChange?.('main');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 active:bg-slate-700 transition-colors"
                >
                  <LayoutDashboard size={14} className="text-slate-400" />
                  <div className="flex flex-col items-start">
                    <span>中台模式</span>
                    <span className="text-[10px] text-slate-500">返回三栏中台</span>
                  </div>
                  {uiMode === 'main' ? (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">当前</span>
                  ) : null}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Global Search Tooltip Style */}
      {!isCollapsed ? (
        <div className="px-4 mb-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-slate-300 transition-colors" size={14} />
            <input
              type="text"
              placeholder="搜索..."
              className="w-full bg-slate-900/50 border border-slate-800 rounded-md py-2 pl-9 pr-12 text-xs focus:outline-none focus:border-slate-600 focus:bg-slate-900 transition-all text-slate-200 placeholder:text-slate-600"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[9px] text-slate-500 font-mono">
              <Command size={8} /> K
            </div>
          </div>
        </div>
      ) : (
        <div className="px-2 mb-3">
          <div className="flex items-center justify-center">
            <div className="w-10 h-10 rounded-lg border border-slate-800/60 bg-slate-900/30 flex items-center justify-center text-slate-500" title="搜索（后续接入）">
              <Search size={16} />
            </div>
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-y-auto space-y-6 ${isCollapsed ? 'px-1' : 'px-2'}`}>
        {/* Core Navigation */}
        <section>
          <div className="space-y-0.5">
            <NavItem
              icon={<LayoutDashboard size={16} />}
              label="概览"
              active={activeNav === 'overview'}
              collapsed={isCollapsed}
              navDirectWhenCollapsed
              onClick={() => navSelectDirect('overview')}
            />
            <NavItem
              icon={<HardDrive size={16} />}
              label="我的资料"
              active={activeNav === 'mydata'}
              collapsed={isCollapsed}
              navDirectWhenCollapsed
              onClick={() => navSelectDirect('mydata')}
            />
            <NavItem
              icon={<BookMarked size={16} />}
              label="知识库"
              active={activeNav === 'knowledge'}
              collapsed={isCollapsed}
              navDirectWhenCollapsed
              onClick={() => navSelectDirect('knowledge')}
            />
            <NavItem
              icon={<Brain size={16} />}
              label="KnowClaw"
              active={activeNav === 'knowclaw'}
              collapsed={isCollapsed}
              navDirectWhenCollapsed
              onClick={() => navSelectDirect('knowclaw')}
            />
          </div>
        </section>

        {/* Favorites/Starred */}
        {!isCollapsed ? (
          <section>
            <header className="px-3 mb-2 flex items-center justify-between group">
              <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-widest flex items-center gap-2">
                <Star size={10} className="text-amber-500/70" /> 星标内容
              </h3>
            </header>
            <div className="px-3 py-2 text-[11px] text-slate-600 border border-slate-800/60 bg-slate-900/20 rounded-md">暂无星标内容（后续接入）</div>
          </section>
        ) : null}

        {/* Projects Section */}
        {!isCollapsed ? (
          <section>
            <header className="px-3 mb-2 flex items-center justify-between group">
              <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-widest flex items-center gap-2">活跃项目</h3>
            </header>
            <div className="px-3 py-2 text-[11px] text-slate-600 border border-slate-800/60 bg-slate-900/20 rounded-md">
              暂不在侧边栏展示（后续接入）
            </div>
          </section>
        ) : null}
      </div>

      {/* Profile & Settings Area */}
      <div className="p-3 border-t border-slate-800/50 bg-slate-900/20">
        <div className="flex flex-col gap-1">
          <NavItem
            icon={<Settings size={16} />}
            label="偏好设置"
            active={activeNav === 'settings'}
            collapsed={isCollapsed}
            onClick={() => safeNavSelect('settings')}
          />
          <NavItem icon={<Clock size={16} />} label="系统日志" collapsed={isCollapsed} onClick={() => safeNavSelect('logs')} />
        </div>

        {/* Pin toggle (placed under Settings/Logs as requested) */}
        <button
          type="button"
          onClick={() => onPinnedChange?.(!isPinned)}
          className={`mt-2 w-full flex items-center gap-2 rounded-lg border transition-colors ${
            isPinned ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-800/60 bg-slate-900/20 text-slate-300 hover:bg-slate-900/35'
          } ${isCollapsed ? 'px-2.5 py-2 justify-center' : 'px-3 py-2'}`}
          title={isPinned ? '已固定：侧边栏将一直显示' : '未固定：点击主区域将自动折叠'}
        >
          {isPinned ? <PinOff size={14} className="text-emerald-300" /> : <Pin size={14} className="text-slate-300" />}
          {!isCollapsed ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold">{isPinned ? '已固定侧边栏' : '固定侧边栏'}</span>
                <span className="text-[10px] text-slate-500">{isPinned ? '点击取消固定' : '不固定时，点主区域自动折叠'}</span>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded border ${
                  isPinned ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-slate-800/30 text-slate-400 border-slate-700/50'
                }`}
              >
                {isPinned ? 'ON' : 'OFF'}
              </span>
            </div>
          ) : null}
        </button>

        {!isCollapsed ? (
          <div className="mt-4 px-3 py-3 bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl border border-slate-800 flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold text-white shadow-lg">JD</div>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full"></div>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-slate-200 font-semibold truncate">Johnathan Doe</span>
              <span className="text-[10px] text-slate-500 font-medium truncate uppercase tracking-tighter">Senior Counsel</span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-center">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-sm font-bold text-white shadow-lg" title="用户">
              JD
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const NavItem = ({ icon, label, active, isMini, collapsed, navDirectWhenCollapsed, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center rounded-md transition-all text-sm font-medium group ${
      collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
    } ${active ? 'bg-slate-800 text-slate-50 ring-1 ring-slate-700/50' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'}`}
    title={collapsed ? label : undefined}
    data-sidebar-nav-direct={collapsed && navDirectWhenCollapsed ? '1' : undefined}
  >
    {icon && (
      <span className={`${active ? 'text-slate-100' : 'text-slate-500 group-hover:text-slate-400'} transition-colors`}>
        {icon}
      </span>
    )}
    {!collapsed ? (
      <>
        {isMini && <div className="w-1.5 h-1.5 rounded-full bg-slate-700 group-hover:bg-slate-500 transition-colors" />}
        <span className="truncate flex-1 text-left">{label}</span>
      </>
    ) : null}
  </button>
);

export default Sidebar;


