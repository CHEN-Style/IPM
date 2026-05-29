// desktop/src/ui/hooks/useKnowClawPersist.jsx
//
// D.1 — App-level persistent KnowClaw state.
//
// Before D.1 every piece of conversation state (messages, streaming
// flag, sessionId, sessionStats, contextUsage, ...) lived inside
// `useKnowClawV2Chat`, which is a hook scoped to the KnowClawV2Page
// component. Whenever the user navigated away (e.g. clicked the
// "我的资料" tab) the page unmounted, the hook tore down, and the
// `knowclaw:event` IPC listener got `removeListener`'d — meaning the
// pi-coding-agent session in the main process kept generating but
// every `text_delta` / `tool_execution_*` event sent over the bridge
// landed on no handler and was silently dropped. Coming back to the
// page showed an empty / partial transcript, with the only recovery
// being to manually open the JSONL via the session panel.
//
// The fix is to lift the listener (and the data it produces) to the
// App level via a React Context that stays mounted for the entire
// lifetime of the renderer process. The Provider:
//
//   1. Subscribes to `window.ipm.knowclaw.onEvent` exactly once.
//   2. Owns all conversation-related state (messages, streaming,
//      sessionId, sessionStats, contextUsage, pendingSteer/followUp,
//      tasks, compaction/retry banners, workspace state,
//      thinkingLevel, subAgentEnabled, models, ...).
//   3. Exposes every existing action (sendMessage, abort,
//      newSession, openSession, ...) — `useKnowClawV2Chat` is now a
//      thin facade that reads from this Context.
//   4. On mount calls `knowclaw:rehydrate` so a fresh renderer
//      (Electron reload / devtools refresh) picks up the live
//      session's transcript without forcing the user to reopen it.
//
// E.6 (partial): because the Provider survives navigation, header
// chips like ContextPill / TokenPill keep their value when the user
// re-enters the page — no more "flash of empty pill" while the next
// `getStatus` polling round-trips.
//
// Session lock: the Provider exposes `isSessionLocked = streaming &&
// hasSession`. The page reads this to disable "新对话" / workspace
// swap / SessionPanel rows during streaming — the goal is to prevent
// the user from accidentally tearing down an in-flight session by
// clicking around. ChatInput stays enabled because `sendMessage`
// already routes typed text into steer/followUp queues during a
// turn.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useConfirmDialog } from './useConfirmDialog.jsx';
import { useToast } from './useToast.js';
import {
  ensureStreamingMessage,
  stringifyResult,
  updateToolByCallId,
  extractTouchedFilesFromEvent,
  toRelPosix,
  summarizeToolArgs,
  normalizeTasksArray,
} from '../components/knowclaw-v2/knowclawEventReducer.js';

const KnowClawCtx = createContext(null);

// ---------- E.7: @-reference expansion helpers ----------
//
// The user types (or drag-drops produce) `@relPath/to/file.ext` tokens
// in the composer. We keep those tokens *verbatim* in the rendered
// user-message bubble so the chat reads naturally ("帮我总结
// @合同.docx 的要点"), but the LLM payload gets a prepended structured
// hint block listing the referenced files as bare workspace-relative
// paths. The model already knows from the system prompt to call
// `read_file` on relative paths — the hint just makes the intent
// unambiguous without forcing the user to type "请先读取以下文件:"
// every time.
//
// We deliberately require a file extension (1–8 alnum chars) on the
// matched token to avoid false-positive expansion of `@user`-style
// mentions / email-fragments. We also gate on the @ being at a word
// boundary (start-of-string, whitespace, or punctuation) to keep
// `foo@example.com` from triggering.

const FILE_REF_PATTERN = /(^|[\s(\[{,;])@([^\s@()[\]{},;]+\.[A-Za-z0-9]{1,8})/g;

export function extractFileRefs(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  let m;
  // Reset lastIndex defensively in case the global regex is mid-iteration.
  FILE_REF_PATTERN.lastIndex = 0;
  while ((m = FILE_REF_PATTERN.exec(text)) !== null) {
    const ref = m[2];
    if (!seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  return out;
}

export function expandFileRefsForLlm(text) {
  const refs = extractFileRefs(text);
  if (refs.length === 0) return text;
  // Plain bullet list so the model can directly use each item with
  // `read_file` (or `read_many_files` if available). The bracketed
  // header keeps it visually distinct from prose.
  const header = '[文件引用 — 请用 read_file 读取以下工作空间相对路径]';
  const body = refs.map((r) => `- ${r}`).join('\n');
  return `${header}\n${body}\n\n${text}`;
}


export function KnowClawPersistProvider({ children }) {
  // U3: dependency-install confirmation dialog. We pop this from the
  // App-level Provider so the prompt survives even if the user
  // navigates away from the KnowClaw page mid-confirmation.
  const confirm = useConfirmDialog();

  // D.2: toast for surfacing newSession failures (LLM not configured,
  // pi-runtime crash, IPC throw). Without this the user sees an empty
  // chat with no feedback and likely retries by sending a message,
  // which then falls back to continueRecent and resurrects an old
  // session — the exact bug D.2 is fixing.
  const { showToast } = useToast();

  // ----- Core conversation state -----
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [currentSessionFile, setCurrentSessionFile] = useState(null);

  // ----- Models -----
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState(null);

  // ----- Sessions list -----
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // ----- Thinking / API mode -----
  const [thinkingLevel, setThinkingLevelState] = useState('medium');
  const [thinkingHint, setThinkingHint] = useState('none');
  const [apiMode, setApiMode] = useState(null);

  // ----- Bash detection -----
  const [bashAvailable, setBashAvailable] = useState(null);
  const [bashSource, setBashSource] = useState(null);

  // ----- Statistics + context usage -----
  const [sessionStats, setSessionStats] = useState(null);
  const [contextUsage, setContextUsage] = useState(null);
  const [compacting, setCompacting] = useState(false);
  const [compactionReason, setCompactionReason] = useState(null);
  const [retrying, setRetrying] = useState(null);

  // ----- Steer / followUp queues -----
  const [streamingMode, setStreamingMode] = useState('followUp');
  const [pendingSteer, setPendingSteer] = useState([]);
  const [pendingFollowUp, setPendingFollowUp] = useState([]);

  // ----- Sub-agent kill switch -----
  const [subAgentEnabled, setSubAgentEnabledState] = useState(true);

  // ----- SK1: skill management state -----
  // `skills` is the full SkillInfo[] returned by `knowclaw:listSkills`
  // (see `src/main/ipc/skills.js`). Loaded lazily the first time the
  // user opens the skill panel (via `loadSkills()`). Empty array until
  // then. Like `subAgentEnabled`, changes here take effect on the
  // NEXT new conversation — pi binds the skill set at session creation
  // and freezes it for the session's lifetime.
  const [skills, setSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  // ----- E.5: Plan mode toggle (in-memory, mirrors main process flag) -----
  const [planMode, setPlanModeState] = useState(false);

  // ----- Dynamic workspace -----
  const [currentCwd, setCurrentCwdState] = useState(null);
  const [cwdIsGlobal, setCwdIsGlobal] = useState(true);
  const [userFileRoot, setUserFileRoot] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  // ----- K2 file tree -----
  const [workspaceTree, setWorkspaceTree] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [recentTouchedFiles, setRecentTouchedFiles] = useState(() => new Map());

  // ----- K2 streaming heartbeat -----
  const [streamingPhase, setStreamingPhase] = useState('idle');
  const [activeToolName, setActiveToolName] = useState(null);
  const [lastEventTimestamp, setLastEventTimestamp] = useState(0);
  const [streamingIdleSeconds, setStreamingIdleSeconds] = useState(0);

  // ----- Refs (per-turn buffers + stable values for the event closure) -----
  const streamBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  const turnThinkingLevelRef = useRef('off');
  const sawThinkingDeltaRef = useRef(false);
  const turnIdRef = useRef(0);
  const taskCallsRef = useRef(new Map());
  const currentCwdRef = useRef(null);
  const sessionIdRef = useRef(null);
  const rehydratedRef = useRef(false);
  // D.2: monotonic counter bumped whenever the user (or our own code)
  // explicitly creates / switches a session — newSession, setCwd, the
  // auto-newSession in rehydrate, openSession, forkSession. The
  // rehydrate IPC callback compares the counter at request time vs.
  // at resolve time and bails out if anything happened in between,
  // preventing the stale main-process snapshot from clobbering a
  // freshly-created session.
  const sessionGenRef = useRef(0);

  useEffect(() => { currentCwdRef.current = currentCwd; }, [currentCwd]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // K2: mark a relPath as recently touched. Defined early so the
  // event handler closure (one big useEffect below) can call it.
  const trackTouchedFile = useCallback((relPath, action) => {
    if (!relPath) return;
    setRecentTouchedFiles((prev) => {
      const next = new Map(prev);
      next.set(relPath, { action, ts: Date.now() });
      return next;
    });
  }, []);

  // K2: prune entries older than 5s every second so the highlight fades.
  useEffect(() => {
    if (recentTouchedFiles.size === 0) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setRecentTouchedFiles((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Map();
        for (const [k, v] of prev) {
          if (now - v.ts > 5000) { changed = true; continue; }
          next.set(k, v);
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [recentTouchedFiles]);

  // K2: drive the 30s idle countdown — only ticks while streaming.
  useEffect(() => {
    if (!streaming) {
      setStreamingIdleSeconds(0);
      return undefined;
    }
    const tick = () => {
      const ts = lastEventTimestamp || Date.now();
      const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      setStreamingIdleSeconds(sec);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [streaming, lastEventTimestamp]);

  // K2: refresh the workspace file tree. Defined here so event
  // handler (agent_end) and setCwd / mount logic can reuse it.
  const loadWorkspaceTree = useCallback(async () => {
    if (typeof window.ipm?.knowclaw?.listWorkspaceTree !== 'function') return;
    setTreeLoading(true);
    try {
      const res = await window.ipm.knowclaw.listWorkspaceTree(null, 3);
      if (res?.ok) {
        setWorkspaceTree(Array.isArray(res.entries) ? res.entries : []);
        setTreeTruncated(Boolean(res.truncated));
      } else {
        setWorkspaceTree([]);
        setTreeTruncated(false);
      }
    } catch {
      setWorkspaceTree([]);
      setTreeTruncated(false);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // -------- D.1: persistent event subscription --------
  //
  // This is the entire reason the Provider exists. The listener is
  // registered exactly ONCE (no dependencies, no remount) so the
  // pi-coding-agent's events keep landing in the renderer regardless
  // of which page the user is currently looking at. Without this, a
  // mid-turn navigation would silently drop every delta until the
  // user reopened the KnowClaw page AND manually opened the session.
  useEffect(() => {
    const off = window.ipm?.knowclaw?.onEvent?.((event) => {
      if (!event || typeof event !== 'object') return;

      // Always remember the latest sessionId (use ref to avoid
      // recreating the listener whenever sessionId changes).
      if (event.sessionId && event.sessionId !== sessionIdRef.current) {
        setSessionId(event.sessionId);
      }

      // K2: every event resets the idle timer.
      setLastEventTimestamp(Date.now());

      switch (event.type) {
        case 'agent_start': {
          setMessages((prev) => ensureStreamingMessage(prev));
          setStreamingPhase('thinking');
          setActiveToolName(null);
          break;
        }

        case 'message_update': {
          const sub = event.assistantMessageEvent;
          if (!sub) break;
          if (sub.type === 'text_start') {
            setMessages((prev) => ensureStreamingMessage(prev));
          } else if (sub.type === 'text_delta') {
            const delta = sub.delta || '';
            if (!delta) break;
            streamBufferRef.current += delta;
            setStreamingPhase('writing');
            setMessages((prev) => {
              const updated = ensureStreamingMessage(prev);
              const last = updated[updated.length - 1];
              return [
                ...updated.slice(0, -1),
                { ...last, content: streamBufferRef.current },
              ];
            });
          } else if (sub.type === 'thinking_delta') {
            const delta = sub.delta || '';
            if (!delta) break;
            sawThinkingDeltaRef.current = true;
            setStreamingPhase('thinking');
            setThinkingHint('none');
            thinkingBufferRef.current += delta;
            setMessages((prev) => {
              const updated = ensureStreamingMessage(prev);
              const last = updated[updated.length - 1];
              return [
                ...updated.slice(0, -1),
                { ...last, thinking: thinkingBufferRef.current },
              ];
            });
          }
          break;
        }

        case 'tool_execution_start': {
          const toolCallId = event.toolCallId || `${event.toolName || 'tool'}-${Date.now()}`;
          const name = event.toolName || 'tool';
          const summary = summarizeToolArgs(name, event.args);
          setStreamingPhase('tool');
          setActiveToolName(name);
          try {
            const touched = extractTouchedFilesFromEvent(event);
            if (touched.length > 0) {
              const cwd = currentCwdRef.current;
              for (const t of touched) {
                const rel = toRelPosix(cwd, t.path) ?? t.path;
                if (rel) trackTouchedFile(rel, t.action);
              }
            }
          } catch { /* best-effort */ }
          if (name === 'task_manager') {
            const args = event.args && typeof event.args === 'object' ? event.args : null;
            const normalized = normalizeTasksArray(args?.tasks);
            taskCallsRef.current.set(toolCallId, { tasks: normalized, ts: Date.now() });
          }
          setMessages((prev) => {
            const updated = ensureStreamingMessage(prev);
            const last = updated[updated.length - 1];
            const exists = last.tools?.some((t) => t.toolCallId === toolCallId);
            if (exists) return updated;
            return [
              ...updated.slice(0, -1),
              {
                ...last,
                tools: [
                  ...(last.tools || []),
                  {
                    name,
                    toolCallId,
                    status: 'running',
                    summary,
                    args: event.args && typeof event.args === 'object' ? event.args : undefined,
                    startTime: Date.now(),
                  },
                ],
              },
            ];
          });
          break;
        }

        case 'tool_execution_update': {
          const toolCallId = event.toolCallId;
          if (!toolCallId) break;
          let nextText = '';
          const partial = event.partialResult;
          if (partial && Array.isArray(partial.content)) {
            for (const block of partial.content) {
              if (block && typeof block === 'object' && typeof block.text === 'string') {
                nextText += block.text;
              }
            }
          }
          setMessages((prev) =>
            updateToolByCallId(prev, toolCallId, { streamingStdout: nextText }),
          );
          break;
        }

        case 'tool_execution_end': {
          const toolCallId = event.toolCallId;
          if (!toolCallId) break;
          const result = stringifyResult(event.result);
          const status = event.isError ? 'error' : 'done';
          setStreamingPhase('thinking');
          setActiveToolName(null);
          setMessages((prev) =>
            updateToolByCallId(prev, toolCallId, {
              status,
              result,
              streamingStdout: undefined,
              endTime: Date.now(),
            }),
          );
          if (event.toolName === 'task_manager') {
            const snapshot = taskCallsRef.current.get(toolCallId);
            taskCallsRef.current.delete(toolCallId);
            if (snapshot && !event.isError) {
              setMessages((prev) => [
                ...prev,
                {
                  role: 'system',
                  kind: 'tasks',
                  tasks: snapshot.tasks,
                  ts: snapshot.ts,
                },
              ]);
            }
          }
          break;
        }

        case 'agent_end': {
          const finalText = streamBufferRef.current;
          const finalThinking = thinkingBufferRef.current;
          streamBufferRef.current = '';
          thinkingBufferRef.current = '';
          setStreaming(false);
          setStreamingPhase('idle');
          setActiveToolName(null);
          setStreamingIdleSeconds(0);
          // Defer one tick — pi sometimes emits agent_end before its
          // last child write hits disk on Windows.
          setTimeout(() => { void loadWorkspaceTree(); }, 250);

          const turnLevel = turnThinkingLevelRef.current;
          if (turnLevel && turnLevel !== 'off') {
            if (sawThinkingDeltaRef.current) {
              setThinkingHint('none');
            } else {
              setThinkingHint('no-content');
            }
          }
          sawThinkingDeltaRef.current = false;

          setMessages((prev) => {
            // First: close out the still-streaming assistant bubble
            // (if any). This mirrors the pre-D.5 behaviour: empty
            // turns with no text / thinking / tools get dropped, real
            // turns flip `streaming: false`.
            let next = prev;
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              if (!finalText && !finalThinking && (!last.tools || last.tools.length === 0)) {
                next = prev.slice(0, -1);
              } else {
                next = [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    content: finalText || last.content,
                    thinking: finalThinking || last.thinking || '',
                    streaming: false,
                  },
                ];
              }
            }
            // D.5: when the turn ends, any task still marked
            // `in_progress` in the latest snapshot is stale — the LLM
            // either skipped a final `task_manager` call or aborted
            // mid-step. Downgrade those rows to `pending` (gray
            // circle, no spinner) so the card stops misleading the
            // user that work is still ongoing. Only the LAST tasks
            // bubble is patched — older snapshots already collapse
            // into a summary row via the renderer.
            for (let i = next.length - 1; i >= 0; i -= 1) {
              const m = next[i];
              if (m?.kind !== 'tasks') continue;
              const tasks = Array.isArray(m.tasks) ? m.tasks : null;
              if (!tasks) break;
              const hasInProgress = tasks.some((t) => t?.status === 'in_progress');
              if (!hasInProgress) break;
              const patched = tasks.map((t) =>
                t?.status === 'in_progress' ? { ...t, status: 'pending' } : t,
              );
              next = [
                ...next.slice(0, i),
                { ...m, tasks: patched },
                ...next.slice(i + 1),
              ];
              break;
            }
            return next;
          });
          break;
        }

        case 'error': {
          const errText = event.error || event.message || '未知错误';
          streamBufferRef.current = '';
          thinkingBufferRef.current = '';
          sawThinkingDeltaRef.current = false;
          setStreaming(false);
          setStreamingPhase('idle');
          setActiveToolName(null);
          setStreamingIdleSeconds(0);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const sys = { role: 'system', content: `KnowClaw 错误: ${errText}`, ts: Date.now() };
            if (last?.role === 'assistant' && last?.streaming && !last.content && !last.thinking && (!last.tools || last.tools.length === 0)) {
              return [...prev.slice(0, -1), sys];
            }
            return [...prev, sys];
          });
          break;
        }

        case 'history_loaded': {
          streamBufferRef.current = '';
          setStreaming(false);
          const restored = Array.isArray(event.messages) ? event.messages : [];
          taskCallsRef.current.clear();
          const restoredTasks = Array.isArray(event.tasks) ? event.tasks : null;
          if (restoredTasks && restoredTasks.length > 0) {
            restored.push({
              role: 'system',
              kind: 'tasks',
              tasks: restoredTasks,
              ts: Date.now(),
            });
          }
          setMessages(restored);
          if (event.sessionFile) setCurrentSessionFile(event.sessionFile);
          setPendingSteer([]);
          setPendingFollowUp([]);
          break;
        }

        case 'queue_update': {
          setPendingSteer(Array.isArray(event.steering) ? event.steering : []);
          setPendingFollowUp(Array.isArray(event.followUp) ? event.followUp : []);
          break;
        }

        case 'compaction_start': {
          setCompacting(true);
          setCompactionReason(event.reason || null);
          break;
        }

        case 'compaction_end': {
          setCompacting(false);
          setCompactionReason(null);
          (async () => {
            try {
              const res = await window.ipm?.knowclaw?.getStatus?.();
              if (res?.ok && res.contextUsage !== undefined) {
                setContextUsage(res.contextUsage);
              }
            } catch { /* ignore */ }
          })();
          if (event.errorMessage && !event.aborted) {
            setMessages((prev) => [
              ...prev,
              { role: 'system', content: `上下文压缩失败: ${event.errorMessage}`, ts: Date.now() },
            ]);
          }
          break;
        }

        case 'auto_retry_start': {
          setRetrying({
            attempt: Number(event.attempt) || 0,
            maxAttempts: Number(event.maxAttempts) || 0,
            delayMs: Number(event.delayMs) || 0,
          });
          break;
        }

        case 'auto_retry_end': {
          setRetrying(null);
          if (event.success === false && event.finalError) {
            setMessages((prev) => [
              ...prev,
              { role: 'system', content: `自动重试失败 (第 ${event.attempt || '?'} 次): ${event.finalError}`, ts: Date.now() },
            ]);
          }
          break;
        }

        default:
          // Ignored: turn_start, turn_end, message_start, message_end, thinking_*.
          break;
      }
    });

    return () => { off?.(); };
    // No dependencies — listener lives for the entire renderer lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- D.1: persistent install-confirmation listener --------
  //
  // Same lifecycle as the event listener above — registered once and
  // never torn down. If the user navigated away mid-confirmation,
  // they can still reach the confirm dialog from any page (because
  // the Provider lives at App level, above the page conditional).
  useEffect(() => {
    if (!window.ipm?.knowclaw?.onConfirmInstall) return undefined;
    const off = window.ipm.knowclaw.onConfirmInstall(async (data) => {
      if (!data || typeof data !== 'object') return;
      const requestId = String(data.requestId || '');
      if (!requestId) return;
      const manager = String(data.manager || '依赖');
      const packages = Array.isArray(data.packages) ? data.packages.filter(Boolean) : [];
      const command = String(data.command || '');
      const cwd = String(data.cwd || '');
      const pkgPreview = packages.length > 0
        ? packages.join('  ·  ')
        : '(参见命令)';
      const message =
        `KnowClaw 想通过 ${manager} 安装依赖：\n  ${pkgPreview}\n\n` +
        `完整命令：\n  ${command}\n\n` +
        `工作目录：${cwd || '(未知)'}\n\n` +
        '如果你信任这些包，点「允许并安装」。如果你不熟悉它们或路径异常，请选「拒绝」并自行处理。';
      let allowed = false;
      try {
        allowed = await confirm({
          title: '允许安装依赖？',
          message,
          confirmLabel: '允许并安装',
          cancelLabel: '拒绝',
          danger: false,
        });
      } catch {
        allowed = false;
      }
      try {
        await window.ipm.knowclaw.replyConfirmInstall(requestId, allowed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[KnowClaw] replyConfirmInstall failed:', err?.message || err);
      }
    });
    return () => { off?.(); };
  }, [confirm]);

  // -------- Actions (lifted from the original hook verbatim) --------

  const enqueueDuringStream = useCallback(async (text, kind, images = []) => {
    const trimmed = String(text || '').trim();
    const imageList = Array.isArray(images) ? images : [];
    if (!trimmed && imageList.length === 0) return { ok: false, error: 'empty message' };
    const optimisticTs = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: trimmed,
        kind,
        ts: optimisticTs,
        ...(imageList.length > 0 ? { attachments: imageList } : {}),
      },
    ]);
    try {
      const ipc = kind === 'steer'
        ? window.ipm?.knowclaw?.steer
        : window.ipm?.knowclaw?.followUp;
      const res = await ipc?.(trimmed, imageList.length > 0 ? imageList : undefined);
      if (!res?.ok) {
        const errText = res?.error || (kind === 'steer' ? '打断失败' : '追问失败');
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.role === 'user' && m.kind === kind && m.ts === optimisticTs);
          if (idx < 0) {
            return [...prev, { role: 'system', content: `KnowClaw: ${errText}`, ts: Date.now() }];
          }
          return [
            ...prev.slice(0, idx),
            { role: 'system', content: `KnowClaw: ${errText}（消息内容：${trimmed}）`, ts: Date.now() },
            ...prev.slice(idx + 1),
          ];
        });
      }
      return res || { ok: false };
    } catch (err) {
      const errText = err?.message || String(err);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.role === 'user' && m.kind === kind && m.ts === optimisticTs);
        if (idx < 0) {
          return [...prev, { role: 'system', content: `KnowClaw: ${errText}`, ts: Date.now() }];
        }
        return [
          ...prev.slice(0, idx),
          { role: 'system', content: `KnowClaw: ${errText}（消息内容：${trimmed}）`, ts: Date.now() },
          ...prev.slice(idx + 1),
        ];
      });
      return { ok: false, error: errText };
    }
  }, []);

  const steerMessage = useCallback(
    (text, images) => enqueueDuringStream(text, 'steer', images),
    [enqueueDuringStream],
  );
  const followUpMessage = useCallback(
    (text, images) => enqueueDuringStream(text, 'followUp', images),
    [enqueueDuringStream],
  );

  const clearQueueAction = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclaw?.clearQueue?.();
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  const compactSession = useCallback(async (customInstructions) => {
    try {
      const res = await window.ipm?.knowclaw?.compact?.(customInstructions);
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  const sendMessage = useCallback(async (text, images, pinnedSkills) => {
    const trimmed = String(text || '').trim();
    const imageList = Array.isArray(images) ? images : [];
    // Skill Selector: normalize the optional pinned-skill names list.
    // Empty / non-array inputs collapse to `undefined` so downstream
    // calls keep the same shape as before for unrelated callers.
    const skillNames = Array.isArray(pinnedSkills)
      ? pinnedSkills.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())
      : [];
    const skillsPayload = skillNames.length > 0 ? skillNames : undefined;
    if (!trimmed && imageList.length === 0) return;
    if (streaming) {
      if (streamingMode === 'steer') {
        // E.7: queue-mode steer/followUp also gets the @ref expansion
        // — the LLM behaves the same way regardless of how the text
        // was queued. Skill pinning is intentionally NOT forwarded to
        // steer/followUp because the active session's tool surface is
        // already frozen; injecting SKILL.md mid-turn would surprise
        // both the user and the model.
        await steerMessage(expandFileRefsForLlm(trimmed), imageList);
      } else {
        await followUpMessage(expandFileRefsForLlm(trimmed), imageList);
      }
      return;
    }

    turnIdRef.current += 1;
    streamBufferRef.current = '';
    thinkingBufferRef.current = '';
    turnThinkingLevelRef.current = thinkingLevel;
    sawThinkingDeltaRef.current = false;
    setThinkingHint('none');
    setStreaming(true);

    setMessages((prev) => [
      ...prev,
      {
        // E.7: keep the user-visible bubble exactly as typed (with the
        // `@relPath` syntax). The expansion below is appended only to
        // the IPC payload so the LLM sees a structured "read these
        // files" hint without polluting the chat transcript.
        //
        // Skill Selector: also record the pinned skill names on the
        // user message so the bubble can show a small chip strip ("已附带
        // SKILL.md") next to it. The actual SKILL.md content is injected
        // server-side and does NOT live on this message object.
        role: 'user',
        content: trimmed,
        ts: Date.now(),
        ...(imageList.length > 0 ? { attachments: imageList } : {}),
        ...(skillsPayload ? { pinnedSkills: skillsPayload } : {}),
      },
      { role: 'assistant', content: '', thinking: '', streaming: true, tools: [], ts: Date.now() },
    ]);

    try {
      const expanded = expandFileRefsForLlm(trimmed);
      const res = await window.ipm?.knowclaw?.send?.(
        expanded,
        imageList.length > 0 ? imageList : undefined,
        skillsPayload,
      );
      if (res?.sessionId) setSessionId(res.sessionId);
      if (!res?.ok) {
        const errText = res?.error || '发送失败';
        streamBufferRef.current = '';
        thinkingBufferRef.current = '';
        setStreaming(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const sys = { role: 'system', content: `错误: ${errText}`, ts: Date.now() };
          if (last?.streaming) return [...prev.slice(0, -1), sys];
          return [...prev, sys];
        });
      }
    } catch (err) {
      streamBufferRef.current = '';
      thinkingBufferRef.current = '';
      setStreaming(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const sys = { role: 'system', content: `发送失败: ${err?.message || err}`, ts: Date.now() };
        if (last?.streaming) return [...prev.slice(0, -1), sys];
        return [...prev, sys];
      });
    }
  }, [streaming, streamingMode, thinkingLevel, steerMessage, followUpMessage]);

  const abort = useCallback(async () => {
    try {
      await window.ipm?.knowclaw?.abort?.();
    } catch { /* ignore */ }
    thinkingBufferRef.current = '';
    sawThinkingDeltaRef.current = false;
    setStreaming(false);
    setStreamingPhase('idle');
    setActiveToolName(null);
    setStreamingIdleSeconds(0);
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    // E.5 stability: when the user clicks Stop while an ask_user is
    // still pending, the main process's abort-signal listener resolves
    // the IPC Promise with `{ aborted: true }`, the tool returns a
    // "被中断" textResult, and the agent loop tears down. But the
    // AskUserCard on screen would otherwise stay in its pending state
    // forever — the renderer never gets an explicit reply event,
    // because there's nothing for it to be the reply *to* anymore.
    // We freeze every still-pending card as cancelled so the UI
    // matches reality: the model isn't waiting on it any more.
    setMessages((prev) => prev.map((m) =>
      m.kind === 'ask_user' && !m.answered
        ? { ...m, answered: true, cancelled: true }
        : m,
    ));
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await window.ipm?.knowclaw?.listSessions?.();
      if (res?.ok && Array.isArray(res.sessions)) {
        setSessions(res.sessions);
      } else {
        setSessions([]);
      }
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const newSession = useCallback(async () => {
    // D.2: bump the generation counter BEFORE the IPC so an in-flight
    // rehydrate that resolves after us won't restore the disposed
    // session's transcript on top of the fresh one.
    sessionGenRef.current += 1;
    let res = null;
    let threw = null;
    try {
      res = await window.ipm?.knowclaw?.newSession?.();
    } catch (err) {
      threw = err;
    }
    if (res?.ok) {
      if (res.sessionId) setSessionId(res.sessionId);
      else setSessionId(null);
      if (res.sessionFile) setCurrentSessionFile(res.sessionFile);
      else setCurrentSessionFile(null);
      // D.3: optimistic insert into the sessions list.
      //
      // pi's SessionManager lazily persists the JSONL — it only
      // writes header + entries to disk after the FIRST assistant
      // message arrives (see SessionManager._persist's
      // `hasAssistant` guard). That means `refreshSessions` (which
      // scans the directory) will return the same list as before
      // for the entire pre-first-turn window. The user clicked
      // "新对话", header flipped to a new sessionId, but the side
      // panel still shows the old session as active — extremely
      // confusing.
      //
      // Mitigation: synthesize a placeholder row from the IPC
      // result and prepend it. `messageCount: 0` + empty
      // firstMessage means SessionPanel will render it as
      // "(无内容)", and `path === currentSessionFile` gives it the
      // amber active highlight. After the first turn finishes,
      // the `wasStreamingRef` effect calls `refreshSessions`,
      // which then returns the now-flushed real entry — list
      // dedupes by path so the row updates in place rather than
      // duplicating.
      if (res.sessionFile && res.sessionId) {
        setSessions((prev) => {
          if (prev.some((s) => s.path === res.sessionFile)) return prev;
          return [
            {
              path: res.sessionFile,
              id: res.sessionId,
              cwd: currentCwdRef.current || '',
              name: null,
              created: Date.now(),
              modified: Date.now(),
              messageCount: 0,
              firstMessage: '',
            },
            ...prev,
          ];
        });
      }
    } else {
      // D.2: clear sessionId/sessionFile unconditionally on failure.
      // Previously we kept the old sessionId, which combined with
      // the dispose-then-create flow in the main process meant the
      // next `send` would happily continueRecent an unrelated old
      // session — this is the exact pathology described in the bug
      // report.
      setSessionId(null);
      setCurrentSessionFile(null);
      const errMsg = threw
        ? String(threw?.message || threw)
        : (res?.skipped ? '未配置 LLM 或没有可用模型' : (res?.error || '未知错误'));
      showToast(`新建会话失败: ${errMsg}`, 'error');
    }
    streamBufferRef.current = '';
    setMessages([]);
    setStreaming(false);
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    setContextUsage(null);
    setSessionStats(null);
    setCompacting(false);
    setCompactionReason(null);
    setRetrying(null);
    setRecentTouchedFiles(new Map());
    setStreamingPhase('idle');
    setActiveToolName(null);
    setStreamingIdleSeconds(0);
    void refreshSessions();
    return res || { ok: false, error: threw ? String(threw?.message || threw) : 'unknown' };
  }, [refreshSessions, showToast]);

  const openSession = useCallback(async (sessionFile) => {
    if (!sessionFile) return { ok: false, error: 'sessionFile is required' };
    if (streaming) {
      try { await window.ipm?.knowclaw?.abort?.(); } catch { /* ignore */ }
    }
    // D.2: bump generation so a slow rehydrate from another navigation
    // doesn't restore the prior session on top of the one we're about
    // to open.
    sessionGenRef.current += 1;
    streamBufferRef.current = '';
    setStreaming(false);
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    setContextUsage(null);
    setSessionStats(null);
    setCompacting(false);
    setCompactionReason(null);
    setRetrying(null);
    try {
      const res = await window.ipm?.knowclaw?.openSession?.(sessionFile);
      if (res?.ok) {
        if (res.sessionId) setSessionId(res.sessionId);
        if (res.sessionFile) setCurrentSessionFile(res.sessionFile);
        if (typeof res.isGlobal === 'boolean') {
          setCwdIsGlobal(res.isGlobal);
          setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
        }
        void refreshSessions();
        // E.6: history sessions carry their own contextUsage / sessionStats,
        // but openSession's IPC response doesn't include them. Without this
        // refresh the ContextPill / TokenPill would stay null until the next
        // streaming turn or polling tick — making the header look like the
        // re-opened session had zero stats. refreshStatus also syncs
        // planMode / subAgentEnabled / cwd in one shot, so we get the full
        // re-hydration the user expects when switching sessions.
        //
        // NOTE: refreshStatus is declared later in this component (TDZ
        // hazard if placed in the dep array — same pattern as
        // `startExecuting` documented below). Calling it inside the
        // callback body is safe because the body executes at click
        // time, long after the component has finished initialization.
        // refreshStatus itself is a stable useCallback with `[]` deps,
        // so omitting it from this dep array doesn't risk staleness.
        void refreshStatus();
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, refreshSessions]);

  const deleteSession = useCallback(async (sessionFile) => {
    if (!sessionFile) return { ok: false, error: 'sessionFile is required' };
    try {
      const res = await window.ipm?.knowclaw?.deleteSession?.(sessionFile);
      if (res?.ok) {
        if (res.wasActive) {
          // D.2: the main process auto-created a fresh blank session
          // for us (see knowclaw.js deleteSession handler). Reset
          // the renderer state and adopt the returned sessionId so
          // the header pill flips to the new session in one frame —
          // no extra newSession IPC round-trip needed.
          sessionGenRef.current += 1;
          streamBufferRef.current = '';
          thinkingBufferRef.current = '';
          setMessages([]);
          setStreaming(false);
          setPendingSteer([]);
          setPendingFollowUp([]);
          setStreamingMode('followUp');
          setContextUsage(null);
          setSessionStats(null);
          setCompacting(false);
          setCompactionReason(null);
          setRetrying(null);
          setRecentTouchedFiles(new Map());
          setStreamingPhase('idle');
          setActiveToolName(null);
          setStreamingIdleSeconds(0);
          if (res.nextSessionId) setSessionId(res.nextSessionId);
          else setSessionId(null);
          if (res.nextSessionFile) setCurrentSessionFile(res.nextSessionFile);
          else setCurrentSessionFile(null);
          if (res.nextError) {
            showToast(`删除后新建会话失败: ${res.nextError}`, 'error');
          }
        }
        await refreshSessions();
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [refreshSessions, showToast]);

  const forkSession = useCallback(async (sessionFile, entryIndex) => {
    if (!sessionFile) return { ok: false, error: 'sessionFile is required' };
    if (streaming) {
      try { await window.ipm?.knowclaw?.abort?.(); } catch { /* ignore */ }
    }
    // D.2: bump generation for the same reason as openSession.
    sessionGenRef.current += 1;
    streamBufferRef.current = '';
    setStreaming(false);
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    setContextUsage(null);
    setSessionStats(null);
    setCompacting(false);
    setCompactionReason(null);
    setRetrying(null);
    try {
      const res = await window.ipm?.knowclaw?.forkSession?.(sessionFile, entryIndex);
      if (res?.ok) {
        if (res.sessionId) setSessionId(res.sessionId);
        if (res.sessionFile) setCurrentSessionFile(res.sessionFile);
        await refreshSessions();
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [refreshSessions, streaming]);

  const loadModels = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclaw?.listModels?.();
      if (res?.ok && Array.isArray(res.models)) {
        setModels(res.models);
        setCurrentModel((prev) => {
          if (prev && res.models.some((m) => `${m.provider}/${m.id}` === prev)) {
            return prev;
          }
          const def = res.models.find((m) => m.isDefault) || res.models[0];
          return def ? `${def.provider}/${def.id}` : null;
        });
      }
    } catch { /* ignore */ }
  }, []);

  const setModel = useCallback(async (providerId, modelId) => {
    try {
      const res = await window.ipm?.knowclaw?.setModel?.(providerId, modelId);
      if (res?.ok) {
        setCurrentModel(`${providerId}/${modelId}`);
        await newSession();
      }
      return res;
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [newSession]);

  const changeThinkingLevel = useCallback(async (level) => {
    setThinkingLevelState(level);
    setThinkingHint('none');
    try {
      const res = await window.ipm?.knowclaw?.setThinkingLevel?.(level);
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  const dismissThinkingHint = useCallback(() => {
    setThinkingHint('none');
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclaw?.getStatus?.();
      if (res?.ok) {
        if (res.thinkingLevel) setThinkingLevelState(res.thinkingLevel);
        if (typeof res.apiMode === 'string' || res.apiMode === null) {
          setApiMode(res.apiMode || null);
        }
        if (typeof res.userFileRoot === 'string') {
          setUserFileRoot(res.userFileRoot);
        }
        if (typeof res.isGlobal === 'boolean') {
          setCwdIsGlobal(res.isGlobal);
          setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
        }
        if (typeof res.bashAvailable === 'boolean') {
          setBashAvailable(res.bashAvailable);
        }
        if (res.bashShell && typeof res.bashShell === 'object') {
          if (typeof res.bashShell.available === 'boolean') {
            setBashAvailable(res.bashShell.available);
          }
          if (typeof res.bashShell.source === 'string' || res.bashShell.source === null) {
            setBashSource(res.bashShell.source);
          }
        }
        if (res.contextUsage !== undefined) {
          setContextUsage(res.contextUsage);
        }
        if (res.sessionStats !== undefined) {
          setSessionStats(res.sessionStats);
        }
        if (typeof res.isCompacting === 'boolean') {
          setCompacting(res.isCompacting);
        }
        if (typeof res.subAgentEnabled === 'boolean') {
          setSubAgentEnabledState(res.subAgentEnabled);
        }
        // E.5: keep PlanModeToggle in sync with main on every refresh,
        // so toggles that happen outside this hook (e.g. internal
        // startExecuting flow) flow back into the UI.
        if (typeof res.planMode === 'boolean') {
          setPlanModeState(res.planMode);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // AI 配置保存后无需重启应用：prefs IPC 会广播 prefs:updated，这里重新
  // 拉取 KnowClaw 可用模型。如果当前选择已经不在新配置中，loadModels()
  // 会自动落到新默认模型。模型能力（例如图片输入）绑定在 pi 会话创建时，
  // 因此空闲的既有会话会自动重建；运行中的会话不被强制中断。
  useEffect(() => {
    const unsubscribe = window.ipm?.prefs?.onUpdated?.((payload) => {
      const keys = Array.isArray(payload?.changedKeys) ? payload.changedKeys : [];
      if (!keys.includes('ai') && !keys.includes('llm')) return;
      void loadModels();
      void refreshStatus();
      if (!streaming && sessionIdRef.current) {
        void newSession();
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [loadModels, newSession, refreshStatus, streaming]);

  const toggleSubAgent = useCallback(async (enabled) => {
    const next = Boolean(enabled);
    setSubAgentEnabledState(next);
    try {
      const res = await window.ipm?.knowclaw?.setSubAgentEnabled?.(next);
      if (!res?.ok) {
        setSubAgentEnabledState(!next);
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `子代理开关切换失败: ${res?.error || '未知错误'}`, ts: Date.now() },
        ]);
        return res || { ok: false };
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: next
            ? '子代理已启用：下次新对话起，主模型可调用 delegate_task 委托子任务。'
            : '子代理已禁用：下次新对话起，模型将不再看到 delegate_task 工具。当前对话不受影响。',
          ts: Date.now(),
        },
      ]);
      return res;
    } catch (err) {
      setSubAgentEnabledState(!next);
      const errText = String(err?.message || err);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `子代理开关切换失败: ${errText}`, ts: Date.now() },
      ]);
      return { ok: false, error: errText };
    }
  }, []);

  // ---- E.5: Plan-mode actions ----
  // setPlanMode flips both UI state (optimistic) and main process flag.
  // The flag takes effect on the NEXT prompt/steer/followUp via the
  // [MODE: plan] tag injection in knowclaw.js. We also push a system
  // bubble so the user sees the mode boundary in the transcript.
  const setPlanMode = useCallback(async (enabled) => {
    const next = Boolean(enabled);
    setPlanModeState(next);
    try {
      const res = await window.ipm?.knowclaw?.setPlanMode?.(next);
      if (!res?.ok) {
        setPlanModeState(!next);
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `模式切换失败: ${res?.error || '未知错误'}`, ts: Date.now() },
        ]);
        return res || { ok: false };
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: next
            ? '已切换到 Plan 模式：仅使用只读工具收集信息、用 ask_user 澄清需求、用 save_plan 输出方案；不会执行任何写入操作。'
            : '已切换到 Agent 模式：可执行所有工具。如需按已有方案执行，请在下条消息中说明。',
          ts: Date.now(),
        },
      ]);
      return res;
    } catch (err) {
      setPlanModeState(!next);
      const errText = String(err?.message || err);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `模式切换失败: ${errText}`, ts: Date.now() },
      ]);
      return { ok: false, error: errText };
    }
  }, []);

  // ---- SK1: skill management actions ----
  //
  // All three actions follow the same pattern as `toggleSubAgent`:
  //   1. Optimistic local-state update so the UI feels instant.
  //   2. IPC roundtrip to the main process.
  //   3. On failure: revert the local state + push a system bubble.
  //   4. On success: push a system bubble explaining the new-session
  //      semantics (skill changes take effect on the next session,
  //      identical to the sub-agent kill-switch — see § SK0 in the
  //      Skill System plan).
  //
  // `loadSkills` is a plain refresh (no optimistic update needed).
  // It's called by the page when the skill panel mounts, and by
  // the panel's refresh button.

  // SK4: optional `cwd` arg makes the main process include
  // `<cwd>/.knowclaw/skills/` in the scan, so workspace-scoped skills
  // show up in the panel. Pass null / undefined / '' for global mode.
  const loadSkills = useCallback(async (cwd) => {
    if (!window.ipm?.skills?.list) return { ok: false, error: 'skills IPC unavailable' };
    setSkillsLoading(true);
    try {
      const res = await window.ipm.skills.list({ cwd: cwd || undefined });
      if (res?.ok) {
        setSkills(Array.isArray(res.skills) ? res.skills : []);
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const toggleSkill = useCallback(async (name, enabled) => {
    const targetName = String(name || '');
    if (!targetName) return { ok: false, error: 'name is required' };
    const next = Boolean(enabled);
    // Optimistic: flip the entry in-place. Note we do NOT pre-load the
    // panel if it hasn't been opened yet — callers always come from
    // the panel, which has already populated `skills` via `loadSkills`.
    setSkills((prev) => prev.map((s) =>
      s.name === targetName ? { ...s, enabled: next } : s
    ));
    try {
      const res = await window.ipm?.skills?.toggle?.(targetName, next);
      if (!res?.ok) {
        // Revert
        setSkills((prev) => prev.map((s) =>
          s.name === targetName ? { ...s, enabled: !next } : s
        ));
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `技能开关切换失败: ${res?.error || '未知错误'}`, ts: Date.now() },
        ]);
        return res || { ok: false };
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: next
            ? `技能「${targetName}」已启用：下次新对话起，主模型可看到该技能。`
            : `技能「${targetName}」已禁用：下次新对话起，主模型将不再看到该技能。当前对话不受影响。`,
          ts: Date.now(),
        },
      ]);
      return res;
    } catch (err) {
      setSkills((prev) => prev.map((s) =>
        s.name === targetName ? { ...s, enabled: !next } : s
      ));
      const errText = String(err?.message || err);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `技能开关切换失败: ${errText}`, ts: Date.now() },
      ]);
      return { ok: false, error: errText };
    }
  }, []);

  // SK2: import a skill from an external directory. Mirrors
  // `deleteSkill` shape — no optimistic update (we don't know the
  // final skill name until the IPC returns) and we lean on the
  // returned `skill.name` to push the system bubble.
  //
  // The caller (ImportSkillModal) is responsible for the conflict
  // dance: when the IPC returns `{ ok: false, conflict: 'exists' }`,
  // the modal shows its three-way picker (overwrite / rename / cancel)
  // and re-invokes this action with the appropriate `opts`. We do NOT
  // swallow the conflict response here — we just forward it so the
  // modal has full control over the UX.
  const importSkill = useCallback(async (srcDir, opts) => {
    const dir = typeof srcDir === 'string' ? srcDir : '';
    if (!dir) return { ok: false, error: 'srcDir is required' };
    try {
      const res = await window.ipm?.skills?.import?.(dir, opts);
      if (!res?.ok) {
        // Only surface a system bubble for terminal errors. Conflict
        // responses are NOT errors from the user's POV — they're a
        // forked path the modal handles inline.
        if (res && res.conflict) return res;
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `技能导入失败: ${res?.error || '未知错误'}`,
            ts: Date.now(),
          },
        ]);
        return res || { ok: false };
      }
      // Success path: refresh the panel list + push a system bubble.
      // `loadSkills` is awaited so the panel sees the new entry before
      // the modal closes (avoids a "blink" where the modal goes away
      // but the list hasn't caught up).
      //
      // SK4: forward the caller-supplied cwd so a post-import refresh
      // doesn't accidentally drop workspace-scoped skills from the
      // list. Import always lands in the user root, but the refresh
      // needs to see everything the panel was showing pre-import.
      await loadSkills(opts?.cwd || undefined);
      const importedName = res?.skill?.name || '(unknown)';
      const renameNote = res?.renamed ? '（已重命名）' : '';
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `技能「${importedName}」已导入${renameNote}：下次新对话起生效。`,
          ts: Date.now(),
        },
      ]);
      return res;
    } catch (err) {
      const errText = String(err?.message || err);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `技能导入失败: ${errText}`, ts: Date.now() },
      ]);
      return { ok: false, error: errText };
    }
  }, [loadSkills]);

  // SK2: scan external tool roots (Claude Code / Cursor) for importable
  // skills. Thin passthrough — the modal owns the UI for displaying
  // results, applying filters, and triggering per-skill imports.
  const scanExternalSkills = useCallback(async () => {
    try {
      const res = await window.ipm?.skills?.scanExternal?.();
      return res || { ok: false, sources: [], error: 'skills IPC unavailable' };
    } catch (err) {
      return { ok: false, sources: [], error: String(err?.message || err) };
    }
  }, []);

  // SK2: native folder picker thin passthrough. Returns the parsed
  // preview straight from main.
  const chooseSkillDir = useCallback(async () => {
    try {
      const res = await window.ipm?.skills?.chooseDir?.();
      return res || { ok: false, error: 'skills IPC unavailable' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  // SK4: `opts.cwd` lets the main process resolve workspace-root
  // candidates; `opts.scope` ('workspace' | 'user') pins the deletion
  // when both copies share a name. Default policy (no scope) is
  // workspace-wins-if-present. Most callers should pass `scope` derived
  // from the skill's `source` to be explicit.
  const deleteSkill = useCallback(async (name, opts) => {
    const targetName = String(name || '');
    if (!targetName) return { ok: false, error: 'name is required' };
    try {
      const res = await window.ipm?.skills?.delete?.(targetName, {
        cwd: opts?.cwd || undefined,
        scope: opts?.scope || undefined,
      });
      if (!res?.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `技能删除失败: ${res?.error || '未知错误'}`, ts: Date.now() },
        ]);
        return res || { ok: false };
      }
      // Drop from local list on success (or if main reports the skill
      // was already missing — same effect from the user's POV).
      setSkills((prev) => prev.filter((s) => s.name !== targetName));
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `技能「${targetName}」已删除：下次新对话起生效。当前对话不受影响。`,
          ts: Date.now(),
        },
      ]);
      return res;
    } catch (err) {
      const errText = String(err?.message || err);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `技能删除失败: ${errText}`, ts: Date.now() },
      ]);
      return { ok: false, error: errText };
    }
  }, []);

  // ---- E.5: ask_user push-event subscription ----
  // When the model calls the ask_user tool, main process pushes
  // `knowclaw:askUser` to the renderer. We inject a special bubble
  // (`kind: 'ask_user'`) into the transcript so MessageBubble can render
  // it as an AskUserCard inline with the conversation. The card calls
  // replyAskUser when the user submits, which closes the IPC roundtrip
  // and unblocks the waiting tool.
  useEffect(() => {
    if (!window.ipm?.knowclaw?.onAskUser) return undefined;
    const off = window.ipm.knowclaw.onAskUser((data) => {
      if (!data?.requestId || !Array.isArray(data?.questions)) return;
      setMessages((prev) => [
        ...prev,
        {
          kind: 'ask_user',
          requestId: data.requestId,
          questions: data.questions,
          answered: false,
          ts: Date.now(),
        },
      ]);
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  const replyAskUser = useCallback(async (requestId, answers) => {
    if (!requestId) return { ok: false, error: 'missing requestId' };
    try {
      const res = await window.ipm?.knowclaw?.replyAskUser?.(requestId, answers);
      setMessages((prev) => prev.map((m) =>
        m.kind === 'ask_user' && m.requestId === requestId
          ? { ...m, answered: true, answers }
          : m,
      ));
      return res || { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  const cancelAskUser = useCallback(async (requestId) => {
    if (!requestId) return { ok: false };
    try {
      await window.ipm?.knowclaw?.replyAskUser?.(requestId, null, { cancelled: true });
      setMessages((prev) => prev.map((m) =>
        m.kind === 'ask_user' && m.requestId === requestId
          ? { ...m, answered: true, cancelled: true }
          : m,
      ));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  // Skip: user wants the model to proceed without their input on this
  // round of questions. Distinct from cancel (which kills the
  // interaction outright); skip tells the model "use your judgement,
  // you can ask again later if it matters". Wire payload is
  // `{ skipped: true }`, freezing the card with a "已跳过" badge.
  const skipAskUser = useCallback(async (requestId) => {
    if (!requestId) return { ok: false };
    try {
      await window.ipm?.knowclaw?.replyAskUser?.(requestId, null, { skipped: true });
      setMessages((prev) => prev.map((m) =>
        m.kind === 'ask_user' && m.requestId === requestId
          ? { ...m, answered: true, skipped: true }
          : m,
      ));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  // E.5: "开始执行" button handler. Flips Plan mode off (so the next
  // turn is tagged [MODE: agent] / untagged) then sends a kickoff
  // message telling the model to execute the previously approved plan.
  // We deliberately do BOTH steps from here so the user gets a single
  // atomic action — manually toggling mode + then typing "执行方案"
  // is fiddly enough that everyone would skip it.
  //
  // NOTE: declared AFTER setPlanMode / sendMessage to avoid a TDZ
  // ReferenceError — useCallback runs at render time and resolves the
  // dep array immediately, so forward refs to later `const` bindings
  // crash the provider.
  const startExecuting = useCallback(async () => {
    if (streaming) return; // safety: button is hidden during streaming, but double-tap guard
    await setPlanMode(false);
    await sendMessage(
      '已确认方案，请按照刚才规划的内容（参考 .knowclaw/plans/ 下最新的方案文件与当前任务清单）逐步执行，' +
      '每完成一步同步更新 task_manager。',
    );
  }, [streaming, setPlanMode, sendMessage]);

  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    try {
      const res = await window.ipm?.knowclaw?.listWorkspaces?.();
      if (res?.ok && Array.isArray(res.workspaces)) {
        setWorkspaces(res.workspaces);
      } else {
        setWorkspaces([]);
      }
    } catch {
      setWorkspaces([]);
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  const setCwd = useCallback(async (cwd) => {
    const normalized = cwd === null || cwd === undefined || cwd === '' ? null : String(cwd);
    try {
      const res = await window.ipm?.knowclaw?.setCwd?.(normalized);
      if (res?.ok) {
        // D.2: bump generation so any in-flight rehydrate from a
        // previous workspace doesn't repopulate messages here.
        sessionGenRef.current += 1;
        setCwdIsGlobal(Boolean(res.isGlobal));
        setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
        streamBufferRef.current = '';
        thinkingBufferRef.current = '';
        setStreaming(false);
        setMessages([]);
        setSessionId(null);
        setCurrentSessionFile(null);
        setPendingSteer([]);
        setPendingFollowUp([]);
        setStreamingMode('followUp');
        setContextUsage(null);
        setSessionStats(null);
        setCompacting(false);
        setCompactionReason(null);
        setRetrying(null);
        setRecentTouchedFiles(new Map());
        void loadWorkspaceTree();
        void refreshStatus();
        // D.2: auto-create a fresh session right after the workspace
        // switch. The main process tore down the old session in its
        // setCwd handler; without this call the first user message
        // would walk through `ensureSession('continueRecent')` and
        // silently resurrect the most recent JSONL for the new cwd.
        // We `await` so the header sessionId chip and the session
        // list reflect the new session before the user has a chance
        // to type. newSession internally calls refreshSessions and
        // handles failure (toast + clears sessionId), so we don't
        // gate the rest of setCwd on its result.
        await newSession();
      }
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [loadWorkspaceTree, refreshStatus, newSession]);

  const chooseDirectory = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclaw?.chooseDirectory?.();
      if (res?.ok && res.path) {
        try { await window.ipm?.knowclaw?.pinWorkspace?.(res.path); }
        catch { /* best-effort */ }
        const switched = await setCwd(res.path);
        if (switched?.ok) {
          void loadWorkspaces();
          return res.path;
        }
      }
      return null;
    } catch {
      return null;
    }
  }, [setCwd, loadWorkspaces]);

  const createWorkspace = useCallback(async (label) => {
    try {
      const res = await window.ipm?.knowclaw?.createWorkspace?.(label || '');
      if (!res?.ok || !res.path) return null;
      const switched = await setCwd(res.path);
      if (!switched?.ok) return null;
      void loadWorkspaces();
      return res.path;
    } catch {
      return null;
    }
  }, [setCwd, loadWorkspaces]);

  const openInExplorer = useCallback(async (folderPath) => {
    try {
      const res = await window.ipm?.knowclaw?.openInExplorer?.(folderPath || null);
      if (res?.ok) return res.path;
      return null;
    } catch {
      return null;
    }
  }, []);

  // E.7: copy external files (dragged from OS file manager) into the
  // current workspace. `destRelDir` is workspace-relative; '' means
  // root. On success we refresh the tree so the new files show up
  // immediately + emit toasts summarising the result. The caller
  // (ChatInput / WorkspaceFileTree) gets back the IPC response so it
  // can decide downstream behavior (e.g. insert @relPath into
  // composer).
  const uploadToWorkspace = useCallback(async (filePaths, destRelDir = '') => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { ok: false, uploaded: [], skipped: [], error: 'no files' };
    }
    try {
      const res = await window.ipm?.knowclaw?.uploadToWorkspace?.(filePaths, destRelDir);
      if (!res) return { ok: false, uploaded: [], skipped: [], error: 'no response' };

      const uploaded = Array.isArray(res.uploaded) ? res.uploaded : [];
      const skipped = Array.isArray(res.skipped) ? res.skipped : [];

      if (uploaded.length > 0) {
        // Refresh the right-side tree so the new files are visible.
        // Don't await — the toast should pop immediately.
        void loadWorkspaceTree();
        const dirHint = destRelDir ? ` 到 ${destRelDir}/` : ' 到工作空间根目录';
        showToast(`已上传 ${uploaded.length} 个文件${dirHint}`, 'success');
      }
      if (skipped.length > 0) {
        // Show first failure verbosely so the user can act on it; if
        // there are many we summarise the count.
        const head = skipped[0];
        const headStr = `${head.src ? head.src.split(/[\\/]/).pop() : '?'}: ${head.reason || '失败'}`;
        const tail = skipped.length > 1 ? `（另 ${skipped.length - 1} 个）` : '';
        showToast(`部分文件未上传 — ${headStr}${tail}`, skipped.length === filePaths.length ? 'error' : 'warn');
      }
      if (!res.ok && uploaded.length === 0 && res.error) {
        showToast(`上传失败: ${res.error}`, 'error');
      }
      return res;
    } catch (err) {
      const errText = String(err?.message || err);
      showToast(`上传失败: ${errText}`, 'error');
      return { ok: false, uploaded: [], skipped: [], error: errText };
    }
  }, [loadWorkspaceTree, showToast]);

  const hideWorkspace = useCallback(async (folderPath) => {
    if (!folderPath) return false;
    try {
      const res = await window.ipm?.knowclaw?.hideWorkspace?.(folderPath);
      if (!res?.ok) return false;
      if (currentCwd && String(currentCwd).toLowerCase() === String(folderPath).toLowerCase()) {
        await setCwd(null);
      }
      void loadWorkspaces();
      return true;
    } catch {
      return false;
    }
  }, [currentCwd, setCwd, loadWorkspaces]);

  const rescanBash = useCallback(async () => {
    try {
      const r = await window.ipm?.knowclaw?.rescanBash?.();
      if (r && r.ok) {
        if (typeof r.available === 'boolean') setBashAvailable(r.available);
        if (typeof r.source === 'string' || r.source === null) setBashSource(r.source);
        return r;
      }
      return r || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  // -------- D.1: rehydrate on first mount --------
  //
  // When the Provider mounts (= Electron renderer just started, or
  // devtools/hot-reload finished) we ask the main process if there's
  // already an active pi session. If yes, we repopulate messages /
  // tasks / streaming state immediately so the user doesn't see an
  // empty chat after a reload mid-conversation. This is also the
  // single source of truth for "header pills show real values from
  // the moment the page renders" (E.6 partial fix).
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    void loadModels();
    void refreshSessions();
    void refreshStatus();
    void loadWorkspaces();
    void loadWorkspaceTree();
    (async () => {
      // D.2: snapshot the session generation before the IPC. If the
      // user (or our own code, e.g. an auto-newSession triggered by
      // a workspace switch banner) creates a new session while
      // rehydrate is in flight, we must NOT apply the stale main-
      // process snapshot on top — that would resurrect the disposed
      // session's messages.
      const genAtRequest = sessionGenRef.current;
      let res = null;
      try {
        res = await window.ipm?.knowclaw?.rehydrate?.();
      } catch {
        // Rehydrate is best-effort — failure leaves the user with an
        // empty chat which they can fix by opening a session manually.
      }
      if (sessionGenRef.current !== genAtRequest) {
        // A newer session lifecycle event happened — drop this result.
        return;
      }
      if (!res?.ok || !res.hasSession) {
        // D.2: no live session in the main process means this is
        // either a cold start, a hot reload after the user closed
        // the previous chat, or just the very first launch. Auto-
        // create a blank session so the header sessionId is
        // populated from frame one and so the first user message
        // doesn't quietly resurrect an old JSONL via
        // `ensureSession('continueRecent')`.
        try {
          await newSession();
        } catch { /* newSession already toasts on failure */ }
        return;
      }
      if (res.sessionId) setSessionId(res.sessionId);
      if (res.sessionFile) setCurrentSessionFile(res.sessionFile);
      // Race guard: while rehydrate's IPC was in flight the event
      // listener (already attached above) may have populated
      // messages with a fresher snapshot via `agent_start` /
      // `message_update` / `history_loaded`. Only apply the
      // rehydrate transcript when the renderer state is still
      // pristine, otherwise the freshly-received deltas would be
      // clobbered by an older view. Functional setMessages keeps
      // this atomic against any concurrent appends.
      if (Array.isArray(res.messages)) {
        const restored = [...res.messages];
        const restoredTasks = Array.isArray(res.tasks) ? res.tasks : null;
        if (restoredTasks && restoredTasks.length > 0) {
          restored.push({
            role: 'system',
            kind: 'tasks',
            tasks: restoredTasks,
            ts: Date.now(),
          });
        }
        setMessages((prev) => (prev.length === 0 ? restored : prev));
      }
      // Streaming flag: only override when the listener hasn't
      // already flipped it on (e.g. agent_start arrived first).
      if (typeof res.streaming === 'boolean') {
        setStreaming((prev) => (prev ? prev : res.streaming));
      }
      if (res.contextUsage !== undefined) setContextUsage(res.contextUsage);
      if (res.sessionStats !== undefined) setSessionStats(res.sessionStats);
      if (typeof res.isCompacting === 'boolean') setCompacting(res.isCompacting);
      if (typeof res.isGlobal === 'boolean') {
        setCwdIsGlobal(res.isGlobal);
        setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Post-streaming session list refresh --------
  //
  // Mirrors the original hook's `wasStreamingRef` pattern: each time
  // streaming flips false we re-list sessions (firstMessage /
  // messageCount in pi's JSONL just changed) and refresh status.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      void refreshSessions();
      void refreshStatus();
    }
    wasStreamingRef.current = streaming;
  }, [streaming, refreshSessions, refreshStatus]);

  // -------- Computed: session lock --------
  //
  // True while a turn is in flight AND a session exists. Used by the
  // page to disable destructive controls (new conversation,
  // workspace swap, open historical session). The lock does NOT
  // block ChatInput — typed text gets routed to steer/followUp by
  // `sendMessage`. See the plan's step 8 for the full list of locked
  // controls.
  const isSessionLocked = streaming && Boolean(sessionId);

  const value = useMemo(() => ({
    // State
    messages,
    streaming,
    sessionId,
    currentSessionFile,
    models,
    currentModel,
    sessions,
    sessionsLoading,
    thinkingLevel,
    thinkingHint,
    apiMode,
    bashAvailable,
    bashSource,
    sessionStats,
    contextUsage,
    compacting,
    compactionReason,
    retrying,
    streamingMode,
    pendingSteer,
    pendingFollowUp,
    subAgentEnabled,
    skills,
    skillsLoading,
    planMode,
    currentCwd,
    cwdIsGlobal,
    userFileRoot,
    workspaces,
    workspacesLoading,
    workspaceTree,
    treeLoading,
    treeTruncated,
    recentTouchedFiles,
    streamingPhase,
    activeToolName,
    streamingIdleSeconds,
    isSessionLocked,
    // Actions
    sendMessage,
    abort,
    newSession,
    setModel,
    loadModels,
    refreshSessions,
    openSession,
    deleteSession,
    forkSession,
    changeThinkingLevel,
    dismissThinkingHint,
    rescanBash,
    setCwd,
    loadWorkspaces,
    chooseDirectory,
    createWorkspace,
    openInExplorer,
    hideWorkspace,
    setStreamingMode,
    steerMessage,
    followUpMessage,
    clearQueue: clearQueueAction,
    compactSession,
    toggleSubAgent,
    loadSkills,
    toggleSkill,
    deleteSkill,
    importSkill,
    scanExternalSkills,
    chooseSkillDir,
    setPlanMode,
    replyAskUser,
    cancelAskUser,
    skipAskUser,
    startExecuting,
    loadWorkspaceTree,
    uploadToWorkspace,
  }), [
    messages, streaming, sessionId, currentSessionFile, models, currentModel,
    sessions, sessionsLoading, thinkingLevel, thinkingHint, apiMode,
    bashAvailable, bashSource, sessionStats, contextUsage, compacting,
    compactionReason, retrying, streamingMode, pendingSteer, pendingFollowUp,
    subAgentEnabled, skills, skillsLoading, planMode, currentCwd, cwdIsGlobal,
    userFileRoot, workspaces,
    workspacesLoading, workspaceTree, treeLoading, treeTruncated,
    recentTouchedFiles, streamingPhase, activeToolName, streamingIdleSeconds,
    isSessionLocked,
    sendMessage, abort, newSession, setModel, loadModels, refreshSessions,
    openSession, deleteSession, forkSession, changeThinkingLevel,
    dismissThinkingHint, rescanBash, setCwd, loadWorkspaces, chooseDirectory,
    createWorkspace, openInExplorer, hideWorkspace, setStreamingMode,
    steerMessage, followUpMessage, clearQueueAction, compactSession,
    toggleSubAgent, loadSkills, toggleSkill, deleteSkill,
    importSkill, scanExternalSkills, chooseSkillDir,
    setPlanMode, replyAskUser, cancelAskUser, skipAskUser, startExecuting,
    loadWorkspaceTree, uploadToWorkspace,
  ]);

  return <KnowClawCtx.Provider value={value}>{children}</KnowClawCtx.Provider>;
}

export function useKnowClawPersist() {
  const ctx = useContext(KnowClawCtx);
  if (!ctx) {
    throw new Error('useKnowClawPersist must be used within KnowClawPersistProvider');
  }
  return ctx;
}
