// desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx
//
// Phase-4 minimal Chat UI for the new pi-coding-agent runtime. This panel
// runs alongside (does NOT replace) the legacy KnowClaw page so the two
// stacks can be compared during the migration.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap,
  RotateCcw,
  Square,
  ChevronDown,
  PanelLeftOpen,
  PanelLeftClose,
  Brain,
  FolderOpen,
  Folder,
  FolderPlus,
  Globe,
  Search,
  Plus,
  ExternalLink,
  X,
  AlertTriangle,
  MessageSquare,
  Trash2,
  Minimize2,
  Loader2,
  RefreshCw,
  Network,
  PanelRightOpen,
  PanelRightClose,
  FolderTree,
  ClipboardList,
  PlayCircle,
} from 'lucide-react';
import MessageBubble from '../agent-chat/MessageBubble.jsx';
import ChatInput from '../agent-chat/ChatInput.jsx';
import useKnowClawV2Chat from './useKnowClawV2Chat.js';
import SessionPanel from './SessionPanel.jsx';
import WorkspaceFileTree from './WorkspaceFileTree.jsx';
import SkillManagerPanel from './SkillManagerPanel.jsx';
import SkillDetailModal from './SkillDetailModal.jsx';
import ImportSkillModal from './ImportSkillModal.jsx';
import PublishSkillModal from './PublishSkillModal.jsx';
import SkillSelector from './SkillSelector.jsx';
import useHeaderTier from './useHeaderTier.js';
import HeaderOverflowMenu from './HeaderOverflowMenu.jsx';
import ChatNavTrack from './ChatNavTrack.jsx';
import KnowClawIcon from './KnowClawIcon.jsx';

const HINT_PROMPTS = [
  '你好，用一句话告诉我 1+1 等于几',
  '列出 D 盘 IPM 项目根目录的内容',
  '读取 desktop/package.json 并告诉我 React 版本',
  '当前工作目录是什么？',
];

const KnowClawV2Page = ({ currentUser = null }) => {
  const {
    messages,
    streaming,
    sessionId,
    models,
    currentModel,
    sessions,
    sessionsLoading,
    showSessionPanel,
    currentSessionFile,
    thinkingLevel,
    thinkingHint,
    changeThinkingLevel,
    dismissThinkingHint,
    apiMode,
    bashAvailable,
    bashSource,
    rescanBash,
    currentCwd,
    cwdIsGlobal,
    userFileRoot,
    workspaces,
    workspacesLoading,
    setCwd,
    loadWorkspaces,
    chooseDirectory,
    createWorkspace,
    openInExplorer,
    hideWorkspace,
    sendMessage,
    abort,
    newSession,
    setModel,
    setShowSessionPanel,
    refreshSessions,
    openSession,
    deleteSession,
    forkSession,
    streamingMode,
    setStreamingMode,
    pendingSteer,
    pendingFollowUp,
    clearQueue,
    contextUsage,
    sessionStats,
    compacting,
    compactionReason,
    retrying,
    compactSession,
    subAgentEnabled,
    toggleSubAgent,
    // SK1: skill management state + actions.
    skills,
    skillsLoading,
    loadSkills,
    toggleSkill,
    deleteSkill,
    // SK2: skill import actions.
    importSkill,
    scanExternalSkills,
    chooseSkillDir,
    listRegistrySkills,
    getRegistrySkill,
    publishRegistrySkill,
    installRegistrySkill,
    listMineRegistrySkills,
    previewRegistrySkill,
    // E.5: Plan-mode state + actions.
    planMode,
    setPlanMode,
    replyAskUser,
    cancelAskUser,
    skipAskUser,
    startExecuting,
    // K2: workspace file tree.
    workspaceTree,
    treeLoading,
    treeTruncated,
    recentTouchedFiles,
    loadWorkspaceTree,
    uploadToWorkspace,
    // K2 (block B): AI process visibility (consumed by MessageBubble).
    streamingPhase,
    activeToolName,
    streamingIdleSeconds,
    // D.1: true while a turn is in flight on an existing session.
    // Used below to lock controls that would otherwise tear down
    // the active session (new conversation, workspace swap,
    // historical session open / fork / delete). Equivalent to
    // `streaming && sessionId != null` — see the provider.
    isSessionLocked,
  } = useKnowClawV2Chat();

  const bottomRef = useRef(null);

  // D.4: scroll lock — respect the user's vertical position.
  //
  // Before D.4 the messages container auto-scrolled to bottomRef on
  // every `messages` update. During streaming, text_delta /
  // thinking_delta / tool_execution_* events fire dozens of times a
  // second, so the user could not read earlier output: they'd scroll
  // up and get yanked back to the bottom within ~100ms. We now track
  // whether the user has scrolled away from the bottom and suppress
  // auto-scroll until they return there (manually or via the floating
  // "回到底部" button). The flag lives in a ref so high-frequency
  // onScroll events don't trigger re-renders.
  const scrollContainerRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  // E.6: ref + hook for header responsive layout. ResizeObserver
  // watches the outer header row (full width) and feeds 3 tiers
  // (wide / medium / compact) to header rendering decisions below.
  const headerRowRef = useRef(null);
  const headerTier = useHeaderTier(headerRowRef);
  // 80px tolerance — small mouse-wheel jitter near the bottom should
  // not toggle the flag, otherwise the button flickers on streaming
  // content growth (the bottom edge moves down as new tokens arrive).
  const SCROLL_BOTTOM_THRESHOLD = 80;

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
    userScrolledUpRef.current = !atBottom;
    setShowScrollButton((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    userScrolledUpRef.current = false;
    setShowScrollButton(false);
    // Prefer setting scrollTop directly when we have the container —
    // it is synchronous and won't fight with smooth animations
    // mid-stream. Fall back to scrollIntoView when the ref isn't
    // attached yet (very first render).
    const el = scrollContainerRef.current;
    if (el) {
      if (behavior === 'smooth') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  // K2 + SK1: right-side panel selector. The right rail is now a
  // single mutually-exclusive slot — at most one of FileTree / Skills
  // is visible at any time. Values: 'fileTree' | 'skills' | null.
  //
  // We continue to honour the legacy `knowclaw.v2.showFileTree`
  // localStorage key for users upgrading from pre-SK1 builds (so
  // their FileTree-open preference survives the upgrade). The new
  // `knowclaw.v2.rightPanel` key takes precedence when present.
  const [rightPanel, setRightPanel] = useState(() => {
    try {
      const next = window.localStorage?.getItem('knowclaw.v2.rightPanel');
      if (next === 'fileTree' || next === 'skills') return next;
      if (next === 'null' || next === null || next === undefined) {
        // Fall through to legacy migration check below.
      }
      const legacy = window.localStorage?.getItem('knowclaw.v2.showFileTree');
      if (legacy === '1') return 'fileTree';
      return null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      window.localStorage?.setItem(
        'knowclaw.v2.rightPanel',
        rightPanel ? String(rightPanel) : 'null',
      );
      // Keep the legacy key in sync so any other surface still
      // reading it sees the migrated value.
      window.localStorage?.setItem(
        'knowclaw.v2.showFileTree',
        rightPanel === 'fileTree' ? '1' : '0',
      );
    } catch { /* ignore */ }
  }, [rightPanel]);
  const showFileTree = rightPanel === 'fileTree';
  const showSkillsPanel = rightPanel === 'skills';
  const toggleFileTree = useCallback(() => {
    setRightPanel((p) => (p === 'fileTree' ? null : 'fileTree'));
  }, []);
  const toggleSkillsPanel = useCallback(() => {
    setRightPanel((p) => (p === 'skills' ? null : 'skills'));
  }, []);

  // SK1: skill detail modal target. Click on a skill row sets this;
  // the modal stays mounted until the user closes it. Null = hidden.
  const [skillDetailTarget, setSkillDetailTarget] = useState(null);

  // SK2: visibility of the import skill modal. Triggered by the
  // "+ 导入技能" button at the bottom of SkillManagerPanel.
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPublishSkillModal, setShowPublishSkillModal] = useState(false);
  // H5: registry skill targeted by「提交新版本」(null = fresh publish).
  const [publishSkillTarget, setPublishSkillTarget] = useState(null);

  // Skill Selector: names of skills the user has pinned to the next
  // outgoing message. Cleared after each successful send (see
  // `handleSend` below). Lives at the page level — not in
  // `useKnowClawPersist` — because the selection is purely a composer
  // affordance and shouldn't survive page navigation.
  const [pinnedSkills, setPinnedSkills] = useState([]);
  const handlePinnedSkillsChange = useCallback((next) => {
    setPinnedSkills(Array.isArray(next) ? next : []);
  }, []);
  const handlePinnedSkillRemove = useCallback((name) => {
    setPinnedSkills((prev) => prev.filter((n) => n !== name));
  }, []);

  // SK1: auto-refresh the skill list whenever the panel becomes
  // visible. We always re-fetch on open (rather than once-on-mount)
  // because the skill set can change between opens — e.g. the agent
  // may have generated a new skill via skill-builder while the panel
  // was closed. `loadSkills` is idempotent and inexpensive.
  //
  // SK4: also re-fetch whenever `currentCwd` changes while the panel
  // is open — switching workspaces should swap the workspace-scoped
  // skills in / out of the visible list immediately. Global mode
  // (currentCwd === null) is included in the dependency array on
  // purpose so going global → workspaced (or vice versa) also fires.
  useEffect(() => {
    if (showSkillsPanel) {
      void loadSkills?.(currentCwd || undefined);
    }
  }, [showSkillsPanel, loadSkills, currentCwd]);

  // Skill Selector eagerly needs `skills` to populate its dropdown the
  // first time the user opens it, even when the right-side
  // SkillManagerPanel has never been shown. We refresh once on mount
  // and then again whenever the workspace changes so workspace-scoped
  // skills appear in the selector immediately.
  useEffect(() => {
    void loadSkills?.(currentCwd || undefined);
  }, [loadSkills, currentCwd]);

  // Drop any pinned selection whose underlying skill is no longer
  // available or has been disabled — keeping the chip would lead the
  // user to think it will run when in fact the injection step will
  // silently skip it.
  useEffect(() => {
    if (pinnedSkills.length === 0) return;
    const enabledNames = new Set(
      (Array.isArray(skills) ? skills : [])
        .filter((s) => s?.enabled)
        .map((s) => s.name),
    );
    const next = pinnedSkills.filter((n) => enabledNames.has(n));
    if (next.length !== pinnedSkills.length) {
      setPinnedSkills(next);
    }
  }, [skills, pinnedSkills]);

  // U8b-9: vision UI only when the active model declares `image` input.
  const supportsImages = useMemo(() => {
    if (!currentModel || !models?.length) return false;
    const active = models.find((m) => `${m.provider}/${m.id}` === currentModel);
    return Array.isArray(active?.input) && active.input.includes('image');
  }, [currentModel, models]);

  // D.5: index of the last `kind:'tasks'` bubble in the current
  // transcript. Only that bubble renders the full TaskCard — earlier
  // snapshots collapse into a compact summary row (see MessageBubble).
  // Without this, every prior snapshot keeps any `in_progress` rows
  // spinning forever, misleading users into thinking a finished step
  // is still running.
  const lastTasksIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.kind === 'tasks') return i;
    }
    return -1;
  }, [messages]);

  // U3 + bundled-bash: per-session dismiss for the bash banner. We
  // intentionally don't persist the dismiss — every fresh app launch
  // re-asserts the warning so users don't accumulate a permanently
  // broken Skill toolchain. `bashAvailable === false` is authoritative
  // (main process probed at startup); `null` means we haven't
  // received status yet, so we wait and don't flash.
  //
  // The banner now has a "立即重新检测" button to spare users from
  // restarting IPM after they fix their bash toolchain in a separate
  // window. While the rescan is in flight we briefly disable the
  // button + show a spinner so the user gets feedback.
  const [bashBannerDismissed, setBashBannerDismissed] = useState(false);
  const [bashRescanning, setBashRescanning] = useState(false);
  const showBashBanner = bashAvailable === false && !bashBannerDismissed;
  const handleRescanBash = async () => {
    if (bashRescanning) return;
    setBashRescanning(true);
    try {
      const r = await rescanBash?.();
      // If the rescan succeeded we let the hook's state update handle
      // hiding the banner — no extra work here. If it still came back
      // negative we also reset `bashBannerDismissed` so the freshly
      // confirmed "still missing" state is visible (the user just
      // explicitly asked for an answer; respect that).
      if (r && r.ok && r.available) {
        setBashBannerDismissed(false);
      }
    } finally {
      setBashRescanning(false);
    }
  };

  // D.4: conditional auto-scroll. Only follow new content if the
  // user is already pinned to the bottom; if they've manually
  // scrolled up to read earlier output, respect that until they
  // either scroll back themselves or click the floating button.
  // Using 'auto' (instant) during streaming avoids the smooth-scroll
  // animation queue piling up and fighting with mouse-wheel input.
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

  // D.4: sending a new message is an explicit user intent to engage
  // the latest turn, so we always pin back to the bottom — even if
  // they were reading older context a second ago.
  //
  // Skill Selector: ChatInput now forwards a snapshot of the pinned
  // skill names as the third arg. We thread it through to the hook so
  // the IPC payload carries it, and we eagerly clear the local pin
  // state so the chips disappear the instant the user hits send (the
  // next turn shouldn't re-inject the same skills implicitly — that
  // would silently double-cost every follow-up).
  const handleSend = useCallback((text, images, pinned) => {
    scrollToBottom('auto');
    const pinnedNames = Array.isArray(pinned) && pinned.length > 0
      ? pinned
      : (pinnedSkills.length > 0 ? pinnedSkills : undefined);
    sendMessage(text, images, pinnedNames);
    if (pinnedSkills.length > 0) {
      setPinnedSkills([]);
    }
  }, [sendMessage, scrollToBottom, pinnedSkills]);

  const handleHintClick = (hint) => {
    if (!streaming) handleSend(hint);
  };

  return (
    <div className="h-full flex bg-white">
      {/* Phase 10: history session side panel (relative for the
          delete-confirmation overlay to anchor inside it). */}
      {showSessionPanel && (
        <div className="relative h-full">
          <SessionPanel
            sessions={sessions}
            loading={sessionsLoading}
            currentSessionFile={currentSessionFile}
            onOpen={openSession}
            onFork={forkSession}
            onDelete={deleteSession}
            onRefresh={refreshSessions}
            onNewSession={newSession}
            disabled={isSessionLocked}
          />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* U3 + bundled-bash: Git Bash missing banner.
            Visible only when `resolveBashShell()` in the main process
            couldn't find a system bash (e.g. /bin/bash) or anything
            on PATH. The "立即重新检测" button forces a fresh probe so
            users who just fixed their bash toolchain don't need to
            restart IPM. Dismiss is per-session. */}
        {showBashBanner && (
          <div
            className="flex items-start gap-3 px-6 py-3 border-b"
            style={{ background: '#fff7ed', borderBottomColor: '#fed7aa' }}
          >
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-[12px] text-amber-900 leading-relaxed">
              <div className="font-semibold mb-0.5">未检测到 bash 解释器</div>
              <div>
                KnowClaw 的部分 Skill（pdf / docx / pptx / web-artifacts-builder 等）依赖 bash 执行辅助脚本。
                macOS 通常自带 <code className="px-1 rounded bg-amber-100/70">/bin/bash</code>；如仍看到此提示，
                请检查系统 bash 或命令行工具（可在「终端」运行 <code className="px-1 rounded bg-amber-100/70">xcode-select --install</code>），
                完成后点击「立即重新检测」即可启用，无需重启 IPM。
              </div>
            </div>
            <button
              type="button"
              onClick={handleRescanBash}
              disabled={bashRescanning}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-amber-300 bg-white/60 text-[11px] text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              title="重新检测系统是否已安装 bash"
            >
              {bashRescanning
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />}
              <span>{bashRescanning ? '检测中…' : '立即重新检测'}</span>
            </button>
            <button
              type="button"
              onClick={() => setBashBannerDismissed(true)}
              className="p-1 rounded-md hover:bg-amber-100 transition-colors text-amber-700"
              title="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Header — E.6: outer ref is what useHeaderTier measures.
            We measure the full header row (≈ window width) rather than
            the inner right cluster so wide-tier controls' large
            intrinsic width can't shrink the cluster and feed back into
            a tier flicker. Thresholds in useHeaderTier.js are tuned
            against this. */}
        <div
          ref={headerRowRef}
          className={`border-b border-slate-100 min-w-0 ${
            headerTier === 'compact'
              ? 'flex flex-col items-stretch gap-2 px-4 py-3'
              : 'flex items-center justify-between gap-4 px-8 py-5'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setShowSessionPanel(!showSessionPanel)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
              title={showSessionPanel ? '隐藏会话列表' : '显示会话列表'}
            >
              {showSessionPanel ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            {/* Brand: just the dark PNG, no wrapper. The old amber→orange
                gradient tile was removed per UI feedback ("去除那个橙色底，
                放大图标，使用 black"). The icon now sits directly on the
                header background and is sized noticeably larger to keep
                presence without the container shape behind it. */}
            <KnowClawIcon
              tone="dark"
              size={headerTier === 'compact' ? 36 : 44}
              className="shrink-0"
            />
            <div className="min-w-0">
              <h2 className={`${headerTier === 'compact' ? 'text-base' : 'text-lg'} font-semibold text-slate-900 truncate`}>
                KnowClaw v2
              </h2>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 min-w-0 overflow-hidden">
                {sessionId && (
                  <span className="truncate">session · {sessionId.slice(0, 8)}</span>
                )}
                {apiMode && headerTier !== 'compact' && <ApiModeBadge mode={apiMode} />}
                {headerTier === 'wide' && (
                  <WorkspaceBadge
                    cwd={currentCwd}
                    isGlobal={cwdIsGlobal}
                    onOpenInExplorer={() => openInExplorer()}
                  />
                )}
              </p>
            </div>
          </div>
          {/* E.6: header right cluster. Tier comes from headerRowRef
              measurement above; this cluster just consumes it to
              decide which controls render inline vs. inside overflow.
              UI revamp: WorkspaceSelector / PlanModeToggle /
              ModelSelector and the skill-panel toggle have moved into
              the composer's bottom toolbar. The header now only
              carries status read-outs (Context / Token pills) and the
              broader session-level controls (Thinking / SubAgent /
              Compact / 新对话 / FileTree). */}
          <div className={`flex items-center gap-2 min-w-0 ${
            headerTier === 'compact'
              ? 'w-full justify-end overflow-visible'
              : 'justify-end shrink-0'
          }`}>
            <ContextPill usage={contextUsage} />
            <TokenPill stats={sessionStats} />
            {/* E.6: secondary controls — inline in wide/medium, folded
                into HeaderOverflowMenu in compact. */}
            {headerTier !== 'compact' && (
              <>
                <ThinkingLevelSelector
                  level={thinkingLevel}
                  onChange={changeThinkingLevel}
                  hint={thinkingHint}
                  onDismissHint={dismissThinkingHint}
                  disabled={streaming}
                  tier={headerTier}
                />
                <SubAgentToggle
                  enabled={subAgentEnabled}
                  onToggle={toggleSubAgent}
                  disabled={streaming}
                  tier={headerTier}
                />
                <CompactButton
                  onCompact={compactSession}
                  disabled={streaming || compacting}
                  compacting={compacting}
                  visible={Boolean(contextUsage)}
                />
              </>
            )}
            {/* 新对话 — always inline. In compact tier we drop the label
                so the icon-only button still fits next to the overflow ... button. */}
            <button
              type="button"
              onClick={newSession}
              disabled={isSessionLocked}
              className={`h-8 ${headerTier === 'compact' ? 'px-2' : 'px-3'} flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
              title={isSessionLocked ? '当前有对话正在进行，请先等待结束或中止' : '开始新对话'}
            >
              <RotateCcw size={13} />
              {headerTier !== 'compact' && <span>新对话</span>}
            </button>
            {/* K2: toggle the right-side workspace file tree panel. Only
                inline outside compact tier; in compact it lives inside
                the overflow menu below. */}
            {headerTier !== 'compact' && (
              <button
                type="button"
                onClick={toggleFileTree}
                className={`h-8 px-2 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
                  showFileTree
                    ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
                title={showFileTree ? '隐藏文件树' : '显示文件树'}
              >
                {showFileTree
                  ? <PanelRightClose size={14} />
                  : <PanelRightOpen size={14} />}
                <FolderTree size={13} />
              </button>
            )}
            {/* E.6: overflow menu — only mounted in compact tier. After
                the UI revamp it only carries the items that still
                live in the header (Thinking / SubAgent / Compact /
                FileTree / SkillsPanel). Model / PlanMode / Workspace
                moved out of the header entirely. */}
            {headerTier === 'compact' && (
              <HeaderOverflowMenu
                thinkingLevel={thinkingLevel}
                onThinkingChange={changeThinkingLevel}
                thinkingHint={thinkingHint}
                onDismissThinkingHint={dismissThinkingHint}
                subAgentEnabled={subAgentEnabled}
                onToggleSubAgent={toggleSubAgent}
                compactSession={compactSession}
                compacting={compacting}
                contextUsage={contextUsage}
                showFileTree={showFileTree}
                onToggleFileTree={toggleFileTree}
                showSkillsPanel={showSkillsPanel}
                onToggleSkillsPanel={toggleSkillsPanel}
                streaming={streaming}
                components={{
                  ThinkingLevelSelector,
                  SubAgentToggle,
                  CompactButton,
                }}
              />
            )}
          </div>
        </div>

        {/* U5: compaction / retry banner. Sits above the scrollable
            chat body so it stays visible regardless of scroll
            position. Mutually exclusive at the source (pi never
            retries during a compact), so a single component handles
            both. */}
        <CompactionBanner
          compacting={compacting}
          reason={compactionReason}
          retrying={retrying}
        />

        {/* Chat body */}
        <div className="flex-1 min-h-0 flex flex-col relative">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto px-6 py-6"
          >
            <div className="max-w-3xl mx-auto">
              {messages.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center max-w-lg">
                  {/* Brand mark for the empty-state hero. The amber-100→
                      orange-100 rounded tile was removed per UI feedback
                      ("去除米色底，放大图标，使用 black") — the icon now
                      stands on its own, much larger, anchoring the
                      empty state by visual weight alone. */}
                  <div className="mx-auto mb-6 flex items-center justify-center">
                    <KnowClawIcon tone="dark" size={96} />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">KnowClaw v2</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-8">
                    全新的 pi-coding-agent 运行时。具备真实代码代理能力——文件读写、命令执行、工具调用。
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {HINT_PROMPTS.map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        onClick={() => handleHintClick(hint)}
                        className="px-4 py-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full hover:bg-slate-100 hover:border-slate-300 transition-colors cursor-pointer"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              // K2 (block B): only the last streaming assistant bubble
              // receives the heartbeat/idle props — older bubbles in
              // the transcript are static and would render a stale
              // status strip otherwise.
              const isLast = i === messages.length - 1;
              const showHeartbeat = isLast && msg.role === 'assistant' && msg.streaming;
              // D.5: only the latest tasks snapshot renders full card.
              const isLatestTasksBubble = msg.kind === 'tasks' && i === lastTasksIndex;
              // E.1: every bubble gets a `data-msg-index` so the side
              // nav rail (ChatNavTrack) can locate its DOM node for
              // marker positioning + click-to-scroll. We tag ALL
              // messages (not just user) for a flat, stable lookup
              // even though only user bubbles produce markers.
              return (
                <div key={i} data-msg-index={i}>
                  <MessageBubble
                    message={msg}
                    projectName="KnowClawV2"
                    domain="knowclaw"
                    streamingPhase={showHeartbeat ? streamingPhase : undefined}
                    activeToolName={showHeartbeat ? activeToolName : undefined}
                    idleSeconds={showHeartbeat ? streamingIdleSeconds : 0}
                    isLatestTasksBubble={isLatestTasksBubble}
                    onAskUserReply={replyAskUser}
                    onAskUserCancel={cancelAskUser}
                    onAskUserSkip={skipAskUser}
                  />
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>
          {/* D.4: floating "回到底部" button. Shown whenever the user
              has scrolled away from the bottom (any state, ChatGPT /
              Claude convention). Sits inside the relative-positioned
              Chat body so it floats above the messages but never
              covers the input composer. */}
          {showScrollButton && (
            <button
              type="button"
              onClick={() => scrollToBottom('smooth')}
              title="回到底部"
              className="absolute bottom-4 right-6 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white text-slate-600 border border-slate-200 shadow-md hover:bg-slate-50 hover:text-slate-800 transition-colors"
            >
              <ChevronDown size={14} />
              <span>回到底部</span>
            </button>
          )}
          {/* E.1: DeepSeek-style side nav rail. Renders one marker per
              user message. Sits in the same
              relative-positioned Chat body container as the "回到底部"
              button (which is anchored to right-6 — the rail uses
              right-1 so the two don't overlap). The rail short-circuits
              to null when there are fewer than 2 user turns. */}
          <ChatNavTrack
            messages={messages}
            scrollContainerRef={scrollContainerRef}
          />
        </div>

        {/* Abort bar (only while streaming).
            U4: tooltip now reflects that abort *also* clears any
            queued steer/followUp messages — pi's default is to keep
            them around, which surprised users in early dogfooding.
            We surface the count so they know what they're throwing
            away. */}
        {streaming && (
          <div className="px-6 py-2 flex justify-center">
            <button
              type="button"
              onClick={abort}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors"
              title={
                (pendingSteer.length + pendingFollowUp.length) > 0
                  ? `中止当前回答，并清空 ${pendingSteer.length + pendingFollowUp.length} 条排队消息`
                  : '中止当前回答'
              }
            >
              <Square size={11} fill="currentColor" />
              <span>中止</span>
            </button>
          </div>
        )}

          {/* Input */}
          <div className="border-t border-slate-100 bg-white">
            <div className="max-w-3xl mx-auto">
              {/* U4: while streaming, expose the steer/followUp
                  toolbar above the composer. The toolbar carries
                  the mode toggle, pending-queue summary, and the
                  "清空队列" escape hatch. ChatInput itself stays
                  enabled in all states; sendMessage routes to the
                  active queue when `streaming === true`. */}
              {streaming && (
                <StreamingComposerToolbar
                  mode={streamingMode}
                  onModeChange={setStreamingMode}
                  pendingSteer={pendingSteer}
                  pendingFollowUp={pendingFollowUp}
                  onClearQueue={clearQueue}
                />
              )}
              <ChatInput
                onSend={handleSend}
                disabled={false}
                supportsImages={supportsImages}
                placeholder={composerPlaceholder(streaming, streamingMode)}
                onUploadFiles={uploadToWorkspace}
                pinnedSkills={pinnedSkills}
                onSkillRemove={handlePinnedSkillRemove}
                // UI revamp: bottom-left cluster carries the
                // mode/model/skill controls that used to live in the
                // header. Order matches the screenshot:
                // Plan/Agent → Model → Skill → (Plan-mode "执行").
                bottomLeftActions={
                  <>
                    <PlanModeToggle
                      planMode={planMode}
                      onToggle={setPlanMode}
                      disabled={streaming}
                      tier="medium"
                    />
                    <ModelSelector
                      models={models}
                      currentModel={currentModel}
                      onChange={(provider, id) => setModel(provider, id)}
                      disabled={streaming}
                      tier="medium"
                      placement="up"
                    />
                    <SkillSelector
                      skills={skills}
                      selected={pinnedSkills}
                      onSelect={handlePinnedSkillsChange}
                      onImport={() => setShowImportModal(true)}
                      onManage={() => setRightPanel('skills')}
                      loading={skillsLoading}
                    />
                    {planMode && !streaming && messages.length > 0 && (
                      <button
                        type="button"
                        onClick={startExecuting}
                        className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[12px] font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-200 transition-all active:scale-95"
                        title="切换到 Agent 模式并按上述方案开始执行"
                      >
                        <PlayCircle size={13} strokeWidth={2.2} />
                        <span>执行</span>
                      </button>
                    )}
                  </>
                }
                // UI revamp: bottom-right cluster carries the
                // workspace selector. The send button is rendered by
                // ChatInput itself so it always sits at the far right
                // and isn't a slot. `placement="up"` so the workspace
                // popover opens above the composer instead of being
                // clipped below the viewport edge.
                bottomRightActions={
                  <WorkspaceSelector
                    currentCwd={currentCwd}
                    isGlobal={cwdIsGlobal}
                    userFileRoot={userFileRoot}
                    workspaces={workspaces}
                    loading={workspacesLoading}
                    onSelect={(ws) => setCwd(ws?.isGlobal ? null : ws.path)}
                    onRefresh={loadWorkspaces}
                    onChooseDirectory={chooseDirectory}
                    onCreateWorkspace={createWorkspace}
                    onOpenInExplorer={openInExplorer}
                    onHideWorkspace={hideWorkspace}
                    disabled={isSessionLocked}
                    placement="up"
                  />
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* K2: right-side workspace file tree. Visibility is toggled
          from the header button; collapsed by default to preserve
          screen real estate for the chat column on smaller windows. */}
      {showFileTree && (
        <WorkspaceFileTree
          entries={workspaceTree}
          loading={treeLoading}
          truncated={treeTruncated}
          isGlobal={cwdIsGlobal}
          cwd={currentCwd}
          recentTouchedFiles={recentTouchedFiles}
          onRefresh={loadWorkspaceTree}
          onOpenFile={(p) => openInExplorer(p)}
          onOpenFolder={() => openInExplorer()}
          onUpload={uploadToWorkspace}
        />
      )}
      {/* SK1: right-side skill manager panel. Mutually exclusive with
          WorkspaceFileTree (both occupy the same `rightPanel` slot). */}
      {showSkillsPanel && (
        <SkillManagerPanel
          skills={skills}
          loading={skillsLoading}
          onToggle={toggleSkill}
          onDelete={(name, meta) => deleteSkill(name, {
            cwd: currentCwd || undefined,
            // SK4: pin scope based on the row's source so the IPC
            // unambiguously targets the workspace or user copy. The
            // panel surfaces both as separate rows when a name shadow
            // exists, so each click should hit exactly one disk path.
            scope: meta?.source === 'workspace' ? 'workspace' : 'user',
          })}
          onRefresh={() => loadSkills(currentCwd || undefined)}
          onViewDetail={(skill) => setSkillDetailTarget(skill)}
          onClose={() => setRightPanel(null)}
          onImport={() => setShowImportModal(true)}
          onPublish={(target) => {
            // H5: `target` is a registry skill when invoked from「我的提交 →
            // 提交新版本」, null for a fresh publish from the market tab.
            setPublishSkillTarget(target || null);
            setShowPublishSkillModal(true);
          }}
          listRegistrySkills={listRegistrySkills}
          installRegistrySkill={installRegistrySkill}
          getRegistrySkill={getRegistrySkill}
          previewRegistrySkill={previewRegistrySkill}
          listMineRegistrySkills={listMineRegistrySkills}
          onRegistryInstalled={() => { void loadSkills?.(currentCwd || undefined); }}
          cwd={currentCwd || undefined}
        />
      )}
      {/* SK1: skill detail modal — overlays everything when open. */}
      {skillDetailTarget && (
        <SkillDetailModal
          skill={skillDetailTarget}
          cwd={currentCwd || undefined}
          onClose={() => setSkillDetailTarget(null)}
        />
      )}
      {/* SK2: import skill modal — overlays everything when open. The
          `onImported` callback is fired by the modal whenever a skill
          (or batch) is successfully imported. We re-trigger
          `loadSkills` here as a belt-and-suspenders measure even
          though `importSkill` already awaits it internally — the
          extra round-trip is cheap and guarantees the panel is in
          sync if the user closes the modal before our hook's
          loadSkills resolves. */}
      <ImportSkillModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => { void loadSkills?.(currentCwd || undefined); }}
        importSkill={(srcDir, opts) => importSkill(srcDir, {
          ...(opts || {}),
          // SK4: forward cwd so the post-import refresh inside the
          // hook keeps workspace skills visible.
          cwd: currentCwd || undefined,
        })}
        scanExternalSkills={scanExternalSkills}
        chooseSkillDir={chooseSkillDir}
      />
      <PublishSkillModal
        open={showPublishSkillModal}
        skills={skills}
        cwd={currentCwd || undefined}
        target={publishSkillTarget}
        listMineRegistrySkills={listMineRegistrySkills}
        onClose={() => {
          setShowPublishSkillModal(false);
          setPublishSkillTarget(null);
        }}
        publishRegistrySkill={publishRegistrySkill}
        onPublished={() => {
          setShowPublishSkillModal(false);
          setPublishSkillTarget(null);
        }}
      />
    </div>
  );
};

// U4: composer placeholder.
//   - Idle (no streaming) → standard prompt.
//   - Streaming + followUp → tells the user pi will pick it up next.
//   - Streaming + steer    → warns that the message is an interrupt.
function composerPlaceholder(streaming, mode) {
  if (!streaming) return '向 KnowClaw v2 提问...';
  if (mode === 'steer') return '立即打断 - agent 会在下个工具间隙调整方向';
  return '排队追问 - agent 完成当前任务后处理';
}

// U4: StreamingComposerToolbar
//
// Mounted directly above ChatInput while a turn is streaming. Three
// responsibilities:
//   1. Toggle `streamingMode` between 'followUp' (default) and 'steer'.
//      The active pill is dark; the inactive one is muted. There's
//      deliberately no third option — those two map 1:1 onto pi's
//      queues.
//   2. Summarise the pending queues. We surface a count + the first
//      preview text so the user can sanity-check what they've stacked
//      up without scrolling the transcript.
//   3. Offer a single "清空队列" escape hatch. Disabled when both
//      queues are empty.
//
// The toolbar reads `pendingSteer` / `pendingFollowUp` directly from
// the hook — those are kept in sync by the pi `queue_update` event,
// which fires on every enqueue and every drain. No local debounce
// needed.
const StreamingComposerToolbar = ({
  mode,
  onModeChange,
  pendingSteer,
  pendingFollowUp,
  onClearQueue,
}) => {
  const steerCount = pendingSteer?.length || 0;
  const followUpCount = pendingFollowUp?.length || 0;
  const totalPending = steerCount + followUpCount;

  // Pull the next item from whichever queue the toolbar is most
  // likely to want to highlight. We bias toward "active mode first"
  // so a user toggled into steer sees the steer head, and vice
  // versa. Falls back to whichever lane has content.
  const summaryHead = (() => {
    if (mode === 'steer' && steerCount > 0) return { kind: 'steer', text: pendingSteer[0] };
    if (mode === 'followUp' && followUpCount > 0) return { kind: 'followUp', text: pendingFollowUp[0] };
    if (steerCount > 0) return { kind: 'steer', text: pendingSteer[0] };
    if (followUpCount > 0) return { kind: 'followUp', text: pendingFollowUp[0] };
    return null;
  })();

  return (
    <div className="px-3 pt-2 flex items-center gap-2 text-[11px]">
      <div className="flex items-center rounded-md border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => onModeChange?.('followUp')}
          className={`px-2 py-1 flex items-center gap-1 transition-colors ${
            mode === 'followUp'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
          title="追问 - 当前任务完成后处理（默认，安全）"
        >
          <MessageSquare size={11} />
          <span>追问</span>
          {followUpCount > 0 && (
            <span className={`ml-0.5 px-1 rounded text-[9px] ${
              mode === 'followUp' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {followUpCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onModeChange?.('steer')}
          className={`px-2 py-1 flex items-center gap-1 transition-colors border-l border-slate-200 ${
            mode === 'steer'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
          title="打断 - 在下一个工具调用间隙立即切换方向"
        >
          <Zap size={11} />
          <span>打断</span>
          {steerCount > 0 && (
            <span className={`ml-0.5 px-1 rounded text-[9px] ${
              mode === 'steer' ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-600'
            }`}>
              {steerCount}
            </span>
          )}
        </button>
      </div>

      {summaryHead && (
        <div
          className="flex-1 min-w-0 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-500 truncate"
          title={
            (steerCount > 0 ? `${steerCount} 条打断排队\n` : '')
            + (followUpCount > 0 ? `${followUpCount} 条追问排队\n\n` : '')
            + `最近一条：${summaryHead.text}`
          }
        >
          <span className="font-medium text-slate-600">
            {summaryHead.kind === 'steer' ? '打断' : '追问'}：
          </span>
          <span className="ml-1 truncate">{summaryHead.text}</span>
          {totalPending > 1 && (
            <span className="ml-1 text-slate-400">（+{totalPending - 1}）</span>
          )}
        </div>
      )}
      {!summaryHead && (
        <span className="flex-1 text-slate-300 truncate px-1">
          {mode === 'steer'
            ? '输入将作为打断消息发送'
            : '输入将排队等待 agent 处理完当前任务'}
        </span>
      )}

      {totalPending > 0 && (
        <button
          type="button"
          onClick={onClearQueue}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          title={`清空所有 ${totalPending} 条排队消息（不会中断当前正在执行的工具）`}
        >
          <Trash2 size={11} />
          <span>清空队列</span>
        </button>
      )}
    </div>
  );
};

// `placement`: 'up' opens the popover above the trigger (used when the
// selector lives at the bottom of the screen, e.g. inside the composer
// toolbar). 'down' opens below (original header behaviour). Default is
// 'down' so any future header usage stays backward compatible.
const ModelSelector = ({ models, currentModel, onChange, disabled, tier = 'wide', placement = 'down' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!models || models.length === 0) {
    return (
      <span className="h-7 px-2 flex items-center text-[12px] text-slate-500">
        模型加载中...
      </span>
    );
  }

  const currentModelInfo = currentModel
    ? models.find((m) => `${m.provider}/${m.id}` === currentModel)
    : null;
  const fullLabel = currentModel ? currentModel.split('/').slice(-1)[0] : '选择模型';
  const modeBadge = currentModelInfo?.apiMode === 'chat'
    ? { text: '/c', title: '/chat/completions' }
    : currentModelInfo?.apiMode === 'responses'
      ? { text: '/r', title: '/responses' }
      : null;
  // E.6: in medium/compact tier we may not have room for a 30-char
  // model id; clip to a sensible head fragment. Wide tier keeps the
  // full name. Title attr always carries the full id for hover-reveal.
  const displayLabel = tier === 'wide'
    ? fullLabel
    : (fullLabel.length > 12 ? `${fullLabel.slice(0, 10)}…` : fullLabel);

  // UI revamp: when used inside the composer (`tier !== 'wide'` is the
  // typical composer call), render a slightly more compact pill so the
  // 3+ controls in the bottom-left cluster don't run out of horizontal
  // space. Header callers keep the original h-8 chrome.
  const triggerHeight = tier === 'wide' ? 'h-8' : 'h-7';
  const triggerPx = tier === 'wide' ? 'px-3' : 'px-2';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${triggerHeight} ${triggerPx} flex items-center gap-1 rounded-md text-[12px] transition-colors border ${
          disabled
            ? 'text-slate-300 border-transparent cursor-not-allowed'
            : open
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100 border-transparent'
        }`}
        title={`选择模型 — 当前: ${fullLabel}`}
      >
        <span className="font-mono">{displayLabel}</span>
        {modeBadge && (
          <span title={modeBadge.title} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-500">
            {modeBadge.text}
          </span>
        )}
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          className={`absolute right-0 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1 ${
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {models.map((m) => {
            const key = `${m.provider}/${m.id}`;
            const active = key === currentModel;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { onChange(m.provider, m.id); setOpen(false); }}
                className={`w-full px-3 py-2 flex items-center justify-between text-left text-xs transition-colors ${
                  active ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="font-mono truncate">{m.id}</span>
                <div className="ml-2 flex items-center gap-1 shrink-0">
                  {m.apiMode && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded uppercase tracking-wider">
                      {m.apiMode === 'chat' ? '/c' : '/r'}
                    </span>
                  )}
                  {m.isDefault && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded uppercase tracking-wider">
                      default
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── U1: workspace badge ──
 *
 * Read-only indicator next to the API mode badge that tells the user
 * which folder the current conversation operates in. Hover reveals
 * the absolute path. In global mode (cwd = userfile root) we render
 * a subdued "全局" pill so it's always clear the agent is *not*
 * scoped to a project — that's a meaningful state, not the absence
 * of one.
 */

function WorkspaceBadge({ cwd, isGlobal, onOpenInExplorer }) {
  // Even in global mode the user might want to open `userfile/` to
  // see what's in the global root. We render a clickable icon
  // attached to the badge so it's a single click whether it's global
  // or a project workspace.
  const handleOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenInExplorer?.();
  };
  if (isGlobal) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-slate-50 text-slate-500 border-slate-200"
        title="工作空间：全局（默认 userfile/ 根目录） — 点击右侧图标在访达中打开"
      >
        <Globe size={10} />
        <span>全局</span>
        {onOpenInExplorer && (
          <button
            type="button"
            onClick={handleOpen}
            className="ml-0.5 text-slate-400 hover:text-slate-700 transition-colors"
            title="在访达中打开"
          >
            <ExternalLink size={10} />
          </button>
        )}
      </span>
    );
  }
  if (!cwd) return null;
  const segs = String(cwd).split(/[\\/]+/).filter(Boolean);
  const name = segs[segs.length - 1] || cwd;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-amber-50 text-amber-700 border-amber-200 max-w-[200px]"
      title={`工作空间：${cwd} — 点击右侧图标在访达中打开`}
    >
      <Folder size={10} className="shrink-0" />
      <span className="truncate">{name}</span>
      {onOpenInExplorer && (
        <button
          type="button"
          onClick={handleOpen}
          className="ml-0.5 text-amber-500 hover:text-amber-800 transition-colors shrink-0"
          title="在访达中打开"
        >
          <ExternalLink size={10} />
        </button>
      )}
    </span>
  );
}

/* ── U1: workspace selector ──
 *
 * Header dropdown that lists every workspace KnowClaw can target:
 *   - Global  — always present, always first
 *   - IPM project / case / study folders (grouped by domain)
 *   - Imported local folders
 *   - "+ 新建工作空间" — creates a timestamped subfolder under
 *     <userFileRoot>/workspaces and switches into it
 *   - "选择自定义目录…" — pops the OS folder picker
 *
 * Switching is a hard session boundary (pi binds cwd at creation
 * time): the hook clears the visible transcript on success so the
 * user sees a clean slate ready for the new workspace. Disabled
 * while a turn is streaming to avoid mid-flight workspace swaps.
 */

const DOMAIN_LABELS = {
  projects: '项目',
  cases: '案件',
  study: '学习',
  workspaces: 'KnowClaw 工作空间',
  pinned: '自定义目录',
  local: '本地文件夹',
  global: '全局',
  // FK6-3: dedicated group for the floating-window's `_floating`
  // workspace so the "回到空间" handoff lands the user on a clearly
  // labelled entry instead of a generic workspaces/ subfolder row.
  floating: '悬浮助手',
};

function WorkspaceSelector({
  currentCwd,
  isGlobal,
  userFileRoot,
  workspaces,
  loading,
  onSelect,
  onRefresh,
  onChooseDirectory,
  onCreateWorkspace,
  onOpenInExplorer,
  onHideWorkspace,
  disabled,
  // UI revamp: when this selector lives at the bottom of the screen
  // (inside the composer), the popover panel must open upward so it
  // doesn't get clipped by the viewport edge.
  placement = 'down',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  // Refresh the list each time the dropdown opens so newly-created
  // projects / imported folders show up without a manual reload.
  //
  // We intentionally only depend on `open` here. The caller's
  // `onRefresh` (currently `loadWorkspaces` from useKnowClawV2Chat)
  // may not be referentially stable across parent re-renders; if we
  // listed it as a dep, the effect would fire repeatedly while the
  // dropdown is open, each refresh queuing a state update that
  // re-renders the parent → new function reference → effect fires
  // again, producing the "opens, flickers, redraws" symptom users
  // reported after the composer move. Reading via a ref keeps the
  // call but avoids re-subscribing.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => {
    if (open) {
      setQuery('');
      onRefreshRef.current?.();
    }
  }, [open]);

  // Group workspaces by domain. Filtered by the search query against
  // both name and absolute path so users can paste a path fragment.
  const grouped = useMemo(() => {
    const list = Array.isArray(workspaces) ? workspaces : [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (w) =>
            String(w.name || '').toLowerCase().includes(q)
            || String(w.path || '').toLowerCase().includes(q),
        )
      : list;
    /** @type {Record<string, Array<{name:string, domain:string, path:string, isGlobal?:boolean}>>} */
    const groups = {};
    for (const w of filtered) {
      const key = w.isGlobal ? 'global' : (w.domain || 'local');
      if (!groups[key]) groups[key] = [];
      groups[key].push(w);
    }
    return groups;
  }, [workspaces, query]);

  // Display label: folder basename for project mode, "全局" for global.
  let displayLabel;
  let displayTooltip;
  if (isGlobal) {
    displayLabel = '全局';
    displayTooltip = `工作空间：全局（${userFileRoot || 'userfile 根目录'}）`;
  } else if (currentCwd) {
    const segs = String(currentCwd).split(/[\\/]+/).filter(Boolean);
    displayLabel = segs[segs.length - 1] || currentCwd;
    displayTooltip = `工作空间：${currentCwd}`;
  } else {
    displayLabel = '工作空间';
    displayTooltip = '选择工作空间';
  }

  // Render order: global → 悬浮助手 (FK6 handoff target) →
  // KnowClaw workspaces (the user's most recent destination, since
  // "新建工作空间" lands here) → pinned custom directories →
  // IPM structured (projects/cases/study) → imported local folders.
  const orderedGroupKeys = ['global', 'floating', 'workspaces', 'pinned', 'projects', 'cases', 'study', 'local']
    .filter((k) => grouped[k] && grouped[k].length > 0);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] transition-colors border ${
          disabled
            ? 'text-slate-300 border-transparent cursor-not-allowed'
            : open
              ? 'bg-slate-100 text-slate-700 border-slate-200'
              : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100 border-transparent'
        }`}
        title={displayTooltip}
      >
        {isGlobal ? (
          <Globe size={13} className="shrink-0" />
        ) : (
          <FolderOpen size={13} className="shrink-0" />
        )}
        <span className="max-w-[120px] truncate">{displayLabel}</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          className={`absolute right-0 w-72 max-w-[calc(100vw-24px)] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[480px] ${
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {/* Search row */}
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索工作空间…"
                className="w-full pl-7 pr-2 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
              />
            </div>
          </div>

          {/* Scrollable workspace list */}
          <div className="flex-1 overflow-y-auto py-1">
            {loading && (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">加载中…</div>
            )}
            {!loading && orderedGroupKeys.length === 0 && (
              <div className="px-3 py-3 text-xs text-slate-400 text-center">
                {query ? '无匹配工作空间' : '暂无可选工作空间'}
              </div>
            )}
            {!loading && orderedGroupKeys.map((groupKey) => (
              <div key={groupKey}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {DOMAIN_LABELS[groupKey] || groupKey}
                </div>
                {grouped[groupKey].map((ws) => {
                  const active = ws.isGlobal
                    ? isGlobal
                    : (currentCwd && String(currentCwd).toLowerCase() === String(ws.path).toLowerCase());
                  // Hide is only offered for user-managed workspaces.
                  // Anything the IPC marks as `protected: true`
                  // (global root + every entry under projects/cases/
                  // study) is part of IPM's core data and may not be
                  // hidden — those are first-class business folders,
                  // not optional clutter. The backend enforces the
                  // same rule, so even a renderer that bypasses this
                  // gate can't sneak business data out of view.
                  const canHide = !ws.isGlobal && !ws.protected && Boolean(onHideWorkspace);
                  // FK6-3: highlight the 悬浮助手 entry with a violet
                  // accent so it visually stands apart from regular
                  // workspaces — matches the floating-window's violet
                  // KnowClaw accent palette and signals "this is the
                  // floating bucket".
                  const isFloating = ws.domain === 'floating';
                  return (
                    <div
                      key={`${ws.domain}-${ws.path}`}
                      className={`group w-full px-3 py-2 flex items-center gap-1 text-left text-xs transition-colors ${
                        active
                          ? 'bg-amber-50 text-amber-700'
                          : isFloating
                            ? 'text-violet-700 hover:bg-violet-50/60'
                            : 'text-slate-600 hover:bg-slate-50'
                      }`}
                      title={ws.path}
                    >
                      <button
                        type="button"
                        onClick={() => { onSelect?.(ws); setOpen(false); }}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                      >
                        {ws.isGlobal ? (
                          <Globe size={12} className="shrink-0 text-slate-400" />
                        ) : (
                          <Folder
                            size={12}
                            className={`shrink-0 ${isFloating ? 'text-violet-400' : 'text-slate-400'}`}
                          />
                        )}
                        <span className="flex-1 truncate">{ws.name}</span>
                        {isFloating && !active && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 uppercase tracking-wider shrink-0">
                            悬浮
                          </span>
                        )}
                        {active && (
                          <span className="text-[9px] text-amber-600 uppercase tracking-wider shrink-0">当前</span>
                        )}
                      </button>
                      {onOpenInExplorer && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInExplorer(ws.path);
                          }}
                          className="shrink-0 p-0.5 rounded text-slate-300 hover:text-slate-700 hover:bg-slate-200 transition-colors opacity-0 group-hover:opacity-100"
                          title={`在访达中打开 ${ws.path}`}
                        >
                          <ExternalLink size={11} />
                        </button>
                      )}
                      {canHide && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onHideWorkspace(ws.path);
                          }}
                          className="shrink-0 p-0.5 rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
                          title={`从下拉中移除（不会删除文件夹本身）— 重新「选择自定义目录」选回该路径可恢复`}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer actions */}
          <div className="border-t border-slate-100 bg-slate-50/40 py-1">
            {onOpenInExplorer && (
              <button
                type="button"
                onClick={async () => {
                  setOpen(false);
                  await onOpenInExplorer();
                }}
                className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs text-slate-600 hover:bg-slate-100 transition-colors"
                title="在访达中打开当前工作空间文件夹"
              >
                <ExternalLink size={12} className="shrink-0 text-slate-500" />
                <span className="flex-1">在访达中打开当前工作空间</span>
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await onCreateWorkspace?.();
              }}
              className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs text-slate-600 hover:bg-slate-100 transition-colors"
              title={`在 ${userFileRoot || 'userfile/'}/workspaces/ 下新建一个带时间戳的工作文件夹`}
            >
              <FolderPlus size={12} className="shrink-0 text-amber-600" />
              <span className="flex-1">新建工作空间</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await onChooseDirectory?.();
              }}
              className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs text-slate-600 hover:bg-slate-100 transition-colors"
              title="使用系统对话框选择任意目录作为工作空间"
            >
              <Plus size={12} className="shrink-0 text-slate-500" />
              <span className="flex-1">选择自定义目录…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── U0.5: API mode badge ──
 *
 * Tiny read-only indicator showing whether KnowClaw is currently
 * targeting `/v1/chat/completions` or `/v1/responses`. Hover for the
 * reason it matters (raw thinking only flows through Responses on
 * OpenAI; Chat can still surface it on gateways that emit
 * `reasoning_content` deltas).
 *
 * Changing the value requires editing IPM settings (prefs.llm.apiMode)
 * or the `OPENAI_API_MODE` env var and reloading the runtime — both
 * out of scope for a passive badge.
 */

function ApiModeBadge({ mode }) {
  if (!mode) return null;
  const isResponses = mode === 'responses';
  const label = isResponses ? 'Responses' : 'Chat';
  const tooltip = isResponses
    ? '当前走 /v1/responses。OpenAI 推理模型(o-系列/gpt-5.x)的思考摘要会以 thinking_delta 流式返回。'
    : '当前走 /v1/chat/completions。OpenAI 官方不会在此协议下返回思考文本；只有自带 reasoning_content 扩展的网关才有思考流。';
  const cls = isResponses
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}
      title={tooltip}
    >
      {label}
    </span>
  );
}

/* ── U5: context-usage pill ──
 *
 * Compact header indicator showing how full the model's context
 * window is. Three states:
 *
 *   - null usage          → don't render (no session yet)
 *   - tokens === null     → "N/A" — pi can't estimate right after a
 *                           compact, until the next LLM response
 *                           refreshes its internal counters
 *   - normal              → "{percent}%" + a 2px progress strip
 *                           along the bottom edge
 *
 * Color semantics escalate with usage so the user gets a passive
 * "you're getting close" signal without an explicit alert:
 *   < 50%   slate / neutral
 *   50–80%  amber
 *   ≥ 80%   rose
 *
 * Tooltip always carries the raw figures (`{tokens} / {window}`)
 * for users who want the actual numbers.
 */

function ContextPill({ usage }) {
  if (!usage || typeof usage !== 'object') return null;
  const { tokens, contextWindow, percent } = usage;
  if (!contextWindow || contextWindow <= 0) return null;
  const hasNumbers = typeof tokens === 'number' && typeof percent === 'number';
  const display = hasNumbers ? `${Math.round(percent)}%` : 'N/A';
  const tooltip = hasNumbers
    ? `上下文用量：${tokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens（${Math.round(percent)}%）`
    : `上下文用量待重算（窗口 ${contextWindow.toLocaleString()} tokens）。下一轮模型响应后会刷新。`;
  let cls = 'bg-slate-50 text-slate-500 border-slate-200';
  let barColor = '#94a3b8';
  if (hasNumbers) {
    if (percent >= 80) {
      cls = 'bg-rose-50 text-rose-700 border-rose-200';
      barColor = '#e11d48';
    } else if (percent >= 50) {
      cls = 'bg-amber-50 text-amber-700 border-amber-200';
      barColor = '#d97706';
    }
  }
  const fillPercent = hasNumbers ? Math.min(100, Math.max(0, percent)) : 0;
  return (
    <span
      className={`relative inline-flex items-center h-8 px-2 rounded-lg text-[11px] font-medium border ${cls} overflow-hidden`}
      title={tooltip}
    >
      <span className="font-mono">{display}</span>
      {hasNumbers && (
        <span
          aria-hidden="true"
          className="absolute left-0 bottom-0 h-[2px] transition-[width] duration-300"
          style={{ width: `${fillPercent}%`, backgroundColor: barColor }}
        />
      )}
    </span>
  );
}

/* ── U8a: cumulative token-count pill ──
 *
 * Sibling of `ContextPill`. ContextPill shows the *current* window
 * occupancy (resets on compact), TokenPill shows the *cumulative*
 * input/output tokens spent on this session since it was created
 * — so the user can see "this whole conversation has cost me X
 * tokens" even after multiple compactions.
 *
 * Cost is deliberately omitted (see the `sessionStats` field's
 * comment in `desktop/src/main/ipc/knowclaw.js`).
 *
 * Hover tooltip exposes the full breakdown: input / output /
 * cacheRead / cacheWrite + user / assistant / toolCall counters.
 * That keeps the chip itself slim (just total tokens) while
 * letting power users drill in.
 *
 * Renders nothing when `stats` is null (no session yet) so the
 * header doesn't flicker an empty box during boot.
 */
function TokenPill({ stats }) {
  if (!stats || typeof stats !== 'object') return null;
  const t = stats.tokens || {};
  const total = typeof t.total === 'number' ? t.total : 0;
  if (total <= 0) return null;
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '0');
  // Compact display: just the total. ≥10k switches to "12.3k" to
  // keep the chip width predictable in a busy header.
  const display = total >= 10_000
    ? `${(total / 1000).toFixed(1)}k`
    : fmt(total);
  const tooltipLines = [
    `本会话累计 token：${fmt(total)}`,
    `  • 输入 ${fmt(t.input)}`,
    `  • 输出 ${fmt(t.output)}`,
  ];
  if (t.cacheRead > 0) tooltipLines.push(`  • cache 读 ${fmt(t.cacheRead)}`);
  if (t.cacheWrite > 0) tooltipLines.push(`  • cache 写 ${fmt(t.cacheWrite)}`);
  tooltipLines.push('');
  tooltipLines.push(`消息：${fmt(stats.userMessages)} 用户 / ${fmt(stats.assistantMessages)} 助手`);
  tooltipLines.push(`工具调用：${fmt(stats.toolCalls)}`);
  return (
    <span
      className="inline-flex items-center h-8 px-2 rounded-lg text-[11px] font-medium border bg-slate-50 text-slate-600 border-slate-200"
      title={tooltipLines.join('\n')}
    >
      <span className="font-mono">Σ {display}</span>
    </span>
  );
}

/* ── U5: manual compact trigger ──
 *
 * Header-right ghost button that calls `session.compact()`. Hidden
 * when there's no active session (i.e. `usage === null`); disabled
 * while streaming (pi guards this too) or while another compaction
 * is in flight. The icon flips to a spinner during compaction so
 * the user gets immediate feedback even before the banner mounts.
 */

function CompactButton({ onCompact, disabled, compacting, visible }) {
  if (!visible) return null;
  const handleClick = async () => {
    if (disabled) return;
    try { await onCompact?.(); } catch { /* swallowed; banner + system message handle errors */ }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      title={
        compacting
          ? '上下文压缩中…'
          : '手动压缩上下文 — 将较旧的消息摘要化以释放 token 空间'
      }
    >
      {compacting ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Minimize2 size={13} />
      )}
      <span>{compacting ? '压缩中' : '压缩'}</span>
    </button>
  );
}

/* ── U5: compaction / retry banner ──
 *
 * One sticky stripe between the header and the chat scroll area
 * that surfaces two mutually-exclusive long-running states:
 *
 *   - `compacting`: pi is summarizing older messages. Subtitle
 *     reflects the reason (manual / threshold / overflow) so the
 *     user understands whether they triggered this or pi did.
 *   - `retrying`: pi is sleeping before a transient-error retry
 *     (rate limit, 5xx). Shows attempt counter + seconds left.
 *
 * Returns null when neither flag is on, which keeps the layout
 * stable (no spacer reserved when idle).
 */

function CompactionBanner({ compacting, reason, retrying }) {
  if (compacting) {
    const reasonLabel = (() => {
      switch (reason) {
        case 'manual': return '手动触发';
        case 'threshold': return '上下文接近窗口阈值，自动触发';
        case 'overflow': return '上下文已溢出，正在恢复';
        default: return null;
      }
    })();
    return (
      <div
        className="flex items-center gap-3 px-6 py-2 border-b text-[12px]"
        style={{ background: '#eff6ff', borderBottomColor: '#bfdbfe' }}
      >
        <Loader2 size={14} className="text-blue-600 animate-spin shrink-0" />
        <div className="flex-1 min-w-0 leading-relaxed">
          <span className="font-semibold text-blue-900">正在压缩上下文…</span>
          {reasonLabel && (
            <span className="ml-2 text-blue-700">{reasonLabel}</span>
          )}
        </div>
      </div>
    );
  }

  if (retrying) {
    const seconds = Math.round((retrying.delayMs || 0) / 1000);
    const total = retrying.maxAttempts || '?';
    const attempt = retrying.attempt || '?';
    return (
      <div
        className="flex items-center gap-3 px-6 py-2 border-b text-[12px]"
        style={{ background: '#fff7ed', borderBottomColor: '#fed7aa' }}
      >
        <RefreshCw size={14} className="text-amber-600 animate-spin shrink-0" />
        <div className="flex-1 min-w-0 leading-relaxed text-amber-900">
          <span className="font-semibold">自动重试中</span>
          <span className="ml-2">
            第 {attempt}/{total} 次{seconds > 0 ? `，等待 ${seconds} 秒…` : '…'}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

/* ── U0 (revised): thinking depth selector ──
 *
 * Design principles (mirrors the user's spec):
 *   1. Never block the user. Every level is always selectable
 *      regardless of model metadata.
 *   2. No upfront "this model doesn't support thinking" warning.
 *      We trust the user's intent and let the upstream API decide.
 *   3. After a turn finishes, if the level was non-'off' but no
 *      `thinking_delta` arrived, we surface a *soft* hint:
 *        - a tiny amber dot on the selector button
 *        - an info row at the top of the dropdown explaining
 *          why no thinking was visible, with a dismiss control.
 *      The hint clears automatically as soon as a future turn
 *      produces thinking content (or the user re-selects a level).
 */

/**
 * U6: sub-agent kill-switch toggle.
 *
 * Renders as a compact pill button in the header right cluster
 * (alongside the thinking selector). Clicking flips
 * `state.knowclaw.subAgentEnabled` and emits a system info bubble
 * explaining the change takes effect on the *next* new conversation
 * (pi binds customTools at session creation; the active session
 * keeps its tool set frozen).
 *
 * Visual contract:
 *   enabled = true   → Network icon + 子代理 label, primary tone
 *                      (the default state we want users to keep).
 *   enabled = false  → Network icon dimmed + label crossed out via
 *                      a "禁用" suffix and muted tone.
 *
 * Disabled while streaming: changing the toggle during a turn is
 * cosmetic anyway (the live session keeps its current tool set),
 * and gating it makes the affordance feel "settled".
 */
const SubAgentToggle = ({ enabled, onToggle, disabled, tier = 'wide' }) => {
  const handleClick = () => {
    if (disabled) return;
    onToggle?.(!enabled);
  };
  const title = enabled
    ? '子代理已启用 — 模型可调用 delegate_task 委托独立子任务。点击禁用（下次新对话生效）。'
    : '子代理已禁用 — 当前模型看不到 delegate_task 工具。点击启用（下次新对话生效）。';
  // E.6: tier === 'wide' shows the text label, otherwise icon-only.
  // We accept undefined as 'wide' for backward compatibility with
  // callers that haven't been updated yet.
  const showLabel = tier === 'wide';
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`relative h-8 ${showLabel ? 'px-2.5' : 'px-2'} flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
        disabled
          ? 'text-slate-300 cursor-not-allowed'
          : enabled
            ? 'text-emerald-600 hover:bg-emerald-50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
      }`}
      title={title}
      aria-pressed={Boolean(enabled)}
    >
      <Network size={13} className="shrink-0" />
      {showLabel && <span>{enabled ? '子代理' : '子代理 关'}</span>}
      {!enabled && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-slate-400 ring-2 ring-white"
          aria-hidden="true"
        />
      )}
    </button>
  );
};

// E.5: Plan / Agent mode toggle. Sits in the composer bottom toolbar
// (post UI revamp; previously lived in the header). Disabled mid-stream
// so mode can't flip while a turn is in flight (the backend enforces
// this too via knowclaw:setPlanMode but we don't even let the click
// happen).
const PlanModeToggle = ({ planMode, onToggle, disabled, tier = 'wide' }) => {
  const handleClick = () => {
    if (disabled) return;
    onToggle?.(!planMode);
  };
  const title = planMode
    ? 'Plan 模式 — 模型只能读取与提问，不会改文件。点击切换到 Agent 模式。'
    : 'Agent 模式 — 模型可以读写文件、运行命令。点击切换到 Plan 模式（先规划再执行）。';
  const showLabel = tier === 'wide';
  // UI revamp: compact (h-7) pill in composer; original h-8 in header
  // overflow menu (tier === 'wide').
  const compact = tier !== 'wide';
  const heightCls = compact ? 'h-7' : 'h-8';
  const padCls = showLabel ? 'px-2' : 'px-2';
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`relative ${heightCls} ${padCls} flex items-center gap-1 rounded-md text-[12px] transition-colors border ${
        disabled
          ? 'text-slate-300 border-transparent cursor-not-allowed'
          : planMode
            ? 'text-violet-700 bg-violet-50 hover:bg-violet-100 border-violet-200'
            : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100 border-transparent'
      }`}
      title={title}
      aria-pressed={Boolean(planMode)}
    >
      <ClipboardList size={13} className="shrink-0" />
      {showLabel && <span>{planMode ? 'Plan' : 'Agent'}</span>}
    </button>
  );
};

const THINKING_LEVELS = [
  { value: 'off',     label: '关闭', icon: '○', hint: '不使用思考' },
  { value: 'minimal', label: '极简', icon: '◐', hint: '尽量少的推理预算' },
  { value: 'low',     label: '浅',   icon: '◔', hint: '快速浅层推理' },
  { value: 'medium',  label: '中',   icon: '◑', hint: '默认平衡推理' },
  { value: 'high',    label: '深',   icon: '●', hint: '深度推理（更慢/更贵）' },
];

const ThinkingLevelSelector = ({ level, onChange, hint, onDismissHint, disabled, tier = 'wide' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = THINKING_LEVELS.find((t) => t.value === level) || THINKING_LEVELS[3];
  // Only surface the post-turn hint when the user actually has
  // thinking on. If they're already at 'off' there's nothing to warn
  // about.
  const showHint = hint === 'no-content' && level !== 'off';

  const buttonTitle = showHint
    ? `思考深度: ${current.label}（上一轮未检测到思考内容，点击查看说明）`
    : `思考深度: ${current.label}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`relative h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
          disabled
            ? 'text-slate-300 cursor-not-allowed'
            : open
              ? 'bg-slate-100 text-slate-700'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title={buttonTitle}
      >
        <Brain size={13} className="shrink-0" />
        <span className="font-mono">{current.icon}</span>
        {tier === 'wide' && <span>{current.label}</span>}
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {showHint && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-white"
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
          {showHint && (
            <div className="px-3 py-2 text-[10px] text-amber-700 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
              <span className="flex-1 leading-snug">
                上一轮未收到思考内容。当前模型或网关可能未支持
                <span className="font-mono"> reasoning_effort </span>
                参数，可尝试切换模型或将级别调至「关闭」。
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissHint?.();
                }}
                className="shrink-0 text-amber-500 hover:text-amber-700"
                title="忽略提示"
              >
                ✕
              </button>
            </div>
          )}
          {THINKING_LEVELS.map((t) => {
            const active = t.value === level;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => { onChange(t.value); setOpen(false); }}
                className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs transition-colors ${
                  active ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
                title={t.hint}
              >
                <span className="font-mono w-3">{t.icon}</span>
                <span className="flex-1">{t.label}</span>
                <span className="text-[10px] text-slate-400">{t.value}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KnowClawV2Page;
