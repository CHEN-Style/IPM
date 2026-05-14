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

  const streamBufferRef = useRef('');
  // Each time `sendMessage` is invoked we bump this counter so that
  // late-arriving events from a previous turn cannot mutate the wrong
  // assistant placeholder.
  const turnIdRef = useRef(0);

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
          }
          // text_end: no-op (agent_end will finalize streaming flag)
          break;
        }

        case 'tool_execution_start': {
          const toolCallId = event.toolCallId || `${event.toolName || 'tool'}-${Date.now()}`;
          const name = event.toolName || 'tool';
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

        case 'tool_execution_end': {
          const toolCallId = event.toolCallId;
          if (!toolCallId) break;
          const result = stringifyResult(event.result);
          const status = event.isError ? 'error' : 'done';
          setMessages((prev) =>
            updateToolByCallId(prev, toolCallId, { status, result }),
          );
          break;
        }

        case 'agent_end': {
          const finalText = streamBufferRef.current;
          streamBufferRef.current = '';
          setStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              // Drop empty placeholder with no tools and no text.
              if (!finalText && (!last.tools || last.tools.length === 0)) {
                return prev.slice(0, -1);
              }
              return [
                ...prev.slice(0, -1),
                { ...last, content: finalText || last.content, streaming: false },
              ];
            }
            return prev;
          });
          break;
        }

        case 'error': {
          const errText = event.error || event.message || '未知错误';
          streamBufferRef.current = '';
          setStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const sys = { role: 'system', content: `KnowClaw 错误: ${errText}`, ts: Date.now() };
            if (last?.role === 'assistant' && last?.streaming && !last.content && (!last.tools || last.tools.length === 0)) {
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
          setMessages(restored);
          if (event.sessionFile) setCurrentSessionFile(event.sessionFile);
          break;
        }

        default:
          // Ignored event types: turn_start, turn_end, message_start,
          // message_end, queue_update, compaction_*, thinking_*, etc.
          break;
      }
    });

    return () => { off?.(); };
  }, [sessionId]);

  // --- Actions ---

  const sendMessage = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || streaming) return;

    turnIdRef.current += 1;
    streamBufferRef.current = '';
    setStreaming(true);

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed, ts: Date.now() },
      { role: 'assistant', content: '', streaming: true, tools: [], ts: Date.now() },
    ]);

    try {
      const res = await window.ipm?.knowclaw?.send?.(trimmed);
      if (res?.sessionId) setSessionId(res.sessionId);
      if (!res?.ok) {
        const errText = res?.error || '发送失败';
        streamBufferRef.current = '';
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
      setStreaming(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const sys = { role: 'system', content: `发送失败: ${err?.message || err}`, ts: Date.now() };
        if (last?.streaming) return [...prev.slice(0, -1), sys];
        return [...prev, sys];
      });
    }
  }, [streaming]);

  const abort = useCallback(async () => {
    try {
      await window.ipm?.knowclaw?.abort?.();
    } catch { /* ignore */ }
    // `agent_end` will normally fire after abort; we still proactively
    // close the streaming flag so the input box is enabled immediately.
    setStreaming(false);
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
    try {
      const res = await window.ipm?.knowclaw?.openSession?.(sessionFile);
      if (res?.ok) {
        if (res.sessionId) setSessionId(res.sessionId);
        if (res.sessionFile) setCurrentSessionFile(res.sessionFile);
        // history_loaded event will arrive immediately and populate
        // the transcript; we don't pre-clear here to avoid a flash of
        // empty state.
      }
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [streaming]);

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

  // Auto-load models + sessions on mount.
  useEffect(() => {
    void loadModels();
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also refresh the session list each time a turn finishes — that's
  // when `firstMessage` / `messageCount` / `modified` change in pi's
  // JSONL files. Cheap (~ a directory scan).
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      void refreshSessions();
    }
    wasStreamingRef.current = streaming;
  }, [streaming, refreshSessions]);

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
  };
}
