import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import FloatingMode from './components/floating/FloatingMode.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import KnowledgePanorama from './components/knowledge/KnowledgePanorama.jsx';
import MyDataPage from './components/MyDataPage.jsx';
import OverviewPage from './components/OverviewPage.jsx';
import KnowClawV2Page from './components/knowclaw-v2/KnowClawV2Page.jsx';
import TutorialPage from './components/TutorialPage.jsx';
import KnowClawBubble from './components/KnowClawBubble.jsx';
import { TourProvider } from './components/tour/TourProvider.jsx';
import TourOverlay from './components/tour/TourOverlay.jsx';
import { ToastProvider } from './hooks/useToast.js';
import { ConfirmDialogProvider } from './hooks/useConfirmDialog.jsx';
import useUsageTracker from './hooks/useUsageTracker.js';
import OnboardingScreen from './components/OnboardingScreen.jsx';

const App = () => {
  const [showOnboarding, setShowOnboarding] = useState(null); // null = loading, true/false = resolved
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
      return p.get('ui') === 'floating' ? 'floating' : 'main';
    } catch {
      return 'main';
    }
  }); // main | floating

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

  useEffect(() => {
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

  const [pageFade, setPageFade] = useState('in'); // in | out (white overlay)
  const [displayNav, setDisplayNav] = useState(activeNav);
  const fadeTimerRef = useRef(null);

  const fadeEligible = useMemo(() => new Set(['overview', 'mydata', 'knowledge', 'knowclaw-v2', 'tutorial']), []);

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

  if (showOnboarding === null) {
    return <div className="h-screen w-full" style={{ background: '#060608' }} />;
  }

  if (showOnboarding) {
    return <OnboardingScreen onComplete={finishOnboarding} />;
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

  return (
    <ConfirmDialogProvider>
    <ToastProvider>
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
          {/* Top drag strip — also prevents content from overlapping window-control overlay */}
          <div
            className="h-[36px] shrink-0 w-full"
            style={{ WebkitAppRegion: 'drag', background: '#f8f9fb' }}
          />
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
            <KnowClawV2Page />
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
    </ToastProvider>
    </ConfirmDialogProvider>
  );
};

export default App;


