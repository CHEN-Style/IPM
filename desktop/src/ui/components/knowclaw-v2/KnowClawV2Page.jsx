// desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx
//
// Phase-4 minimal Chat UI for the new pi-coding-agent runtime. This panel
// runs alongside (does NOT replace) the legacy KnowClaw page so the two
// stacks can be compared during the migration.

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import MessageBubble from '../agent-chat/MessageBubble.jsx';
import ChatInput from '../agent-chat/ChatInput.jsx';
import useKnowClawV2Chat from './useKnowClawV2Chat.js';
import SessionPanel from './SessionPanel.jsx';

const HINT_PROMPTS = [
  '你好，用一句话告诉我 1+1 等于几',
  '列出 D 盘 IPM 项目根目录的内容',
  '读取 desktop/package.json 并告诉我 React 版本',
  '当前工作目录是什么？',
];

const KnowClawV2Page = () => {
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
  } = useKnowClawV2Chat();

  const bottomRef = useRef(null);

  // U8b-9: vision UI only when the active model declares `image` input.
  const supportsImages = useMemo(() => {
    if (!currentModel || !models?.length) return false;
    const active = models.find((m) => `${m.provider}/${m.id}` === currentModel);
    return Array.isArray(active?.input) && active.input.includes('image');
  }, [currentModel, models]);

  // U3 + bundled-bash: per-session dismiss for the bash banner. We
  // intentionally don't persist the dismiss — every fresh app launch
  // re-asserts the warning so users don't accumulate a permanently
  // broken Skill toolchain. `bashAvailable === false` is authoritative
  // (main process probed at startup); `null` means we haven't
  // received status yet, so we wait and don't flash.
  //
  // The banner now has a "立即重新检测" button to spare users from
  // restarting IPM after they install Git for Windows in a separate
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleHintClick = (hint) => {
    if (!streaming) sendMessage(hint);
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
          />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* U3 + bundled-bash: Git Bash missing banner.
            Visible only when `resolveBashShell()` in the main process
            couldn't find a system Git, anything on PATH, or the
            bundled MinGit fallback. The "立即重新检测" button forces
            a fresh probe so users who just installed Git for Windows
            don't need to restart IPM. Dismiss is per-session. */}
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
                Windows 用户请安装{' '}
                <a
                  href="https://git-scm.com/download/win"
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-amber-900 hover:text-amber-700"
                >
                  Git for Windows
                </a>
                ，安装完成后点击「立即重新检测」即可启用，无需重启 IPM。
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

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSessionPanel(!showSessionPanel)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title={showSessionPanel ? '隐藏会话列表' : '显示会话列表'}
            >
              {showSessionPanel ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-200">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">KnowClaw v2</h2>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>pi-coding-agent runtime{sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}</span>
                {apiMode && <ApiModeBadge mode={apiMode} />}
                <WorkspaceBadge
                  cwd={currentCwd}
                  isGlobal={cwdIsGlobal}
                  onOpenInExplorer={() => openInExplorer()}
                />
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
              disabled={streaming}
            />
            <ContextPill usage={contextUsage} />
            <TokenPill stats={sessionStats} />
            <ThinkingLevelSelector
              level={thinkingLevel}
              onChange={changeThinkingLevel}
              hint={thinkingHint}
              onDismissHint={dismissThinkingHint}
              disabled={streaming}
            />
            <SubAgentToggle
              enabled={subAgentEnabled}
              onToggle={toggleSubAgent}
              disabled={streaming}
            />
            <ModelSelector
              models={models}
              currentModel={currentModel}
              onChange={(provider, id) => setModel(provider, id)}
              disabled={streaming}
            />
            <CompactButton
              onCompact={compactSession}
              disabled={streaming || compacting}
              compacting={compacting}
              visible={Boolean(contextUsage)}
            />
            <button
              type="button"
              onClick={newSession}
              disabled={streaming}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="开始新对话"
            >
              <RotateCcw size={13} />
              <span>新对话</span>
            </button>
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
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto">
              {messages.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center max-w-lg">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                    <Zap size={28} className="text-amber-600" />
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

            {messages.map((msg, i) => (
              <MessageBubble
                key={i}
                message={msg}
                projectName="KnowClawV2"
                domain="knowclaw"
              />
            ))}

            <div ref={bottomRef} />
          </div>
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
                onSend={sendMessage}
                disabled={false}
                supportsImages={supportsImages}
                placeholder={composerPlaceholder(streaming, streamingMode)}
              />
            </div>
          </div>
        </div>
      </div>
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

const ModelSelector = ({ models, currentModel, onChange, disabled }) => {
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
      <span className="h-8 px-3 flex items-center text-xs text-slate-400">
        模型加载中...
      </span>
    );
  }

  const displayLabel = currentModel ? currentModel.split('/').slice(-1)[0] : '选择模型';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
          disabled
            ? 'text-slate-300 cursor-not-allowed'
            : open
              ? 'bg-slate-100 text-slate-700'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title="选择模型"
      >
        <span className="font-mono">{displayLabel}</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
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
                {m.isDefault && (
                  <span className="ml-2 px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded uppercase tracking-wider">
                    default
                  </span>
                )}
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
        title="工作空间：全局（默认 userfile/ 根目录） — 点击右侧图标在文件资源管理器中打开"
      >
        <Globe size={10} />
        <span>全局</span>
        {onOpenInExplorer && (
          <button
            type="button"
            onClick={handleOpen}
            className="ml-0.5 text-slate-400 hover:text-slate-700 transition-colors"
            title="在文件资源管理器中打开"
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
      title={`工作空间：${cwd} — 点击右侧图标在文件资源管理器中打开`}
    >
      <Folder size={10} className="shrink-0" />
      <span className="truncate">{name}</span>
      {onOpenInExplorer && (
        <button
          type="button"
          onClick={handleOpen}
          className="ml-0.5 text-amber-500 hover:text-amber-800 transition-colors shrink-0"
          title="在文件资源管理器中打开"
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
  useEffect(() => {
    if (open) {
      setQuery('');
      onRefresh?.();
    }
  }, [open, onRefresh]);

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

  // Render order: global → KnowClaw workspaces (the user's most
  // recent destination, since "新建工作空间" lands here) →
  // pinned custom directories → IPM structured (projects/cases/study)
  // → imported local folders.
  const orderedGroupKeys = ['global', 'workspaces', 'pinned', 'projects', 'cases', 'study', 'local']
    .filter((k) => grouped[k] && grouped[k].length > 0);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
          disabled
            ? 'text-slate-300 cursor-not-allowed'
            : open
              ? 'bg-slate-100 text-slate-700'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
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
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[480px]">
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
                  return (
                    <div
                      key={`${ws.domain}-${ws.path}`}
                      className={`group w-full px-3 py-2 flex items-center gap-1 text-left text-xs transition-colors ${
                        active ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'
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
                          <Folder size={12} className="shrink-0 text-slate-400" />
                        )}
                        <span className="flex-1 truncate">{ws.name}</span>
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
                          title={`在文件资源管理器中打开 ${ws.path}`}
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
                title="在文件资源管理器中打开当前工作空间文件夹"
              >
                <ExternalLink size={12} className="shrink-0 text-slate-500" />
                <span className="flex-1">在文件资源管理器中打开当前工作空间</span>
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
const SubAgentToggle = ({ enabled, onToggle, disabled }) => {
  const handleClick = () => {
    if (disabled) return;
    onToggle?.(!enabled);
  };
  const title = enabled
    ? '子代理已启用 — 模型可调用 delegate_task 委托独立子任务。点击禁用（下次新对话生效）。'
    : '子代理已禁用 — 当前模型看不到 delegate_task 工具。点击启用（下次新对话生效）。';
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`relative h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
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
      <span className="hidden md:inline">{enabled ? '子代理' : '子代理 关'}</span>
      {!enabled && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-slate-400 ring-2 ring-white"
          aria-hidden="true"
        />
      )}
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

const ThinkingLevelSelector = ({ level, onChange, hint, onDismissHint, disabled }) => {
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
        <span className="hidden md:inline">{current.label}</span>
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
