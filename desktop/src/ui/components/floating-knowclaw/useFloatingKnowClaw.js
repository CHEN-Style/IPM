// desktop/src/ui/components/floating-knowclaw/useFloatingKnowClaw.js
//
// FK1: floating-window KnowClaw conversation hook.
//
// This is a deliberately slimmed-down counterpart to the main-window
// `useKnowClawPersist` (App-level Context Provider). The floating
// window's UI surface is much smaller (no workspace selector, no
// Plan mode, no sub-agent toggle, no file-ref expansion, no
// historical-session drawer in FK1), and the React tree itself is
// short-lived: the user toggles into KnowClaw mode, types a
// question or two, sees the answer in the external bubble (FK2),
// and toggles back to Vault. So we drop the Provider abstraction
// and own state locally inside the `KnowClawFloating` component.
//
// The hook subscribes to `knowclawFloating.onEvent` once on mount.
// Because the main process routes events via `ch.sender.send(...)`
// where `ch.sender` is bound to the floating window's WebContents,
// this renderer naturally only receives floating-channel events —
// the main window's KnowClaw stream stays on its own listener.
//
// FK1 scope (intentional non-goals):
//   - No external bubble window — assistant content stays in the
//     local `messages` state. FK2 will add the bubble window and
//     mirror messages into it when the panel is in compact mode.
//   - No internal expanded chat list — FK3 builds the inline
//     message list component; FK1 just records messages so the
//     event flow is validated end-to-end via console + (later)
//     ad-hoc devtools inspection.
//   - No streaming-stdout tool partial-result handling — small
//     surface, low value for the quick-ask use case; can be added
//     in FK3 alongside the chat list.

import { useCallback, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  ensureStreamingMessage,
  stringifyResult,
  updateToolByCallId,
  summarizeToolArgs,
} from '../knowclaw-v2/knowclawEventReducer.js';
import { resizeImageToBase64 } from '../agent-chat/imageResize.js';

// FK4: prompt prefixed to vision-mode capture summaries. Same wording as
// the upgrade plan; kept terse so non-vision OCR-text turns can wrap
// it without confusing the model.
const CAPTURE_SUMMARY_PROMPT =
  '请用 2~4 段话总结这张截图的核心信息，突出关键事实与可执行结论。';

// FK5: prompt prefix when the user clicks "追问 AI" on an OcrResultCard.
// We inject the OCR text into the input as a markdown quote block; the
// user adds their own question on top before sending.
function formatOcrQuoteBlock(text, when = new Date()) {
  const lines = String(text || '').split(/\r?\n/);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + ` ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const quoted = lines.map((l) => `> ${l}`).join('\n');
  return `> [OCR 提取于 ${stamp}]\n${quoted}\n\n`;
}

// FK4: probe the floating channel's active model for vision capability.
// We rely on the same `input` array the main-window KnowClaw v2 page
// inspects (`active.input.includes('image')`). Returns `false` on any
// error so we always have a safe degraded path.
async function floatingModelSupportsVision() {
  try {
    const res = await window.ipm?.knowclaw?.listModels?.();
    if (!res?.ok || !Array.isArray(res.models)) return false;
    const active = res.models.find((m) => m?.active);
    return Array.isArray(active?.input) && active.input.includes('image');
  } catch {
    return false;
  }
}

// FK4: turn a raw PNG buffer (from desktopCapturer / clipboard) into a
// base64 JPEG suitable for `knowclawFloating.send(text, images)`.
// Reuses the existing main-window resize helper so vision payloads
// share the same 2048-edge, 0.85-quality JPEG profile.
async function pngBufferToVisionPayload(pngBuffer) {
  if (!pngBuffer) return null;
  const blob = new Blob([pngBuffer], { type: 'image/png' });
  const { mimeType, data } = await resizeImageToBase64(blob, {
    maxEdge: 2048,
    jpegQuality: 0.85,
  });
  return { mimeType, data };
}

// FK4: produce a small thumbnail dataURL for the preview card. We
// stay in PNG (no re-encode) to keep this cheap; the preview is shown
// at ~74px height so the raw screenshot fits the slot just fine when
// CSS `object-fit: cover` clips it.
function pngBufferToObjectUrl(pngBuffer) {
  if (!pngBuffer) return '';
  const blob = new Blob([pngBuffer], { type: 'image/png' });
  return URL.createObjectURL(blob);
}

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdownForBubble(text) {
  if (!text) return '';
  try { return marked.parse(text); } catch { return text.replace(/\n/g, '<br/>'); }
}

export default function useFloatingKnowClaw({ expanded = false } = {}) {
  // ----- Conversation state -----
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);

  // ----- FK3: session lifecycle + settings state -----
  const [sessions, setSessions] = useState([]);
  const [thinkingLevel, setThinkingLevelState] = useState('off');

  // ----- FK4: capture preview (📷 screenshot summary flow) -----
  //
  // `capturePreview.visible` gates the CapturePreviewCard render in
  // KnowClawFloating. The card holds the screenshot until the user
  // explicitly clicks "发送给 AI 总结", "仅 OCR", or "取消" — there
  // is no auto-send countdown (per user decision recorded in the
  // FK4/FK5 plan). OCR runs in the background while the card is
  // visible so the "仅 OCR" path doesn't have to wait again.
  const [capturePreview, setCapturePreview] = useState({
    visible: false,
    thumbUrl: '',
    width: 0,
    height: 0,
    pngBuffer: null,
    ocrResult: null,    // { text, confidence, lines }
    ocrRunning: false,
    saving: false,
  });

  // ----- FK5: OCR result card state -----
  const [ocrResultCard, setOcrResultCard] = useState({
    visible: false,
    text: '',
    confidence: 0,
    charCount: 0,
    source: 'clipboard',   // 'clipboard' | 'capture'
  });

  // ----- FK4: last OCR text shipped alongside the most recent assistant
  // turn so the external bubble can render a "复制 OCR 原文" button.
  // Cleared when the next user turn starts or a new session begins.
  const lastOcrTextRef = useRef('');

  // Mirror the streaming text in a ref so out-of-order deltas (rare
  // but possible under hot-reload / abort race) accumulate into the
  // same assistant bubble we surface in `messages`. The reducer
  // helpers operate on the array; the ref tracks the canonical
  // streaming buffer separately so we never lose a delta.
  const streamBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  const sessionIdRef = useRef(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // ----- Cold-start rehydrate -----
  //
  // If the floating channel already has a live session (e.g. the
  // user pressed Ctrl+Shift+Space mid-turn and the renderer just
  // re-mounted), pull its transcript + streaming flag back into the
  // hook so the panel doesn't look empty. No-op when the channel
  // is fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.knowclawFloating?.rehydrate?.();
        if (cancelled || !res?.ok || !res.hasSession) return;
        setSessionId(res.sessionId || null);
        if (Array.isArray(res.messages)) setMessages(res.messages);
        if (typeof res.streaming === 'boolean') setStreaming(res.streaming);
      } catch {
        // Non-fatal: an unconfigured LLM or first-launch race lands here.
        // The user will see an empty panel and can simply send a message.
      }
      // FK3: read current thinking level from the floating channel
      try {
        const status = await window.ipm?.knowclawFloating?.getStatus?.();
        if (!cancelled && status?.ok && status.thinkingLevel) {
          setThinkingLevelState(status.thinkingLevel);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ----- Event listener -----
  //
  // One stable subscription per mount. We deliberately do NOT depend
  // on `messages` / `streaming` so the listener isn't torn down and
  // re-bound on every state change (which would lose any in-flight
  // events delivered during the gap). All state updates use the
  // functional setter form, so reading the latest `messages` is
  // always safe.
  useEffect(() => {
    const off = window.ipm?.knowclawFloating?.onEvent?.((event) => {
      if (!event || typeof event !== 'object') return;

      // Track sessionId via ref to avoid relisten churn.
      if (event.sessionId && event.sessionId !== sessionIdRef.current) {
        sessionIdRef.current = event.sessionId;
        setSessionId(event.sessionId);
      }

      switch (event.type) {
        case 'agent_start': {
          setStreaming(true);
          setError(null);
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
            const buffered = streamBufferRef.current;
            setMessages((prev) => {
              const updated = ensureStreamingMessage(prev);
              const last = updated[updated.length - 1];
              return [
                ...updated.slice(0, -1),
                { ...last, content: buffered },
              ];
            });
          } else if (sub.type === 'thinking_delta') {
            const delta = sub.delta || '';
            if (!delta) break;
            thinkingBufferRef.current += delta;
            const buffered = thinkingBufferRef.current;
            setMessages((prev) => {
              const updated = ensureStreamingMessage(prev);
              const last = updated[updated.length - 1];
              return [
                ...updated.slice(0, -1),
                { ...last, thinking: buffered },
              ];
            });
          }
          break;
        }

        case 'tool_execution_start': {
          const toolCallId = event.toolCallId || `${event.toolName || 'tool'}-${Date.now()}`;
          const name = event.toolName || 'tool';
          const summary = summarizeToolArgs(name, event.args);
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

        case 'tool_execution_end': {
          const toolCallId = event.toolCallId;
          if (!toolCallId) break;
          const result = stringifyResult(event.result);
          const status = event.isError ? 'error' : 'done';
          setMessages((prev) =>
            updateToolByCallId(prev, toolCallId, {
              status,
              result,
              endTime: Date.now(),
            }),
          );
          break;
        }

        case 'agent_end': {
          // Flush whatever the in-flight buffers have collected and
          // finalize the streaming assistant bubble. Empty turns get
          // dropped so the panel doesn't end with a phantom row.
          const finalText = streamBufferRef.current;
          const finalThinking = thinkingBufferRef.current;
          streamBufferRef.current = '';
          thinkingBufferRef.current = '';
          setStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
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

        case 'history_loaded': {
          // Pushed after openSession / forkSession (FK3+). For FK1 we
          // rarely receive these — `newSession` doesn't trigger one —
          // but keep the handler for forward compatibility.
          if (Array.isArray(event.messages)) {
            setMessages(event.messages);
          }
          streamBufferRef.current = '';
          thinkingBufferRef.current = '';
          setStreaming(false);
          break;
        }

        case 'error': {
          // Surface so the panel can render a small inline error
          // chip in later phases. For FK1 we just record + log.
          setError(String(event.error || 'unknown error'));
          // eslint-disable-next-line no-console
          console.warn('[KnowClawFloating] event error:', event);
          setStreaming(false);
          break;
        }

        default:
          // turn_start / queue_update / compaction_* / etc. — FK1
          // ignores; FK3 can opt in when the inline chat list is
          // built and needs the richer signals.
          break;
      }
    });
    return () => { off?.(); };
  }, []);

  // ----- Actions -----

  // FK4: extended signature `sendMessage(text, opts?)` where
  //   opts.images   → forwarded to `knowclawFloating.send(text, images)`
  //   opts.ocrText  → cached for the bubble's "复制 OCR 原文" button
  //   opts.attachments → metadata-only marker for the optimistic user bubble
  // Legacy `sendMessage(text)` calls keep working — the second arg is
  // optional and `images` defaults to undefined (main process treats
  // missing as `[]`).
  const sendMessage = useCallback(async (rawText, opts = {}) => {
    const text = String(rawText ?? '').trim();
    const images = Array.isArray(opts.images) ? opts.images : undefined;
    const ocrTextForBubble = typeof opts.ocrText === 'string' ? opts.ocrText : '';
    const attachments = Array.isArray(opts.attachments) ? opts.attachments : undefined;

    if (!text && (!images || images.length === 0)) {
      return { ok: false, error: 'empty message' };
    }

    // Stash OCR text *before* the assistant stream so the FK4-6 bubble
    // effect can pick it up as soon as the first assistant text_delta
    // lands. Clear it when sending a plain text turn so stale OCR from
    // a previous capture doesn't leak into the next bubble.
    lastOcrTextRef.current = ocrTextForBubble || '';

    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: text || (images && images.length ? '[图片]' : ''),
        ts: Date.now(),
        ...(attachments ? { attachments } : {}),
      },
    ]);
    setStreaming(true);
    setError(null);
    streamBufferRef.current = '';
    thinkingBufferRef.current = '';
    try {
      const res = await window.ipm?.knowclawFloating?.send?.(text, images);
      if (!res?.ok) {
        setStreaming(false);
        setError(res?.error || 'send failed');
        return res || { ok: false, error: 'no ipc bridge' };
      }
      return res;
    } catch (err) {
      setStreaming(false);
      const msg = String(err?.message || err);
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  const abort = useCallback(async () => {
    try {
      await window.ipm?.knowclawFloating?.abort?.();
    } catch { /* best-effort */ }
  }, []);

  const newSession = useCallback(async () => {
    setMessages([]);
    setStreaming(false);
    setError(null);
    streamBufferRef.current = '';
    thinkingBufferRef.current = '';
    lastOcrTextRef.current = '';
    // FK2: hide bubble on new session
    window.ipm?.bubble?.hide?.();
    try {
      const res = await window.ipm?.knowclawFloating?.newSession?.();
      if (res?.ok && res.sessionId) {
        setSessionId(res.sessionId);
      } else if (res && !res.ok) {
        setError(res.error || 'failed to create session');
      }
      return res;
    } catch (err) {
      const msg = String(err?.message || err);
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  // ----- FK3: session lifecycle actions -----

  const listSessions = useCallback(async () => {
    try {
      const res = await window.ipm?.knowclawFloating?.listSessions?.();
      if (res?.ok && Array.isArray(res.sessions)) {
        setSessions(res.sessions);
        return res.sessions;
      }
      return [];
    } catch { return []; }
  }, []);

  const openSession = useCallback(async (sessionFile) => {
    if (!sessionFile) return { ok: false, error: 'no session file' };
    streamBufferRef.current = '';
    thinkingBufferRef.current = '';
    setStreaming(false);
    setError(null);
    try {
      const res = await window.ipm?.knowclawFloating?.openSession?.(sessionFile);
      if (res?.ok && res.sessionId) {
        setSessionId(res.sessionId);
      }
      return res || { ok: false };
    } catch (err) {
      const msg = String(err?.message || err);
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  const deleteSession = useCallback(async (sessionFile) => {
    try {
      const res = await window.ipm?.knowclawFloating?.deleteSession?.(sessionFile);
      if (res?.ok) {
        setSessions((prev) => prev.filter((s) => s.path !== sessionFile));
      }
      return res || { ok: false };
    } catch { return { ok: false }; }
  }, []);

  const setThinkingLevel = useCallback(async (level) => {
    setThinkingLevelState(level);
    try {
      await window.ipm?.knowclawFloating?.setThinkingLevel?.(level);
    } catch { /* best-effort */ }
  }, []);

  const steer = useCallback(async (rawText) => {
    const text = String(rawText ?? '').trim();
    if (!text) return { ok: false, error: 'empty message' };
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, kind: 'steer', ts: Date.now() },
    ]);
    setStreaming(true);
    setError(null);
    streamBufferRef.current = '';
    thinkingBufferRef.current = '';
    try {
      const res = await window.ipm?.knowclawFloating?.steer?.(text);
      if (!res?.ok) {
        setStreaming(false);
        setError(res?.error || 'steer failed');
      }
      return res || { ok: false };
    } catch (err) {
      setStreaming(false);
      const msg = String(err?.message || err);
      setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

  // ----- FK2: external bubble integration -----
  //
  // When the panel is in compact mode (not expanded) and an assistant
  // message is streaming or has just finished, push the rendered HTML
  // to the external bubble window. When the panel is expanded, hide
  // the bubble so users see messages inline instead.
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  useEffect(() => {
    if (expanded) {
      window.ipm?.bubble?.hide?.();
      return;
    }
    const last = messages[messages.length - 1];

    // FK7-1: when the AI request errored out and there is no
    // streaming assistant content to show, surface the error inside
    // the bubble too — the inline chip is small and easy to miss
    // when the user has the floating window collapsed. We render a
    // muted "请求失败" block so it visually reads as an error rather
    // than a normal answer.
    if (!streaming && error && (!last || last.role !== 'assistant' || !last.content)) {
      const errHtml = `
        <div style="
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(244, 63, 94, 0.25);
          background: rgba(254, 226, 226, 0.45);
          color: #b91c1c;
          font-size: 12px;
          line-height: 1.55;
        ">
          <div style="font-weight: 700; margin-bottom: 4px;">KnowClaw 请求失败</div>
          <div>${String(error).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</div>
        </div>
      `;
      window.ipm?.bubble?.setContent?.(errHtml, false, '');
      return;
    }

    if (!last || last.role !== 'assistant') return;
    const html = renderMarkdownForBubble(last.content || '');
    if (!html && !streaming) return;

    // FK4-6: pass `ocrText` (captured during a `triggerCaptureSummary`
    // turn) so BubbleView can render a "复制 OCR 原文" button. While
    // streaming we omit it to avoid the button flashing in mid-turn;
    // we re-send the full payload once the assistant finishes.
    const ocrText = streaming ? '' : (lastOcrTextRef.current || '');
    if (streaming) {
      window.ipm?.bubble?.show?.(html, true, '');
    } else if (html) {
      window.ipm?.bubble?.setContent?.(html, false, ocrText);
    }
  }, [messages, streaming, expanded, error]);

  // Listen for "expand request" from the bubble window (user clicked
  // "展开到悬浮窗内"). We can't directly set expanded here (that lives
  // in KnowClawFloating), so we expose a callback ref the parent can
  // subscribe to.
  const expandRequestRef = useRef(null);
  useEffect(() => {
    const off = window.ipm?.bubble?.onExpandRequest?.(() => {
      expandRequestRef.current?.();
    });
    return () => off?.();
  }, []);

  // ----- FK4: capture preview helpers -----
  //
  // Internal helper: run OCR on a PNG buffer and store the result on
  // `capturePreview`. Awaiting the same in-flight OCR twice is safe —
  // we keep a tiny ref-based dedupe so `confirmCaptureSummary` can
  // start a turn the instant the user clicks, even before OCR
  // finishes.
  const ocrInFlightRef = useRef(null);
  const runOcrOnPng = useCallback(async (pngBuffer) => {
    if (!pngBuffer) return null;
    if (ocrInFlightRef.current) return ocrInFlightRef.current;
    const promise = (async () => {
      try {
        const res = await window.ipm?.ocr?.recognizeBuffer?.(pngBuffer, { lang: 'ch' });
        if (res?.ok && res.result) {
          return {
            text: String(res.result.text || ''),
            confidence: Number(res.result.confidence || 0),
            lines: Array.isArray(res.result.lines) ? res.result.lines : [],
          };
        }
        return null;
      } catch {
        return null;
      }
    })();
    ocrInFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      ocrInFlightRef.current = null;
    }
  }, []);

  // Internal helper: release the previous thumbnail's object URL before
  // overwriting the preview state, so we don't leak blob refs across
  // back-to-back captures.
  const setCapturePreviewSafely = useCallback((updater) => {
    setCapturePreview((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next?.thumbUrl !== prev.thumbUrl && prev.thumbUrl) {
        try { URL.revokeObjectURL(prev.thumbUrl); } catch { /* ignore */ }
      }
      return next;
    });
  }, []);

  const dismissCapturePreview = useCallback(() => {
    setCapturePreviewSafely({
      visible: false,
      thumbUrl: '',
      width: 0,
      height: 0,
      pngBuffer: null,
      ocrResult: null,
      ocrRunning: false,
      saving: false,
    });
  }, [setCapturePreviewSafely]);

  const triggerCaptureSummary = useCallback(async () => {
    if (capturePreview.visible || streaming) return;
    setError(null);
    try {
      const cap = await window.ipm?.capture?.fullScreen?.();
      if (!cap?.ok) {
        const code = cap?.error || 'capture_failed';
        if (code === 'screen_permission_denied') {
          // FK7-1: platform-aware guidance so the user knows the
          // exact path to fix permissions instead of just hitting
          // a wall. We sniff `navigator.platform` (Electron stable)
          // because `process.platform` is not exposed via preload.
          const plat = (typeof navigator !== 'undefined' && navigator.platform) || '';
          if (/Mac/i.test(plat)) {
            setError('未获得屏幕录制权限。请到「系统设置 → 隐私与安全性 → 屏幕录制」中勾选 IPM，然后重启应用重试。');
          } else if (/Win/i.test(plat)) {
            setError('截屏权限被拒绝。请确认安全软件 / 任务管理器未阻止 IPM，或改用 Win+Shift+S 截图后让 KnowClaw 调用「OCR 提取」。');
          } else {
            setError('未获得屏幕录制权限，请在系统设置中授权后重试');
          }
        } else {
          setError('截屏失败，请重试');
        }
        return;
      }
      const pngBuffer = cap.pngBuffer;
      const thumbUrl = pngBufferToObjectUrl(pngBuffer);
      setCapturePreviewSafely({
        visible: true,
        thumbUrl,
        width: cap.width || 0,
        height: cap.height || 0,
        pngBuffer,
        ocrResult: null,
        ocrRunning: true,
        saving: false,
      });

      // Kick OCR off in the background while the user decides what to
      // do. The result is folded back into `capturePreview.ocrResult`
      // so the "仅 OCR" / "发送给 AI 总结" handlers can pick it up
      // without re-running PaddleOCR.
      runOcrOnPng(pngBuffer).then((ocr) => {
        setCapturePreview((prev) => {
          if (!prev.visible) return prev;
          return { ...prev, ocrResult: ocr, ocrRunning: false };
        });
      });
    } catch (err) {
      setError(String(err?.message || err));
    }
  }, [capturePreview.visible, streaming, runOcrOnPng, setCapturePreviewSafely]);

  const confirmCaptureSummary = useCallback(async () => {
    const snap = capturePreview;
    if (!snap.visible || !snap.pngBuffer) return;

    // Wait for OCR if it's still running so we always have the option
    // to ship OCR text alongside the assistant turn (and to fall back
    // to OCR-only when vision is unavailable).
    let ocr = snap.ocrResult;
    if (!ocr && snap.ocrRunning) {
      setCapturePreview((prev) => ({ ...prev, saving: true }));
      ocr = await runOcrOnPng(snap.pngBuffer);
    }
    const ocrText = ocr?.text || '';

    const supportsVision = await floatingModelSupportsVision();

    // Persist artifacts in parallel so the user doesn't pay the latency
    // on the input → AI path. We don't await; failures land in the
    // console but never block the assistant turn.
    Promise.resolve().then(async () => {
      try {
        await window.ipm?.capture?.saveArtifacts?.({
          pngBuffer: snap.pngBuffer,
          ocrText,
        });
      } catch { /* non-fatal */ }
    });

    // Close the preview BEFORE we kick the send, so the panel returns
    // to the conversation view as the bubble starts streaming.
    dismissCapturePreview();

    if (supportsVision) {
      try {
        const image = await pngBufferToVisionPayload(snap.pngBuffer);
        await sendMessage(CAPTURE_SUMMARY_PROMPT, {
          images: image ? [image] : undefined,
          ocrText,
        });
      } catch (err) {
        setError('图片处理失败：' + String(err?.message || err));
      }
    } else {
      // Vision-less fallback: ship the OCR text as the prompt body and
      // tell the user once that we degraded so they're not surprised.
      const body = ocrText
        ? `以下是从截图 OCR 提取的原文，请总结：\n\n${ocrText}`
        : '截图未能识别出文字内容，请尝试其他方式。';
      setError('当前模型不支持识图，已改用 OCR 文本总结');
      await sendMessage(body, { ocrText });
    }
  }, [capturePreview, runOcrOnPng, sendMessage, dismissCapturePreview]);

  const confirmCaptureOcrOnly = useCallback(async () => {
    const snap = capturePreview;
    if (!snap.visible || !snap.pngBuffer) return;

    let ocr = snap.ocrResult;
    if (!ocr) {
      setCapturePreview((prev) => ({ ...prev, saving: true, ocrRunning: true }));
      ocr = await runOcrOnPng(snap.pngBuffer);
    }
    const ocrText = ocr?.text || '';

    // Persist artifacts so the captures/ folder has a record even when
    // the user only wanted OCR (matches FK4 verification checklist).
    Promise.resolve().then(async () => {
      try {
        await window.ipm?.capture?.saveArtifacts?.({
          pngBuffer: snap.pngBuffer,
          ocrText,
        });
      } catch { /* non-fatal */ }
    });

    dismissCapturePreview();

    // FK5-6: hand the OCR result over to the OcrResultCard (single UI
    // for "OCR-only" outputs, whether the user got here via 📷 or 📋).
    setOcrResultCard({
      visible: true,
      text: ocrText,
      confidence: Number(ocr?.confidence || 0),
      charCount: ocrText.length,
      source: 'capture',
    });
  }, [capturePreview, runOcrOnPng, dismissCapturePreview]);

  // ----- FK5: OCR extract flow -----

  const dismissOcrResult = useCallback(() => {
    setOcrResultCard({ visible: false, text: '', confidence: 0, charCount: 0, source: 'clipboard' });
  }, []);

  const triggerOcrExtract = useCallback(async () => {
    if (ocrResultCard.visible || streaming || capturePreview.visible) return;
    setError(null);

    let pngBuffer = null;
    let source = 'clipboard';

    // 1. Prefer the clipboard cache (2-minute TTL — set by FK5-1).
    try {
      const clip = await window.ipm?.clipboard?.getLatestImage?.();
      if (clip?.ok && clip.pngBuffer) {
        // Electron structured-clones the Buffer into a Uint8Array;
        // PaddleOCR + Blob both accept either, so we keep it as-is.
        pngBuffer = clip.pngBuffer;
      }
    } catch { /* fall through to capture */ }

    // 2. Fall back to a fresh full-screen capture.
    if (!pngBuffer) {
      source = 'capture';
      try {
        const cap = await window.ipm?.capture?.fullScreen?.();
        if (cap?.ok && cap.pngBuffer) {
          pngBuffer = cap.pngBuffer;
        }
      } catch { /* swallow; we'll error chip below */ }
    }

    // 3. Both paths failed → inline error chip (per FK5 design decision).
    if (!pngBuffer) {
      setError('无可用图片，请手动截图后重试');
      return;
    }

    const ocr = await runOcrOnPng(pngBuffer);
    const text = ocr?.text || '';

    // Persist the OCR text (+ original PNG) so users can find it in
    // _floating/captures/ later. Fire-and-forget.
    Promise.resolve().then(async () => {
      try {
        await window.ipm?.capture?.saveArtifacts?.({
          pngBuffer,
          ocrText: text,
        });
      } catch { /* non-fatal */ }
    });

    setOcrResultCard({
      visible: true,
      text,
      confidence: Number(ocr?.confidence || 0),
      charCount: text.length,
      source,
    });
  }, [ocrResultCard.visible, streaming, capturePreview.visible, runOcrOnPng]);

  const copyOcrResult = useCallback(async () => {
    const text = ocrResultCard.text || '';
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, [ocrResultCard.text]);

  // The renderer hands the actual `injectText` callback in via a ref so
  // we can stay decoupled from the FloatingInput component (it owns
  // the textarea value). KnowClawFloating wires `inputApiRef.current`
  // to FloatingInput's `useImperativeHandle` API.
  const inputApiRef = useRef(null);

  const askAiFromOcr = useCallback(() => {
    const text = ocrResultCard.text || '';
    if (!text) return;
    const block = formatOcrQuoteBlock(text);
    inputApiRef.current?.injectText?.(block);
    dismissOcrResult();
  }, [ocrResultCard.text, dismissOcrResult]);

  const saveOcrAsNote = useCallback(async () => {
    const text = ocrResultCard.text || '';
    if (!text) return { ok: false, error: 'empty' };
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      + ` ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const md = [
      `# OCR 笔记`,
      ``,
      `- 提取时间：${stamp}`,
      `- 字数：${text.length}`,
      `- 置信度：${Math.round((ocrResultCard.confidence || 0) * 100)}%`,
      `- 来源：${ocrResultCard.source === 'capture' ? '全屏截图' : '剪贴板'}`,
      ``,
      `## 原文`,
      ``,
      text,
      ``,
    ].join('\n');
    try {
      const res = await window.ipm?.capture?.saveNote?.(md);
      return res || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [ocrResultCard]);

  return {
    messages,
    streaming,
    sessionId,
    error,
    sessions,
    thinkingLevel,
    expanded,
    sendMessage,
    abort,
    newSession,
    listSessions,
    openSession,
    deleteSession,
    setThinkingLevel,
    steer,
    expandRequestRef,
    // FK4
    capturePreview,
    triggerCaptureSummary,
    confirmCaptureSummary,
    confirmCaptureOcrOnly,
    dismissCapturePreview,
    // FK5
    ocrResultCard,
    triggerOcrExtract,
    copyOcrResult,
    askAiFromOcr,
    saveOcrAsNote,
    dismissOcrResult,
    inputApiRef,
    // Dismiss helpers used by KnowClawFloating to clear error chips
    clearError: () => setError(null),
    // FK6-4: allow KnowClawFloating to push a non-fatal error
    // string into the panel's error chip (e.g. when the
    // ui/backToFloatingWorkspace IPC reports `blocked: true`).
    setErrorMessage: (msg) => setError(msg ? String(msg) : null),
  };
}
