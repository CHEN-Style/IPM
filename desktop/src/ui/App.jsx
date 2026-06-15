import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FloatingMode from './components/floating/FloatingMode.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import KnowledgePanorama from './components/knowledge/KnowledgePanorama.jsx';
import MyDataPage from './components/MyDataPage.jsx';
import CloudProjectsPage from './components/cloud-projects/CloudProjectsPage.jsx';
import OverviewPage from './components/OverviewPage.jsx';
import KnowClawV2Page from './components/knowclaw-v2/KnowClawV2Page.jsx';
import FloatingWorkspaceBridge from './components/knowclaw-v2/FloatingWorkspaceBridge.jsx';
import TutorialPage from './components/TutorialPage.jsx';
import KnowClawBubble from './components/KnowClawBubble.jsx';
import BubbleView from './components/floating-knowclaw/BubbleView.jsx';
import { TourProvider } from './components/tour/TourProvider.jsx';
import TourOverlay from './components/tour/TourOverlay.jsx';
import { ToastProvider } from './hooks/useToast.js';
import { ConfirmDialogProvider } from './hooks/useConfirmDialog.jsx';
import { KnowClawPersistProvider } from './hooks/useKnowClawPersist.jsx';
import { CloudPublishProvider } from './hooks/useCloudPublish.jsx';
import useUsageTracker from './hooks/useUsageTracker.js';
import OnboardingScreen from './components/OnboardingScreen.jsx';
import LoginPage from './components/auth/LoginPage.jsx';
import EnterpriseConsolePage from './components/enterprise/EnterpriseConsolePage.jsx';
import { AuthProvider, buildAuthValue } from './contexts/AuthContext.jsx';

const App = () => {
  const [showOnboarding, setShowOnboarding] = useState(null); // null = loading, true/false = resolved
  const [authStatus, setAuthStatus] = useState(null); // null = loading, {needsAuth, loggedIn, offline, user}
  const [activeNav, setActiveNav] = useState('mydata');
  const [myDataSection, setMyDataSection] = useState('home'); // home | projects | cases | study
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
      const ui = p.get('ui');
      if (ui === 'floating') return 'floating';
      if (ui === 'bubble') return 'bubble';
      return 'main';
    } catch {
      return 'main';
    }
  }); // main | floating | bubble

  const trackerPage = useMemo(() => {
    if (uiMode === 'floating') return 'floating';
    if (activeNav === 'mydata' && myDataSection !== 'home') return `mydata/${myDataSection}`;
    return activeNav;
  }, [uiMode, activeNav, myDataSection]);
  useUsageTracker(trackerPage);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.prefs?.get?.();
        if (cancelled) return;
        setShowOnboarding(!res?.prefs?.onboardingDone);
      } catch {
        if (!cancelled) setShowOnboarding(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // C3.5: resolve auth status. Only relevant for the main window UI.
  useEffect(() => {
    if (uiMode !== 'main') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.auth?.getStatus?.();
        if (cancelled) return;
        setAuthStatus(res || { needsAuth: false, loggedIn: false, offline: true });
      } catch {
        if (!cancelled) setAuthStatus({ needsAuth: false, loggedIn: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [uiMode]);

  // H2 (U3): single auth source for the renderer tree via AuthContext.
  const refreshAuth = useCallback(async () => {
    try {
      const res = await window.ipm?.auth?.getStatus?.();
      if (res) setAuthStatus(res);
    } catch {
      // Keep the existing status on refresh failure.
    }
  }, []);
  const authValue = useMemo(() => buildAuthValue(authStatus, refreshAuth), [authStatus, refreshAuth]);

  useEffect(() => {
    document.documentElement.classList.toggle('ui-bubble', uiMode === 'bubble');
    document.body.classList.toggle('ui-floating', uiMode === 'floating');
    document.body.classList.toggle('ui-bubble', uiMode === 'bubble');
    return () => {
      document.documentElement.classList.remove('ui-bubble');
      document.body.classList.remove('ui-floating');
      document.body.classList.remove('ui-bubble');
    };
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

  const [pageFade, setPageFade] = useState('in'); // in | out (white overlay)
  const [displayNav, setDisplayNav] = useState(activeNav);
  const fadeTimerRef = useRef(null);

  const fadeEligible = useMemo(() => new Set(['overview', 'mydata', 'knowledge', 'knowclaw-v2', 'tutorial', 'cloud-projects', 'enterprise-console']), []);

  useEffect(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    if (displayNav === activeNav) return;
    const fromOk = fadeEligible.has(displayNav);
    const toOk = fadeEligible.has(activeNav);
    if (!fromOk || !toOk) {
      setDisplayNav(activeNav);
      setPageFade('in');
      return;
    }

    setPageFade('out');
    fadeTimerRef.current = setTimeout(() => {
      setDisplayNav(activeNav);
      setPageFade('out'); // keep overlay visible then fade out
      requestAnimationFrame(() => setPageFade('in'));
    }, 160);
  }, [activeNav, displayNav, fadeEligible]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const [workspaceStats, setWorkspaceStats] = useState(() => ({
    loading: true,
    projects: { count: null, active: null },
    cases: { count: null, active: null },
    study: { count: null, active: 1 },
  }));

  const refreshWorkspaceStats = useCallback(async () => {
    setWorkspaceStats((s) => ({ ...s, loading: true }));
    try {
      const [projectsList, casesList] = await Promise.all([
        window.ipm?.projects?.list?.().catch(() => []),
        window.ipm?.cases?.list?.().catch(() => []),
      ]);
      const projects = Array.isArray(projectsList) ? projectsList : [];
      const cases = Array.isArray(casesList) ? casesList : [];

      let studyCount = null;
      try {
        const res = await window.ipm?.explorer?.list?.('', '', { domain: 'study' });
        const entries = Array.isArray(res?.entries) ? res.entries : [];
        studyCount = entries.filter((e) => e?.kind === 'dir' && !['meta', 'snippets', 'temp'].includes(String(e?.name || ''))).length;
      } catch {
        studyCount = null;
      }

      setWorkspaceStats({
        loading: false,
        projects: { count: projects.length, active: projects.filter((p) => p?.status === 'active').length },
        cases: { count: cases.length, active: cases.filter((p) => p?.status === 'active').length },
        study: { count: studyCount, active: 1 },
      });
    } catch {
      setWorkspaceStats((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaceStats();
  }, []);

  useEffect(() => {
    // Keep overview / mydata-home cards fresh after creating/deleting projects/cases.
    if (activeNav === 'overview') void refreshWorkspaceStats();
    if (activeNav === 'mydata' && myDataSection === 'home') void refreshWorkspaceStats();
  }, [activeNav, myDataSection, refreshWorkspaceStats]);

  const [searchNavTarget, setSearchNavTarget] = useState(null);
  const sidebarSearchRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (sidebarCollapsed) setSidebarCollapsed(false);
        setTimeout(() => sidebarSearchRef.current?.focus(), sidebarCollapsed ? 350 : 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarCollapsed]);

  const handleSearchNavigate = useCallback((item) => {
    const domain = item.domain;
    if (domain === 'cases' || domain === 'projects' || domain === 'study') {
      setMyDataSection(domain);
    }
    setSearchNavTarget({ ...item, _ts: Date.now() });
    setActiveNav('mydata');
  }, []);

  const openMyDataDomain = (domain) => {
    const d = String(domain || '').toLowerCase();
    if (d === 'cases' || d === 'projects' || d === 'study') setMyDataSection(d);
    setActiveNav('mydata');
  };

  const finishOnboarding = useCallback((name) => {
    const patch = { onboardingDone: true };
    if (name) patch.userName = name;
    window.ipm?.prefs?.set?.(patch).catch(() => {});
    setShowOnboarding(false);
  }, []);

  // Auxiliary transparent windows must not render the main-window
  // onboarding/loading fallback. That fallback is an opaque dark div;
  // if the bubble window shows before prefs resolve it appears as the
  // black square the user sees in the centre of the screen.
  if (uiMode === 'bubble') {
    return <BubbleView />;
  }

  if (uiMode === 'floating') {
    return (
      <TourProvider navigate={setActiveNav} setMyDataSection={setMyDataSection}>
        <FloatingMode
          onBackToMain={() => {
            if (window?.ipm?.ui?.backToMain) {
              window.ipm.ui.backToMain().catch(() => setUiMode('main'));
              return;
            }
            setUiMode('main');
          }}
        />
        <TourOverlay />
      </TourProvider>
    );
  }

  if (showOnboarding === null || authStatus === null) {
    return <div className="h-screen w-full" style={{ background: '#060608' }} />;
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={finishOnboarding} />;
  }

  // C3.5: gate on auth choice. Show login when no choice has been made yet.
  if (authStatus.needsAuth) {
    return <LoginPage onOfflineChosen={() => setAuthStatus({ ...authStatus, needsAuth: false, offline: true })} />;
  }

  return (
    <AuthProvider value={authValue}>
    <ConfirmDialogProvider>
    <ToastProvider>
    <KnowClawPersistProvider>
    <CloudPublishProvider onPublished={() => { void refreshWorkspaceStats(); }}>
    <FloatingWorkspaceBridge onNavigateToKnowClaw={() => setActiveNav('knowclaw-v2')} />
    <TourProvider navigate={setActiveNav} setMyDataSection={setMyDataSection}>
    <div className="flex flex-col h-screen w-full overflow-hidden select-auto antialiased">
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
          onSearchNavigate={handleSearchNavigate}
          searchInputRef={sidebarSearchRef}
        />

        {/* Column 2: Main Area */}
        <main
          className="flex-1 min-w-0 flex flex-col min-h-0 relative"
          onMouseDownCapture={() => {
            if (sidebarPinned) return;
            setSidebarCollapsed(true);
          }}
        >
          {/* Top drag strip — also prevents content from overlapping window-control overlay.
              G1.1c: 在右侧（系统 caption controls 之前）放一个「切换到悬浮窗」按钮，
              使中台 → 悬浮的入口与悬浮窗左上角的「回中台」对称可见。 */}
          <div
            className="h-[36px] shrink-0 w-full flex items-center justify-end pr-[140px]"
            style={{ WebkitAppRegion: 'drag', background: '#f8f9fb' }}
          >
            <button
              type="button"
              onClick={() => {
                if (window?.ipm?.ui?.openFloating) {
                  window.ipm.ui.openFloating().catch(() => setUiMode('floating'));
                  return;
                }
                setUiMode('floating');
              }}
              title="切换到悬浮窗 (Ctrl+Shift+Space)"
              style={{ WebkitAppRegion: 'no-drag' }}
              className="h-7 w-7 rounded-md hover:bg-slate-200/60 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors"
              data-track="titlebar-open-floating"
            >
              <Layers size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0 relative">
            <div
              className={`absolute inset-0 bg-white transition-opacity duration-200 ease-in-out pointer-events-none z-10 ${
                pageFade === 'out' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {displayNav === 'settings' ? (
            <SettingsPage />
            ) : displayNav === 'tutorial' ? (
            <TutorialPage />
            ) : displayNav === 'overview' ? (
              <OverviewPage />
            ) : displayNav === 'knowledge' ? (
            <KnowledgePanorama
              onNavigateToProject={(projectName, domain) => {
                openMyDataDomain(domain || 'projects');
              }}
            />
            ) : displayNav === 'knowclaw-v2' ? (
            <KnowClawV2Page currentUser={authStatus?.user || null} />
            ) : displayNav === 'cloud-projects' ? (
            <CloudProjectsPage onOpenLocal={(domain) => openMyDataDomain(domain || 'projects')} />
            ) : displayNav === 'enterprise-console' ? (
            <EnterpriseConsolePage />
            ) : displayNav === 'mydata' ? (
              <MyDataPage section={myDataSection} onSectionChange={setMyDataSection} stats={workspaceStats} onNavigate={setActiveNav} searchNavTarget={searchNavTarget} onSearchNavDone={() => setSearchNavTarget(null)} />
          ) : (
              <MyDataPage section={myDataSection} onSectionChange={setMyDataSection} stats={workspaceStats} onNavigate={setActiveNav} searchNavTarget={searchNavTarget} onSearchNavDone={() => setSearchNavTarget(null)} />
          )}
          </div>
        </main>

        {/* Column 3: Contextual Detail Panel */}
        {selectedDoc ? (
          <aside className="h-full flex-shrink-0">
            <DetailPanel document={selectedDoc} />
          </aside>
        ) : null}
      </div>

      {/* KnowClaw Bubble (global floating) */}
      {displayNav !== 'knowclaw-v2' && (
        <KnowClawBubble onNavigateToKnowClaw={() => setActiveNav('knowclaw-v2')} />
      )}

      {/* Global Status Bar (in layout; no overlap) */}
      <div className="h-6 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-3 text-[10px] text-slate-500 pointer-events-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span>内测版本</span>
          </div>
          <span>v1.0</span>
        </div>
        <div className="flex items-center gap-3">
        </div>
      </div>
    </div>
    <TourOverlay />
    </TourProvider>
    </CloudPublishProvider>
    </KnowClawPersistProvider>
    </ToastProvider>
    </ConfirmDialogProvider>
    </AuthProvider>
  );
};

export default App;


