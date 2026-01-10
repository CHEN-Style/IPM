import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FloatingMode from './components/floating/FloatingMode.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import KnowledgePanorama from './components/knowledge/KnowledgePanorama.jsx';
import MyDataPage from './components/MyDataPage.jsx';
import OverviewPage from './components/OverviewPage.jsx';

const App = () => {
  const [activeNav, setActiveNav] = useState('mydata');
  const [selectedDoc, setSelectedDoc] = useState(null); // 右侧详情后续接入
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    try {
      const v = window.localStorage.getItem('ipm.sidebarPinned');
      return v === '1';
    } catch {
      return false;
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [uiMode, setUiMode] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get('ui') === 'floating' ? 'floating' : 'main';
    } catch {
      return 'main';
    }
  }); // main | floating

  useEffect(() => {
    // In floating mode, remove the "mid-platform" background color.
    document.body.classList.toggle('ui-floating', uiMode === 'floating');
    return () => document.body.classList.remove('ui-floating');
  }, [uiMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem('ipm.sidebarPinned', sidebarPinned ? '1' : '0');
    } catch {
      // ignore
    }
  }, [sidebarPinned]);

  useEffect(() => {
    // Pinned always means expanded
    if (sidebarPinned) setSidebarCollapsed(false);
  }, [sidebarPinned]);

  if (uiMode === 'floating') {
    return (
      <FloatingMode
        onBackToMain={() => {
          // 优先走主进程窗口切换；否则降级为同窗口 UI 切换
          if (window?.ipm?.ui?.backToMain) {
            window.ipm.ui.backToMain().catch(() => setUiMode('main'));
            return;
          }
          setUiMode('main');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden select-none antialiased">
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Column 1: Navigation Sidebar */}
        <Sidebar
          activeNav={activeNav}
          onNavSelect={(nav) => setActiveNav(nav)}
          uiMode={uiMode}
          onUiModeChange={setUiMode}
          pinned={sidebarPinned}
          collapsed={sidebarCollapsed}
          onPinnedChange={setSidebarPinned}
          onCollapsedChange={setSidebarCollapsed}
        />

        {/* Column 2: Main Area */}
        <main
          className="flex-1 min-w-0 flex flex-col min-h-0"
          onMouseDownCapture={() => {
            // Click on main area collapses sidebar if not pinned
            if (sidebarPinned) return;
            setSidebarCollapsed(true);
          }}
        >
          {activeNav === 'settings' ? (
            <SettingsPage />
          ) : activeNav === 'overview' ? (
            <OverviewPage />
          ) : activeNav === 'knowledge' ? (
            <KnowledgePanorama />
          ) : activeNav === 'mydata' ? (
            <MyDataPage />
          ) : (
            <MyDataPage />
          )}
        </main>

        {/* Column 3: Contextual Detail Panel */}
        {selectedDoc ? (
          <aside className="h-full flex-shrink-0">
            <DetailPanel document={selectedDoc} />
          </aside>
        ) : null}
      </div>

      {/* Global Status Bar (in layout; no overlap) */}
      <div className="h-6 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-3 text-[10px] text-slate-500 pointer-events-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span>本地模式</span>
          </div>
          <span>v0.0.1-mvp</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Workspace: userfile</span>
        </div>
      </div>
    </div>
  );
};

export default App;


