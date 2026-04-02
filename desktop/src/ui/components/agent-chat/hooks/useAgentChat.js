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

export default function useAgentChat(projectName, domain) {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  /** chat_sessions 行 id；续聊时 LangGraph threadId 与列表 id 不同，用此与历史列表对齐 */
  const [listSessionId, setListSessionId] = useState(null);
  const [isReadonly, setIsReadonly] = useState(false);
  const streamBufferRef = useRef('');
  const toolEventsRef = useRef([]);
  const resumingRef = useRef(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (!projectName) return;

    const unsub = window.ipm?.agent?.onStreamEvent?.((event) => {
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
              { role: 'system', content: `Agent 错误: ${event.error || '未知错误'}`, ts: Date.now() },
            ];
          }
          return [...prev, { role: 'system', content: `Agent 错误: ${event.error || '未知错误'}`, ts: Date.now() }];
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
  }, [projectName, sessionId]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || !projectName || streaming || isReadonly) return;

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
      const result = await window.ipm?.agent?.sendMessage?.(projectName, domain, text.trim());
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
  }, [projectName, domain, streaming, isReadonly]);

  const executePlan = useCallback(async (plan, selectedIndices) => {
    if (!projectName || !plan) return null;

    resumingRef.current = 'confirm';
    setPendingPlan(null);
    streamBufferRef.current = '';
    toolEventsRef.current = [];
    setStreaming(true);
    setMessages((prev) => updateToolInHistory(prev, 'interrupted', 'confirmed'));

    try {
      const result = await window.ipm?.agent?.executePlan?.(projectName, domain, plan, selectedIndices);
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
  }, [projectName, domain]);

  const cancelPlan = useCallback(async () => {
    if (!projectName) return;

    resumingRef.current = 'cancel';
    setPendingPlan(null);
    streamBufferRef.current = '';
    toolEventsRef.current = [];
    setStreaming(true);
    setMessages((prev) => updateToolInHistory(prev, 'interrupted', 'cancelled'));

    try {
      await window.ipm?.agent?.cancelPlan?.(projectName, domain);
    } catch {
      resumingRef.current = null;
      setStreaming(false);
    }
  }, [projectName, domain]);

  const endSession = useCallback(async () => {
    if (!projectName) return;
    try {
      await window.ipm?.agent?.endSession?.(projectName, domain);
    } catch { /* ignore */ }
    setMessages([]);
    setSessionId(null);
    setListSessionId(null);
    setPendingPlan(null);
    setStreaming(false);
    setIsReadonly(false);
  }, [projectName, domain]);

  const loadHistorySession = useCallback(async (targetSessionId) => {
    if (!projectName || !targetSessionId) return;
    const myLoadId = ++loadIdRef.current;
    try {
      const res = await window.ipm?.agent?.loadSession?.(projectName, domain, targetSessionId);
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

      window.ipm?.agent?.resumeSession?.(projectName, domain, targetSessionId)
        .then((r) => {
          if (loadIdRef.current !== myLoadId) return;
          if (r?.ok) setSessionId(r.sessionId || targetSessionId);
        })
        .catch(() => {});
    } catch {
      if (loadIdRef.current !== myLoadId) return;
      setMessages([{ role: 'system', content: '加载历史对话失败', ts: Date.now() }]);
    }
  }, [projectName, domain]);

  const startNewSession = useCallback(async () => {
    await endSession();
    setIsReadonly(false);
  }, [endSession]);

  return {
    messages,
    streaming,
    pendingPlan,
    sessionId,
    listSessionId,
    isReadonly,
    sendMessage,
    executePlan,
    cancelPlan,
    endSession,
    loadHistorySession,
    startNewSession,
  };
}
