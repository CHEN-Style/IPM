import { useState, useEffect, useCallback, useRef } from 'react';

function updateToolInHistory(messages, fromStatus, toStatus, result, extra = {}) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tools?.some((t) => t.status === fromStatus)) {
      const updatedTools = msg.tools.map((t) =>
        t.status === fromStatus
          ? { ...t, status: toStatus, ...(result !== undefined ? { result } : {}), ...extra }
          : t,
      );
      return [...messages.slice(0, i), { ...msg, tools: updatedTools }, ...messages.slice(i + 1)];
    }
  }
  return messages;
}

function ensureStreamingMessage(messages) {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last?.streaming) return messages;
  return [...messages, { role: 'assistant', content: '', streaming: true, tools: [], ts: Date.now() }];
}

export default function useKnowClawChat() {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [listSessionId, setListSessionId] = useState(null);
  const [isReadonly, setIsReadonly] = useState(false);
  const [autonomousMode, setAutonomousModeState] = useState(false);
  const streamBufferRef = useRef('');
  const toolEventsRef = useRef([]);
  const resumingRef = useRef(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    const unsub = window.ipm?.supervisor?.onStreamEvent?.((event) => {
      if (event.type === 'token') {
        streamBufferRef.current += event.content;
        setMessages((prev) => {
          const updated = ensureStreamingMessage(prev);
          const last = updated[updated.length - 1];
          return [
            ...updated.slice(0, -1),
            { ...last, content: streamBufferRef.current },
          ];
        });
      } else if (event.type === 'tool-start') {
        if (resumingRef.current) return;

        toolEventsRef.current.push({ type: 'tool-start', name: event.name, args: event.args });
        setMessages((prev) => {
          const updated = ensureStreamingMessage(prev);
          const last = updated[updated.length - 1];
          return [
            ...updated.slice(0, -1),
            { ...last, tools: [...(last.tools || []), { name: event.name, args: event.args, status: 'running' }] },
          ];
        });
      } else if (event.type === 'tool-end') {
        if (resumingRef.current) {
          const mode = resumingRef.current;
          resumingRef.current = null;

          if (mode === 'confirm') {
            setMessages((prev) => {
              const extra = {};
              if (event.undoActionId) extra.undoActionId = event.undoActionId;
              const withUpdate = updateToolInHistory(prev, 'confirmed', 'done', event.result, extra);
              return ensureStreamingMessage(withUpdate);
            });
          } else {
            setMessages((prev) => ensureStreamingMessage(prev));
          }
          return;
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last?.streaming && last.tools?.length) {
            const updatedTools = last.tools.map((t) =>
              t.name === event.name && t.status === 'running'
                ? { ...t, status: 'done', result: event.result, ...(event.undoActionId ? { undoActionId: event.undoActionId } : {}) }
                : t,
            );
            return [...prev.slice(0, -1), { ...last, tools: updatedTools }];
          }
          return prev;
        });
      } else if (event.type === 'interrupt') {
        const finalText = streamBufferRef.current;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last?.streaming) {
            const updatedTools = last.tools?.map((t) =>
              t.status === 'running' ? { ...t, status: 'interrupted' } : t,
            );
            return [
              ...prev.slice(0, -1),
              { ...last, content: finalText, streaming: false, tools: updatedTools },
            ];
          }
          return prev;
        });

        setPendingPlan(event.plan);
        streamBufferRef.current = '';
        toolEventsRef.current = [];
        setStreaming(false);
      } else if (event.type === 'done') {
        const finalText = streamBufferRef.current;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last?.streaming) {
            if (!finalText && (!last.tools || last.tools.length === 0)) {
              return prev.slice(0, -1);
            }
            return [
              ...prev.slice(0, -1),
              { ...last, content: finalText, streaming: false },
            ];
          }
          return prev;
        });

        streamBufferRef.current = '';
        toolEventsRef.current = [];
        setStreaming(false);
      }

      if (event.type === 'error') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.streaming) {
            return [
              ...prev.slice(0, -1),
              { role: 'system', content: `KnowClaw 错误: ${event.error || '未知错误'}`, ts: Date.now() },
            ];
          }
          return [...prev, { role: 'system', content: `KnowClaw 错误: ${event.error || '未知错误'}`, ts: Date.now() }];
        });
        streamBufferRef.current = '';
        toolEventsRef.current = [];
        resumingRef.current = null;
        setStreaming(false);
      }

      if (event.sessionId && !sessionId) {
        setSessionId(event.sessionId);
      }
    });

    return () => { unsub?.(); };
  }, [sessionId]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming || isReadonly) return;

    const userMsg = { role: 'user', content: text.trim(), ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    streamBufferRef.current = '';
    toolEventsRef.current = [];
    setStreaming(true);

    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', streaming: true, tools: [], ts: Date.now() },
    ]);

    try {
      const result = await window.ipm?.supervisor?.sendMessage?.(text.trim());
      if (result?.sessionId) setSessionId(result.sessionId);
      if (!result?.ok) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.streaming) {
            return [
              ...prev.slice(0, -1),
              { role: 'system', content: `错误: ${result?.error || '未知错误'}`, ts: Date.now() },
            ];
          }
          return [...prev, { role: 'system', content: `错误: ${result?.error || '未知错误'}`, ts: Date.now() }];
        });
        setStreaming(false);
      }
    } catch (e) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.streaming) {
          return [
            ...prev.slice(0, -1),
            { role: 'system', content: `发送失败: ${e.message}`, ts: Date.now() },
          ];
        }
        return [...prev, { role: 'system', content: `发送失败: ${e.message}`, ts: Date.now() }];
      });
      setStreaming(false);
    }
  }, [streaming, isReadonly]);

  const executePlan = useCallback(async (plan, selectedIndices) => {
    if (!plan) return null;

    resumingRef.current = 'confirm';
    setPendingPlan(null);
    streamBufferRef.current = '';
    toolEventsRef.current = [];
    setStreaming(true);
    setMessages((prev) => updateToolInHistory(prev, 'interrupted', 'confirmed'));

    try {
      const result = await window.ipm?.supervisor?.executePlan?.(plan, selectedIndices);
      if (!result?.ok) {
        resumingRef.current = null;
        setMessages((prev) => [...prev, { role: 'system', content: `执行失败: ${result?.error || '未知错误'}`, ts: Date.now() }]);
        setStreaming(false);
      }
      return result;
    } catch (e) {
      resumingRef.current = null;
      setMessages((prev) => [...prev, { role: 'system', content: `执行出错: ${e.message}`, ts: Date.now() }]);
      setStreaming(false);
      return null;
    }
  }, []);

  const cancelPlan = useCallback(async () => {
    resumingRef.current = 'cancel';
    setPendingPlan(null);
    streamBufferRef.current = '';
    toolEventsRef.current = [];
    setStreaming(true);
    setMessages((prev) => updateToolInHistory(prev, 'interrupted', 'cancelled'));

    try {
      await window.ipm?.supervisor?.cancelPlan?.();
    } catch {
      resumingRef.current = null;
      setStreaming(false);
    }
  }, []);

  const endSession = useCallback(async () => {
    try {
      await window.ipm?.supervisor?.endSession?.();
    } catch { /* ignore */ }
    setMessages([]);
    setSessionId(null);
    setListSessionId(null);
    setPendingPlan(null);
    setStreaming(false);
    setIsReadonly(false);
  }, []);

  const loadHistorySession = useCallback(async (targetSessionId) => {
    if (!targetSessionId) return;
    const myLoadId = ++loadIdRef.current;
    try {
      const res = await window.ipm?.supervisor?.loadSession?.(targetSessionId);
      if (loadIdRef.current !== myLoadId) return;
      if (!res?.ok) {
        setMessages([{ role: 'system', content: '加载历史对话失败', ts: Date.now() }]);
        return;
      }
      const loaded = (res.messages || []).map((m) => ({
        role: m.role,
        content: m.content || '',
        tools: m.tools || [],
        ts: new Date(m.createdAt).getTime(),
      }));
      setMessages(loaded);
      setSessionId(targetSessionId);
      setListSessionId(targetSessionId);
      setPendingPlan(null);
      setStreaming(false);
      setIsReadonly(false);

      window.ipm?.supervisor?.resumeSession?.(targetSessionId)
        .then((r) => {
          if (loadIdRef.current !== myLoadId) return;
          if (r?.ok) setSessionId(r.sessionId || targetSessionId);
        })
        .catch(() => {});
    } catch {
      if (loadIdRef.current !== myLoadId) return;
      setMessages([{ role: 'system', content: '加载历史对话失败', ts: Date.now() }]);
    }
  }, []);

  const startNewSession = useCallback(async () => {
    await endSession();
    setIsReadonly(false);
  }, [endSession]);

  const toggleAutonomousMode = useCallback(async () => {
    const next = !autonomousMode;
    try {
      await window.ipm?.supervisor?.setAutonomousMode?.(next);
      setAutonomousModeState(next);
    } catch { /* ignore */ }
  }, [autonomousMode]);

  return {
    messages,
    streaming,
    pendingPlan,
    sessionId,
    listSessionId,
    isReadonly,
    autonomousMode,
    sendMessage,
    executePlan,
    cancelPlan,
    endSession,
    loadHistorySession,
    startNewSession,
    toggleAutonomousMode,
  };
}
