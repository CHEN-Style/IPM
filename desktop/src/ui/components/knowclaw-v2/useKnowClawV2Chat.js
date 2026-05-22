// desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js
//
// Chat hook for the KnowClaw v2 panel. Consumes the pi-coding-agent
// event stream over the `window.ipm.knowclaw` IPC bridge (registered by
// `desktop/src/main/ipc/knowclaw.js`).
//
// Event mapping (pi → renderer message model):
//
//   agent_start              → ensure streaming assistant placeholder
//   message_update.text_delta → accumulate delta into streamBufferRef,
//                              update last assistant.content
//   tool_execution_start     → append { name, toolCallId, status: 'running' }
//                              to last assistant.tools
//   tool_execution_end       → match by toolCallId → status: 'done' | 'error',
//                              fill result text
//   agent_end                → streaming = false, reset buffer
//   error                    → append system error message, streaming = false
//   history_loaded           → (Phase 10) replace messages with restored
//                              transcript + remember currentSessionFile
//
// The produced `message` shape is compatible with the existing
// `agent-chat/MessageBubble.jsx` component (no changes required there).

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfirmDialog } from '../../hooks/useConfirmDialog.jsx';

function ensureStreamingMessage(messages) {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last?.streaming) return messages;
  return [
    ...messages,
    { role: 'assistant', content: '', streaming: true, tools: [], ts: Date.now() },
  ];
}

function stringifyResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    // pi tool results are often `[{ type: 'text', text: '...' }, ...]`.
    const texts = result
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : null))
      .filter(Boolean);
    if (texts.length > 0) return texts.join('\n');
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function updateToolByCallId(messages, toolCallId, patch) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tools)) {
      const idx = msg.tools.findIndex((t) => t.toolCallId === toolCallId);
      if (idx >= 0) {
        const updatedTools = msg.tools.map((t, j) => (j === idx ? { ...t, ...patch } : t));
        return [...messages.slice(0, i), { ...msg, tools: updatedTools }, ...messages.slice(i + 1)];
      }
    }
  }
  return messages;
}

export default function useKnowClawV2Chat() {
  // U3: dependency-install confirmation. `useConfirmDialog` returns a
  // function that pops the reusable `ConfirmDialogUI` (mounted by
  // `App.jsx`'s `ConfirmDialogProvider`) and resolves with the user's
  // choice as a boolean. We bind it once here and dispatch the
  // confirm IPC from inside the `onConfirmInstall` listener below.
  const confirm = useConfirmDialog();

  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState(null); // 'provider/id' string

  // Phase 10: history session UI state.
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [currentSessionFile, setCurrentSessionFile] = useState(null);

  // U0 (revised): thinking depth is now driven entirely by user
  // intent. We *do not* gate the UI on pi's `supportsThinking()` —
  // pi marks every IPM-registered model as `reasoning: true`
  // (see `pi-runtime/models.js`) so the level the user picks is the
  // level we send. If the upstream model silently ignores
  // `reasoning_effort` (i.e. no `thinking_delta` arrives during the
  // turn), we surface a soft hint instead of blocking the toggle.
  //
  //   thinkingLevel    — current selected depth ('off' | 'minimal' | ...)
  //   thinkingHint     — UI hint state:
  //                        'none'        no warning to show
  //                        'no-content'  last non-'off' turn produced
  //                                      zero `thinking_delta` events
  const [thinkingLevel, setThinkingLevelState] = useState('medium');
  const [thinkingHint, setThinkingHint] = useState('none');
  // U0.5: 'chat' | 'responses' — which OpenAI-compatible endpoint
  // the active provider is hitting. Read-only in the UI: changing it
  // requires editing IPM settings + restarting the runtime.
  const [apiMode, setApiMode] = useState(null);

  // U3: whether the bash interpreter pi needs is reachable. `null`
  // until the first `getStatus` reply lands. On macOS/Linux the
  // value is always `true`; on Windows it reflects whether Git Bash
  // (or any `bash.exe` on PATH) was found. We drive a top-of-page
  // banner from this; the chat itself stays usable but Skills that
  // shell out (pdf/docx/pptx/web-artifacts/...) will fail loudly
  // until the user installs Git for Windows.
  const [bashAvailable, setBashAvailable] = useState(null);

  // Companion to `bashAvailable` that also surfaces *where* the bash
  // came from (`'system' | 'bundled' | 'override' | null`). The banner
  // uses this to switch between "未检测到" / "已启用内置 bash" / "已检测到"
  // wording. Stored separately so legacy code paths that only care about
  // the boolean keep working unchanged.
  const [bashSource, setBashSource] = useState(null);

  // U8a: cumulative session statistics (tokens-only). Hydrated by the
  // same `knowclaw:getStatus` poller that drives `contextUsage`. Stays
  // null until the first status response lands so the `TokenPill`
  // header chip can render a clean placeholder rather than a flash of
  // zeros. Cost is intentionally NOT plumbed through (see the field's
  // long comment in `desktop/src/main/ipc/knowclaw.js`).
  const [sessionStats, setSessionStats] = useState(null);

  // U5: compaction + auto-retry visibility.
  //
  //   contextUsage     — { tokens, contextWindow, percent } | null
  //                      latest snapshot from pi's getContextUsage().
  //                      Refreshed via `refreshStatus` on mount, after
  //                      each turn, and after `compaction_end`. tokens
  //                      / percent may be null right after a compact
  //                      (pi can't re-estimate until the next LLM
  //                      response lands); the pill renders "N/A" then.
  //   compacting       — true between `compaction_start` and
  //                      `compaction_end`. Drives the sticky banner.
  //   compactionReason — 'manual' | 'threshold' | 'overflow' | null,
  //                      used in the banner copy.
  //   retrying         — { attempt, maxAttempts, delayMs } | null
  //                      mirrors pi's `auto_retry_start/end`. Drives
  //                      the same sticky banner area (mutually
  //                      exclusive with `compacting` in practice).
  const [contextUsage, setContextUsage] = useState(null);
  const [compacting, setCompacting] = useState(false);
  const [compactionReason, setCompactionReason] = useState(null);
  const [retrying, setRetrying] = useState(null);

  // U4: steer / followUp interaction state.
  //
  //   streamingMode   — which queue the composer routes to when the
  //                     user types during streaming. `'followUp'` is
  //                     the default (safer: pi drains the queue
  //                     between turns) and we deliberately reset back
  //                     to `'followUp'` whenever streaming stops or
  //                     the session swaps. Switch to `'steer'` from
  //                     the composer toolbar for true interrupts.
  //   pendingSteer    — full message texts currently waiting in pi's
  //                     steering queue (driven by `queue_update`).
  //                     We keep the full strings (not just a count)
  //                     so the toolbar can pop a preview tooltip.
  //   pendingFollowUp — same but for the followUp lane.
  const [streamingMode, setStreamingMode] = useState('followUp');
  const [pendingSteer, setPendingSteer] = useState([]);
  const [pendingFollowUp, setPendingFollowUp] = useState([]);

  // U6: persistent sub-agent kill-switch. Defaults to `true` (enabled)
  // to match the main-process default. We hydrate the real value from
  // the first `getStatus` reply / explicit `getSubAgentEnabled` call;
  // until then the toggle visually reads "enabled", which matches the
  // behaviour the user gets if they never touch the toggle.
  //
  // Toggling fires `setSubAgentEnabled` to persist, then emits a
  // system info bubble explaining the change takes effect on the
  // *next* new conversation (pi binds customTools at session
  // creation; we cannot mutate an in-flight session's tool set).
  const [subAgentEnabled, setSubAgentEnabledState] = useState(true);

  // U1: dynamic workspace.
  //
  //   currentCwd     — absolute path of the active workspace, or null
  //                    when running in "global" mode (cwd = userfile
  //                    root). Mirrors `currentCwd` in the IPC layer.
  //   cwdIsGlobal    — convenience flag for the badge / selector UI.
  //   userFileRoot   — the global mode's effective path, surfaced so
  //                    the selector can show "全局 (userfile/)".
  //   workspaces     — list of selectable workspaces from the IPC
  //                    `knowclaw:listWorkspaces` (global +
  //                    project/case/study + imported local folders).
  //   workspacesLoading — true while the list is being fetched.
  const [currentCwd, setCurrentCwdState] = useState(null);
  const [cwdIsGlobal, setCwdIsGlobal] = useState(true);
  const [userFileRoot, setUserFileRoot] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  const streamBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  // Tracks the level that was active when the *current* turn started,
  // so the listener (which closes over a stale `thinkingLevel`) can
  // make a correct "did this turn ask for thinking" decision in
  // `agent_end`.
  const turnThinkingLevelRef = useRef('off');
  // Set to true the moment we see any `thinking_delta` event for the
  // current turn. Reset by `sendMessage` (and on abort).
  const sawThinkingDeltaRef = useRef(false);
  // Each time `sendMessage` is invoked we bump this counter so that
  // late-arriving events from a previous turn cannot mutate the wrong
  // assistant placeholder.
  const turnIdRef = useRef(0);
  // U7: between `tool_execution_start` and `tool_execution_end` for
  // every `task_manager` call, we stash the model-supplied tasks array
  // keyed by toolCallId. On `tool_execution_end` (when !isError) we
  // pop the entry and append a `kind:'tasks'` bubble carrying the
  // snapshot. We capture at start (not end) because the parsed args
  // are guaranteed available there and the tool's content[0].text is
  // only a short summary — the structured array would be lost.
  const taskCallsRef = useRef(new Map());

  // --- Event subscription ---
  useEffect(() => {
    const off = window.ipm?.knowclaw?.onEvent?.((event) => {
      if (!event || typeof event !== 'object') return;

      // Always remember the latest sessionId
      if (event.sessionId && event.sessionId !== sessionId) {
        setSessionId(event.sessionId);
      }

      switch (event.type) {
        case 'agent_start': {
          setMessages((prev) => ensureStreamingMessage(prev));
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
            setMessages((prev) => {
              const updated = ensureStreamingMessage(prev);
              const last = updated[updated.length - 1];
              return [
                ...updated.slice(0, -1),
                { ...last, content: streamBufferRef.current },
              ];
            });
          } else if (sub.type === 'thinking_delta') {
            // U0 (revised): accumulate the model's extended-thinking
            // stream into the current assistant placeholder. The first
            // `thinking_delta` of a turn is also our positive evidence
            // that the upstream model honoured `reasoning_effort`, so
            // any "no-content" hint left over from a previous turn
            // should be cleared.
            const delta = sub.delta || '';
            if (!delta) break;
            sawThinkingDeltaRef.current = true;
            // Clear any prior "model didn't think" hint as soon as we
            // see actual thinking content come through.
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
          // text_end / thinking_start / thinking_end: no-op (agent_end
          // finalizes streaming flag; thinking accumulation needs no
          // explicit end marker).
          break;
        }

        case 'tool_execution_start': {
          const toolCallId = event.toolCallId || `${event.toolName || 'tool'}-${Date.now()}`;
          const name = event.toolName || 'tool';
          // U7: stash the supplied tasks array now, while
          // `event.args.tasks` is guaranteed available. The matching
          // tool_execution_end branch reads & deletes it. We do a
          // minimal-shape normalisation here so a malformed model
          // payload doesn't poison the renderer (the tool itself
          // does its own validation on the runtime side).
          if (name === 'task_manager') {
            const args = event.args && typeof event.args === 'object' ? event.args : null;
            const raw = Array.isArray(args?.tasks) ? args.tasks : [];
            const normalized = [];
            for (const t of raw) {
              if (!t || typeof t !== 'object') continue;
              const id = typeof t.id === 'string' ? t.id : '';
              const title = typeof t.title === 'string' ? t.title : '';
              const status = typeof t.status === 'string' ? t.status : 'pending';
              if (!id || !title) continue;
              const entry = { id, title, status };
              if (typeof t.notes === 'string' && t.notes) entry.notes = t.notes;
              normalized.push(entry);
            }
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
                  { name, toolCallId, status: 'running' },
                ],
              },
            ];
          });
          break;
        }

        case 'tool_execution_update': {
          // U3: pi's bash tool emits `tool_execution_update` every
          // ~100ms with `partialResult.content[0].text` carrying the
          // accumulated stdout/stderr so far (already truncated to
          // the configured tail). We attach the snapshot to the
          // matching tool entry and let `MessageBubble` render it in
          // a terminal-style stripe — this kills the "cursor flicker
          // for 40 seconds" UX during `pip install` / `npm install`.
          //
          // The empty-payload first frame (sent right before pi
          // spawns the child process) lets us flush any stale text
          // from a previous run of the same toolCallId; we treat it
          // as the start-of-stream signal and clear the field.
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
          // U3: once the final result lands, drop the live-stream
          // snapshot — the result already contains the full (or
          // truncated-with-pointer) output, and showing both would be
          // duplicate noise.
          setMessages((prev) =>
            updateToolByCallId(prev, toolCallId, { status, result, streamingStdout: undefined }),
          );

          // U7: if this was a `task_manager` call that we stashed at
          // start AND it didn't error out, append an inline TaskCard
          // bubble carrying the snapshot. The ToolCallCard stays
          // visible too — it's the "raw call" view; the TaskCard is
          // the "human-friendly checklist" view. They're complementary.
          // We always pop the entry to avoid leaking memory on errors.
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

          // U0 (revised): post-turn thinking hint. If the user asked
          // for thinking (level != 'off') but the entire turn went by
          // without a single `thinking_delta`, we suspect either the
          // gateway dropped `reasoning_effort` or the upstream model
          // simply doesn't emit reasoning fields. Flag it softly so
          // the UI can render an unobtrusive notice.
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
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              // Drop empty placeholder with no tools, no text, no thinking.
              if (!finalText && !finalThinking && (!last.tools || last.tools.length === 0)) {
                return prev.slice(0, -1);
              }
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  content: finalText || last.content,
                  thinking: finalThinking || last.thinking || '',
                  streaming: false,
                },
              ];
            }
            return prev;
          });
          break;
        }

        case 'error': {
          const errText = event.error || event.message || '未知错误';
          streamBufferRef.current = '';
          thinkingBufferRef.current = '';
          sawThinkingDeltaRef.current = false;
          setStreaming(false);
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
          // Phase 10: pi session restored. Replace the transcript with
          // the mapped historical bubbles and remember which JSONL is
          // active (for "current session" highlighting in SessionPanel).
          streamBufferRef.current = '';
          setStreaming(false);
          const restored = Array.isArray(event.messages) ? event.messages : [];
          // U7: if the main process found a `knowclaw:tasks` snapshot
          // in the session's entry log, surface it as a TaskCard at
          // the tail of the restored transcript so the user sees the
          // last task state they left off on. We append (not insert
          // mid-stream) because the snapshot represents *current*
          // state — not a historical event tied to a specific
          // message position. We also clear any pending stash from
          // the previous session.
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
          // U4: a restored history starts with empty queues. Pi will
          // not re-emit `queue_update` after `history_loaded`, so we
          // force a local reset here to keep the toolbar honest.
          setPendingSteer([]);
          setPendingFollowUp([]);
          break;
        }

        case 'queue_update': {
          // U4: pi's authoritative snapshot of the steer/followUp
          // queues. Emitted on every enqueue (steer/followUp call)
          // and every dequeue (when agent-loop drains the next item
          // at the tool-call boundary). Treat this as the single
          // source of truth — never manually push to these arrays
          // from the optimistic side, or we'd double-count.
          setPendingSteer(Array.isArray(event.steering) ? event.steering : []);
          setPendingFollowUp(Array.isArray(event.followUp) ? event.followUp : []);
          break;
        }

        case 'compaction_start': {
          // U5: pi has begun summarizing older messages to reclaim
          // tokens. `reason` tells us whether the user clicked the
          // header button (`manual`), whether pi auto-triggered after
          // crossing the configured threshold (`threshold`), or
          // whether the last LLM response actually overflowed the
          // context window (`overflow`, the recovery path). The UI
          // uses this to render an accurate banner subtitle.
          setCompacting(true);
          setCompactionReason(event.reason || null);
          break;
        }

        case 'compaction_end': {
          // U5: clear the in-progress banner regardless of outcome.
          // After a successful compact pi can't compute a fresh
          // context-token estimate until the *next* assistant turn
          // lands (it'd be guessing), so `getContextUsage()` returns
          // `{ tokens: null, percent: null }` for now — we proactively
          // call the IPC anyway so the pill switches to "N/A" rather
          // than showing the pre-compact percentage.
          setCompacting(false);
          setCompactionReason(null);
          (async () => {
            try {
              const res = await window.ipm?.knowclaw?.getStatus?.();
              if (res?.ok && res.contextUsage !== undefined) {
                setContextUsage(res.contextUsage);
              }
            } catch { /* ignore — pill keeps last good value */ }
          })();
          // pi emits `errorMessage` for genuine failures (network /
          // model unavailable / corrupted state). User-initiated
          // aborts come through with `aborted: true` and no error —
          // those we swallow silently, because the user already saw
          // their abort action take effect.
          if (event.errorMessage && !event.aborted) {
            setMessages((prev) => [
              ...prev,
              {
                role: 'system',
                content: `上下文压缩失败: ${event.errorMessage}`,
                ts: Date.now(),
              },
            ]);
          }
          break;
        }

        case 'auto_retry_start': {
          // U5: pi's transient-error retry kicked in (rate limit,
          // 5xx, partial network drop). The banner shows the attempt
          // counter and the wait so the user understands why the UI
          // is "hanging" without actually being stuck.
          setRetrying({
            attempt: Number(event.attempt) || 0,
            maxAttempts: Number(event.maxAttempts) || 0,
            delayMs: Number(event.delayMs) || 0,
          });
          break;
        }

        case 'auto_retry_end': {
          // U5: clear the retry banner. If pi gave up entirely
          // (`success === false` and we exhausted attempts), surface
          // the final error as a system message — the regular
          // `error` event would already have fired too in most
          // cases, but pi's wording on `finalError` is sometimes
          // more specific (it carries the original transport error).
          setRetrying(null);
          if (event.success === false && event.finalError) {
            setMessages((prev) => [
              ...prev,
              {
                role: 'system',
                content: `自动重试失败 (第 ${event.attempt || '?'} 次): ${event.finalError}`,
                ts: Date.now(),
              },
            ]);
          }
          break;
        }

        default:
          // Ignored event types: turn_start, turn_end, message_start,
          // message_end, thinking_*, etc.
          break;
      }
    });

    return () => { off?.(); };
  }, [sessionId]);

  // --- U3: install confirmation listener ---
  //
  // Main process pushes a `knowclaw:confirm-install` message whenever
  // the agent issues a bash command containing `pip install` /
  // `npm install` (and friends). We pop the shared confirm dialog
  // and reply via `replyConfirmInstall(requestId, allow)`.
  //
  // The handler purposely uses the live `confirm` from
  // `useConfirmDialog`. `confirm` is a `useCallback` inside the
  // provider so its reference is stable — listing it in deps below is
  // technically unnecessary but keeps the lint rule happy without
  // causing remount thrashing.
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
        // Silently swallow — main will time out after 60s anyway and
        // treat the request as denied.
        // eslint-disable-next-line no-console
        console.warn('[KnowClaw] replyConfirmInstall failed:', err?.message || err);
      }
    });
    return () => { off?.(); };
  }, [confirm]);

  // --- Actions ---

  // U4: shared helper for steer/followUp. Optimistically appends a
  // user bubble tagged with the kind (so MessageBubble can render a
  // small badge), fires the IPC, and rolls the bubble back to a
  // system error on failure. We do NOT manually touch
  // `pendingSteer`/`pendingFollowUp` here — pi emits a `queue_update`
  // event immediately after enqueue and that handler is the single
  // source of truth.
  const enqueueDuringStream = useCallback(async (text, kind, images = []) => {
    const trimmed = String(text || '').trim();
    // U8b-7: allow image-only steer/followUp ("look at this screenshot")
    // but reject the truly empty case (no text + no attachments).
    const imageList = Array.isArray(images) ? images : [];
    if (!trimmed && imageList.length === 0) return { ok: false, error: 'empty message' };
    const optimisticTs = Date.now();
    // Optimistic user bubble. `attachments` is the same shape the
    // history-replay path produces (see `mapPiMessagesForRenderer` in
    // `desktop/src/main/ipc/knowclaw.js`), so MessageBubble renders
    // identically whether the bubble came from optimistic UI or from
    // a JSONL re-hydration.
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
        // Roll the optimistic user bubble back: replace it with a
        // system error so the user sees *why* the message didn't
        // land. Match by ts because new events may have arrived
        // between the optimistic push and the IPC response.
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

  // U8b-7: steer/followUp accept an optional `images` array of
  // `{ mimeType, data }` objects (data = bare base64 from
  // `resizeImageToBase64`). Callers that don't pass images keep
  // working unchanged.
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
      // Main process will emit `queue_update` with empty arrays
      // immediately after clearQueue; the renderer handler picks
      // that up and resets state. We avoid touching state here so
      // there's a single source of truth.
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  // U5: manual context compaction. We do NOT optimistically set
  // `compacting = true` — pi fires `compaction_start` synchronously
  // from inside `session.compact()`, and the renderer picks that up
  // through the event listener. Going through that single channel
  // keeps manual and auto-triggered compactions visually identical
  // and avoids "banner stuck on" bugs when the IPC fails before pi
  // ever begins.
  const compactSession = useCallback(async (customInstructions) => {
    try {
      const res = await window.ipm?.knowclaw?.compact?.(customInstructions);
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  const sendMessage = useCallback(async (text, images) => {
    const trimmed = String(text || '').trim();
    // U8b-7: image-only sends are allowed (mirrors the IPC contract).
    // Reject only when *both* text and attachments are empty.
    const imageList = Array.isArray(images) ? images : [];
    if (!trimmed && imageList.length === 0) return;
    // U4: while a turn is in flight, route input through the
    // steer/followUp queue instead of starting a new turn. The
    // composer is no longer disabled during streaming.
    if (streaming) {
      if (streamingMode === 'steer') {
        await steerMessage(trimmed, imageList);
      } else {
        await followUpMessage(trimmed, imageList);
      }
      return;
    }

    turnIdRef.current += 1;
    streamBufferRef.current = '';
    thinkingBufferRef.current = '';
    // Capture the level this turn was *asked* with so `agent_end`
    // can decide whether to flag a "no thinking content" hint.
    turnThinkingLevelRef.current = thinkingLevel;
    sawThinkingDeltaRef.current = false;
    // A new turn always supersedes any stale hint. The hint will be
    // re-asserted at agent_end only if this turn also produced no
    // thinking_delta while thinking was requested.
    setThinkingHint('none');
    setStreaming(true);

    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: trimmed,
        ts: Date.now(),
        // U8b-7: optimistic attachments — keep the same `{ mimeType,
        // data }` shape the IPC layer enforces so MessageBubble can
        // render thumbnails without an additional reload roundtrip.
        ...(imageList.length > 0 ? { attachments: imageList } : {}),
      },
      { role: 'assistant', content: '', thinking: '', streaming: true, tools: [], ts: Date.now() },
    ]);

    try {
      const res = await window.ipm?.knowclaw?.send?.(trimmed, imageList.length > 0 ? imageList : undefined);
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
    // `agent_end` will normally fire after abort; we still proactively
    // close the streaming flag so the input box is enabled immediately.
    thinkingBufferRef.current = '';
    // An aborted turn isn't evidence of "model doesn't think" — drop
    // the per-turn flag without emitting a hint.
    sawThinkingDeltaRef.current = false;
    setStreaming(false);
    // U4: main process called `clearQueue()` before aborting and pi
    // emitted an empty `queue_update`, so pending state is already
    // empty. Belt-and-braces: clear local arrays in case the event
    // ordering surprises us (event arrival is async; the user wants
    // the toolbar to look "clean" the moment they click 中止).
    setPendingSteer([]);
    setPendingFollowUp([]);
    // Reset composer back to the default mode for the next streaming
    // round — the explicit "打断" intent doesn't carry over into a
    // new turn the user starts later.
    setStreamingMode('followUp');
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
    try {
      const res = await window.ipm?.knowclaw?.newSession?.();
      if (res?.ok && res.sessionId) setSessionId(res.sessionId);
      if (res?.ok && res.sessionFile) setCurrentSessionFile(res.sessionFile);
      else setCurrentSessionFile(null);
    } catch { /* ignore */ }
    streamBufferRef.current = '';
    setMessages([]);
    setStreaming(false);
    // U4: a freshly created session has empty queues. Pi does not
    // emit a `queue_update` on session boundary, so reset locally.
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    // U5: a fresh session has no recorded context usage yet. Drop
    // the pill to `null` so we don't briefly show the previous
    // session's percentage; refreshStatus (triggered after the
    // newSession IPC completes) will repopulate it.
    setContextUsage(null);
    // U8a: same logic for token counts — they are session-scoped.
    setSessionStats(null);
    setCompacting(false);
    setCompactionReason(null);
    setRetrying(null);
    // Refresh the list so the brand-new session appears in the panel
    // right away (its first user turn will populate firstMessage).
    void refreshSessions();
  }, [refreshSessions]);

  const openSession = useCallback(async (sessionFile) => {
    if (!sessionFile) return { ok: false, error: 'sessionFile is required' };
    if (streaming) {
      try { await window.ipm?.knowclaw?.abort?.(); } catch { /* ignore */ }
    }
    streamBufferRef.current = '';
    setStreaming(false);
    // U4: session swap = empty queues. `history_loaded` will also
    // reset these, but doing it eagerly avoids a flash of stale
    // pending pills between the IPC roundtrip and the event.
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    // U5: opening a different session changes the context window
    // entirely; reset the pill so we don't show stale numbers.
    setContextUsage(null);
    // U8a: tokens reset for the same reason.
    setSessionStats(null);
    setCompacting(false);
    setCompactionReason(null);
    setRetrying(null);
    try {
      const res = await window.ipm?.knowclaw?.openSession?.(sessionFile);
      if (res?.ok) {
        if (res.sessionId) setSessionId(res.sessionId);
        if (res.sessionFile) setCurrentSessionFile(res.sessionFile);
        // U1: pi session JSONL records the cwd in its header; the IPC
        // restored `currentCwd` accordingly and echoed it back in
        // `res.cwd` / `res.isGlobal`. Sync the renderer state so the
        // WorkspaceSelector / WorkspaceBadge reflect where the
        // restored conversation actually lives.
        if (typeof res.isGlobal === 'boolean') {
          setCwdIsGlobal(res.isGlobal);
          setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
        }
        // The opened session's workspace owns its own session
        // directory, so refresh the panel's session list to show
        // the right neighbours.
        void refreshSessions();
        // history_loaded event will arrive immediately and populate
        // the transcript; we don't pre-clear here to avoid a flash of
        // empty state.
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [streaming, refreshSessions]);

  const deleteSession = useCallback(async (sessionFile) => {
    if (!sessionFile) return { ok: false, error: 'sessionFile is required' };
    try {
      const res = await window.ipm?.knowclaw?.deleteSession?.(sessionFile);
      if (res?.ok) {
        if (res.wasActive) {
          // Active session was just deleted — clear local UI state so
          // the user lands on an empty new-session view.
          streamBufferRef.current = '';
          setMessages([]);
          setStreaming(false);
          setSessionId(null);
          setCurrentSessionFile(null);
        }
        await refreshSessions();
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [refreshSessions]);

  const forkSession = useCallback(async (sessionFile, entryIndex) => {
    if (!sessionFile) return { ok: false, error: 'sessionFile is required' };
    if (streaming) {
      try { await window.ipm?.knowclaw?.abort?.(); } catch { /* ignore */ }
    }
    streamBufferRef.current = '';
    setStreaming(false);
    // U4: forked sessions start from a clean queue.
    setPendingSteer([]);
    setPendingFollowUp([]);
    setStreamingMode('followUp');
    // U5: fork == new session lineage; reset usage pill.
    setContextUsage(null);
    // U8a: tokens reset on fork too.
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
        if (!currentModel) {
          const def = res.models.find((m) => m.isDefault) || res.models[0];
          if (def) setCurrentModel(`${def.provider}/${def.id}`);
        }
      }
    } catch { /* ignore */ }
  }, [currentModel]);

  const setModel = useCallback(async (providerId, modelId) => {
    try {
      const res = await window.ipm?.knowclaw?.setModel?.(providerId, modelId);
      if (res?.ok) {
        setCurrentModel(`${providerId}/${modelId}`);
        // New model takes effect on next session; force a fresh session
        // so the user gets the expected behavior.
        await newSession();
      }
      return res;
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [newSession]);

  // U0 (revised): switch the thinking depth. We accept whatever the
  // user picks; pi will pass it through as `reasoning_effort` (or
  // drop it when 'off'). We optimistically apply the selection
  // *before* the IPC roundtrip so the UI feels instant — if the IPC
  // returns a different effective level we sync to it, but we no
  // longer let pi's "clamp to off" behaviour override the user.
  const changeThinkingLevel = useCallback(async (level) => {
    setThinkingLevelState(level);
    // Any active hint reflects an old level/turn; reset it.
    setThinkingHint('none');
    try {
      const res = await window.ipm?.knowclaw?.setThinkingLevel?.(level);
      // We deliberately do NOT overwrite the state with res.level here.
      // pi clamps to 'off' for models whose metadata says reasoning is
      // unsupported, but our default model shape now sets
      // `reasoning: true`, so this should match. If it doesn't, the
      // mismatch will manifest as a "no-content" hint at agent_end,
      // which is the behaviour the user asked for.
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, []);

  const dismissThinkingHint = useCallback(() => {
    setThinkingHint('none');
  }, []);

  // After a session is created (or a turn finishes) refresh the
  // status snapshot so the UI's thinking level matches the
  // actually-applied value in the runtime. We no longer track
  // `supportsThinking` here — see component comment above.
  const refreshStatus = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclaw?.getStatus?.();
      if (res?.ok) {
        if (res.thinkingLevel) setThinkingLevelState(res.thinkingLevel);
        if (typeof res.apiMode === 'string' || res.apiMode === null) {
          setApiMode(res.apiMode || null);
        }
        // U1: hydrate workspace state from main-process source of
        // truth. `isGlobal` is authoritative — `currentCwd` is set
        // to the absolute path only when the workspace is non-global.
        if (typeof res.userFileRoot === 'string') {
          setUserFileRoot(res.userFileRoot);
        }
        if (typeof res.isGlobal === 'boolean') {
          setCwdIsGlobal(res.isGlobal);
          setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
        }
        // U3 + bundled-bash: bash availability + source. The
        // boolean drives whether to show the banner at all; the
        // source drives which wording to show (system vs bundled
        // vs missing). We treat missing fields as unknown (null).
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
        // U5: context usage snapshot for the header pill.
        // pi returns either an object (with possibly-null tokens/
        // percent fields right after compaction), or null when
        // there's no active session yet. We pass it through
        // unchanged; the pill component handles the null cases.
        if (res.contextUsage !== undefined) {
          setContextUsage(res.contextUsage);
        }
        // U8a: cumulative session stats (tokens-only). Same null
        // semantics as contextUsage — main returns null until pi
        // session boots, and we propagate it through.
        if (res.sessionStats !== undefined) {
          setSessionStats(res.sessionStats);
        }
        // U5: late-subscriber safety net — if the renderer mounts
        // while a compaction is mid-flight (e.g. hot reload), this
        // lets the banner restore even though we missed the
        // `compaction_start` event.
        if (typeof res.isCompacting === 'boolean') {
          setCompacting(res.isCompacting);
        }
        // U6: persistent sub-agent kill-switch. We refresh on every
        // status call (mount, end-of-turn) so the toggle stays in
        // sync across windows / restarts. main returns `undefined`
        // when state.json is missing — we keep the default `true`
        // in that case rather than flipping the UI to `false`.
        if (typeof res.subAgentEnabled === 'boolean') {
          setSubAgentEnabledState(res.subAgentEnabled);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // U6: toggle the persistent sub-agent kill-switch. We update the
  // local state optimistically, fire the IPC, and emit a system
  // info bubble so the user understands the change takes effect on
  // the next new conversation. On IPC failure we revert the local
  // state and surface the error in the same bubble channel.
  const toggleSubAgent = useCallback(async (enabled) => {
    const next = Boolean(enabled);
    setSubAgentEnabledState(next);
    try {
      const res = await window.ipm?.knowclaw?.setSubAgentEnabled?.(next);
      if (!res?.ok) {
        // Revert + surface the error.
        setSubAgentEnabledState(!next);
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `子代理开关切换失败: ${res?.error || '未知错误'}`,
            ts: Date.now(),
          },
        ]);
        return res || { ok: false };
      }
      // Successful toggle — tell the user the change is queued for
      // the next session. We deliberately do NOT auto-restart the
      // active session because that would discard their transcript.
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

  // U1: fetch the list of selectable workspaces (global + IPM
  // project/case/study + imported local folders). Cheap to call;
  // re-invoked whenever the user opens the WorkspaceSelector or
  // creates/imports a new directory.
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

  // U1: switch to a different workspace. `cwd === null` (or empty
  // string) means "back to global". The IPC layer disposes the
  // active pi session, so we clear the visible transcript here too —
  // the next user message creates a fresh session under the new cwd.
  const setCwd = useCallback(async (cwd) => {
    const normalized = cwd === null || cwd === undefined || cwd === '' ? null : String(cwd);
    try {
      const res = await window.ipm?.knowclaw?.setCwd?.(normalized);
      if (res?.ok) {
        setCwdIsGlobal(Boolean(res.isGlobal));
        setCurrentCwdState(res.isGlobal ? null : (res.cwd || null));
        // Workspace switch is a hard session boundary — drop the
        // visible transcript so the user doesn't see stale messages
        // that no longer correspond to the active pi session.
        streamBufferRef.current = '';
        thinkingBufferRef.current = '';
        setStreaming(false);
        setMessages([]);
        setSessionId(null);
        setCurrentSessionFile(null);
        // U4: dropping the session means dropping any in-flight
        // pending steer/followUp from the previous workspace.
        setPendingSteer([]);
        setPendingFollowUp([]);
        setStreamingMode('followUp');
        // U5: workspace swap disposes the pi session, so context
        // usage from the old session is now meaningless.
        setContextUsage(null);
        // U8a: tokens reset on workspace swap.
        setSessionStats(null);
        setCompacting(false);
        setCompactionReason(null);
        setRetrying(null);
        // Refresh the per-workspace session list (each cwd has its
        // own pi session directory) and the status snapshot.
        void refreshSessions();
        void refreshStatus();
      }
      return res || { ok: false, error: 'no response' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [refreshSessions, refreshStatus]);

  // U1: helper that pops the OS folder picker via IPC and, on a
  // successful selection, switches the workspace to it. Returns the
  // chosen path (or null on cancel/error) so the caller can also
  // refresh the workspaces list to surface freshly-imported folders.
  //
  // U1 hotfix-2: also persists the chosen path via `pinWorkspace`
  // so it shows up in the dropdown's "自定义目录" group on every
  // future render (and across Electron runs). Pinning happens
  // *before* the cwd switch so a fast re-render of the selector
  // already includes the new entry.
  const chooseDirectory = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclaw?.chooseDirectory?.();
      if (res?.ok && res.path) {
        try { await window.ipm?.knowclaw?.pinWorkspace?.(res.path); }
        catch { /* best-effort — switching still proceeds */ }
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

  // U1: create a brand-new workspace folder under
  // `<userFileRoot>/workspaces/workspace-<timestamp>[-label]` and
  // immediately switch into it. The mkdir is performed by main
  // (renderers don't get fs access via the preload bridge), then we
  // call `setCwd` with the returned absolute path so a fresh pi
  // session is created in the new folder on the next user message.
  //
  // Returns the chosen path (string) on success, or null on failure
  // / cancel — caller can use the path to display a toast.
  const createWorkspace = useCallback(async (label) => {
    try {
      const res = await window.ipm?.knowclaw?.createWorkspace?.(label || '');
      if (!res?.ok || !res.path) return null;
      const switched = await setCwd(res.path);
      if (!switched?.ok) return null;
      // After creating + switching, refresh the workspace list. The
      // updated `listWorkspaces` IPC scans `userfile/workspaces/`
      // directly, so the freshly-created folder will appear in the
      // "KnowClaw 工作空间" group on next dropdown open and across
      // future Electron runs.
      void loadWorkspaces();
      return res.path;
    } catch {
      return null;
    }
  }, [setCwd, loadWorkspaces]);

  // U1 (post-fix): open a workspace folder in the OS file manager.
  // No argument = open the active workspace. Returns the absolute
  // path that was opened so callers can show a confirmation toast.
  const openInExplorer = useCallback(async (folderPath) => {
    try {
      const res = await window.ipm?.knowclaw?.openInExplorer?.(folderPath || null);
      if (res?.ok) return res.path;
      return null;
    } catch {
      return null;
    }
  }, []);

  // U1 hotfix-2: hide a workspace from the dropdown (does NOT delete
  // the folder on disk). If the user hides the *currently active*
  // workspace, also switch back to global so they aren't operating
  // inside an invisible cwd. Refreshes the dropdown list afterwards.
  const hideWorkspace = useCallback(async (folderPath) => {
    if (!folderPath) return false;
    try {
      const res = await window.ipm?.knowclaw?.hideWorkspace?.(folderPath);
      if (!res?.ok) return false;
      // If we just hid the active workspace, fall back to global so
      // the badge / cwd doesn't point at an entry the user can no
      // longer see.
      if (currentCwd && String(currentCwd).toLowerCase() === String(folderPath).toLowerCase()) {
        await setCwd(null);
      }
      void loadWorkspaces();
      return true;
    } catch {
      return false;
    }
  }, [currentCwd, setCwd, loadWorkspaces]);

  // Auto-load models + sessions + status + workspaces on mount.
  useEffect(() => {
    void loadModels();
    void refreshSessions();
    void refreshStatus();
    void loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also refresh the session list each time a turn finishes — that's
  // when `firstMessage` / `messageCount` / `modified` change in pi's
  // JSONL files. Cheap (~ a directory scan). The status refresh also
  // syncs `thinkingLevel` in case it was changed mid-stream by the
  // runtime.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      void refreshSessions();
      void refreshStatus();
    }
    wasStreamingRef.current = streaming;
  }, [streaming, refreshSessions, refreshStatus]);

  return {
    messages,
    streaming,
    sessionId,
    models,
    currentModel,
    sessions,
    sessionsLoading,
    showSessionPanel,
    currentSessionFile,
    // U0 (revised): thinking — user intent first, model metadata
    // only used as a fallback hint.
    thinkingLevel,
    thinkingHint,
    changeThinkingLevel,
    dismissThinkingHint,
    // U0.5: which OpenAI-compatible endpoint we're actually hitting.
    apiMode,
    // U3 + bundled-bash: bash availability + source for the banner.
    // `bashAvailable` is `null` while we wait for the first status
    // response. `bashSource` tells the banner whether bash came from
    // the system (user has Git installed), our bundled MinGit, or
    // nowhere (banner is shown).
    bashAvailable,
    bashSource,
    // Force-rescan after the user has just finished installing Git
    // for Windows in a separate process — saves them from restarting
    // IPM. Returns the fresh `{ available, source }` snapshot and
    // also pushes the new values into our local state.
    rescanBash: useCallback(async () => {
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
    }, []),
    // U1: dynamic workspace.
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
    loadModels,
    setShowSessionPanel,
    refreshSessions,
    openSession,
    deleteSession,
    forkSession,
    // U4: steer / followUp interaction.
    streamingMode,
    setStreamingMode,
    pendingSteer,
    pendingFollowUp,
    steerMessage,
    followUpMessage,
    clearQueue: clearQueueAction,
    // U5: compaction + retry visibility.
    contextUsage,
    // U8a: cumulative session statistics (tokens-only, no cost).
    sessionStats,
    compacting,
    compactionReason,
    retrying,
    compactSession,
    // U6: persistent sub-agent kill-switch.
    subAgentEnabled,
    toggleSubAgent,
  };
}
