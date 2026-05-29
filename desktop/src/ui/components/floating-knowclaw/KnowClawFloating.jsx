// desktop/src/ui/components/floating-knowclaw/KnowClawFloating.jsx
//
// FK1+FK3: outer shell of the floating-window KnowClaw mode.
//
// Responsibilities:
//   1. Own the `expanded` toggle and sub-panel state (history, settings).
//   2. Wire FloatingHeader + FloatingChatList + FloatingInput + overlay
//      panels to the `useFloatingKnowClaw` hook.
//   3. Provide a stable panel surface — 360px wide, white-ish glass.
//
// Sizing:
//   - Compact: 360x310  (textarea fills body)
//   - Expanded: 360x480 (260px chat list + 78px input + header + padding)

import React, { useCallback, useEffect, useState } from 'react';
import FloatingHeader from './FloatingHeader.jsx';

// FK6-4: handler for the header's "回到空间" pill. Calls the
// `ui/backToFloatingWorkspace` IPC and surfaces failures back into
// the floating panel's error chip — when the main-window KnowClaw
// is streaming, the IPC replies with `blocked: true` and we render
// a hint instead of silently doing nothing.
function describeBackToWorkspaceFailure(res) {
  if (!res) return '回到空间失败：未知错误';
  if (res.blocked && res.reason === 'main_knowclaw_streaming') {
    return '主台 KnowClaw 正在回答，请先停止或等待完成后再回到空间';
  }
  switch (res.reason) {
    case 'timeout':
      return '主台未响应，请确认主窗口已打开后重试';
    case 'no_main_window':
      return '主窗口未启动，请先打开主台';
    case 'userfile_root_unknown':
      return '主台正在初始化，请稍后重试';
    case 'set_cwd_failed':
    case 'set_cwd_threw':
      return `切换到「悬浮助手」工作空间失败：${res.error || '未知错误'}`;
    default:
      return res.error ? `回到空间失败：${res.error}` : '回到空间失败';
  }
}
import FloatingInput from './FloatingInput.jsx';
import FloatingChatList from './FloatingChatList.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import SettingsMenu from './SettingsMenu.jsx';
import CapturePreviewCard from './CapturePreviewCard.jsx';
import OcrResultCard from './OcrResultCard.jsx';
import useFloatingKnowClaw from './useFloatingKnowClaw.js';

// FK3-7: onBubbleHide / onBubbleShow are reserved for FK2.
// When FK2 lands, the parent (FloatingMode) will pass them down so
// that expanding hides the bubble, and collapsing re-shows it.
//
// FK6-5: `pendingInjectText` lets the parent (FloatingMode) drop
// initial text into the input — currently used by the Vault
// "发送给 AI 分析" path to prefill `@relPath` references after
// uploading a file into the `_floating` workspace. The injection
// fires once on mount (or when the value transitions from empty →
// non-empty); we then call `onPendingInjectionConsumed` so the
// parent clears its own state and a future "发送给 AI 分析" trigger
// works correctly.
export default function KnowClawFloating({
  onBubbleHide,
  onBubbleShow,
  pendingInjectText = '',
  onPendingInjectionConsumed,
  // FK7-2: lets the parent (FloatingMode) consult KnowClaw's
  // internal Esc cascade before falling back to its own. The
  // returned handler resolves with `true` when an internal panel
  // (bubble / capture preview / OCR / history / settings /
  // expanded) was closed, or `false` when the parent should
  // continue its own cascade (KnowClaw → Vault → back to main).
  onRegisterEscHandler,
} = {}) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chat = useFloatingKnowClaw({ expanded });

  const handleToggleHistory = useCallback(() => {
    setHistoryOpen((v) => !v);
    setSettingsOpen(false);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen((v) => !v);
    setHistoryOpen(false);
  }, []);

  // FK6-4: "回到空间" → main window + KnowClaw + _floating workspace.
  // The IPC roundtrip can reply with `blocked: true` when the main
  // KnowClaw is mid-stream; we surface that into the panel's error
  // chip instead of silently doing nothing.
  const handleBackToWorkspace = useCallback(async () => {
    chat.clearError?.();
    const api = window.ipm?.ui?.backToFloatingWorkspace;
    if (typeof api !== 'function') {
      chat.setErrorMessage?.('当前版本未提供「回到空间」桥接');
      return;
    }
    try {
      const res = await api();
      if (res?.ok) return;
      chat.setErrorMessage?.(describeBackToWorkspaceFailure(res));
    } catch (err) {
      chat.setErrorMessage?.(`回到空间失败：${err?.message || err}`);
    }
  }, [chat]);

  const handleSelectSession = useCallback(async (sessionFile) => {
    await chat.openSession(sessionFile);
    setHistoryOpen(false);
  }, [chat.openSession]);

  // FK2: wire expand-request from the bubble window
  useEffect(() => {
    chat.expandRequestRef.current = () => setExpanded(true);
    return () => { chat.expandRequestRef.current = null; };
  }, [chat.expandRequestRef]);

  // FK7-2: Esc cascade scoped to the KnowClaw panel. We register
  // an imperative handler via `onRegisterEscHandler` so the parent
  // FloatingMode can call us first (single source of truth for
  // event ordering — avoids two competing window listeners).
  // Order: bubble → capture preview → OCR result → history /
  // settings → expanded → collapsed back to vault (handled by
  // parent). Returns true when an internal level was closed.
  useEffect(() => {
    if (typeof onRegisterEscHandler !== 'function') return undefined;
    const handler = () => {
      // 1) When collapsed, the external bubble is the most prominent
      //    transient surface. Close it first so users get a "quiet"
      //    state without having to also collapse the KnowClaw panel.
      if (!expanded) {
        const last = chat.messages[chat.messages.length - 1];
        const bubbleActive = last && last.role === 'assistant'
          && (last.content || chat.streaming);
        if (bubbleActive) {
          try { window.ipm?.bubble?.hide?.(); } catch { /* ignore */ }
          return true;
        }
      }
      // 2) Capture preview card.
      if (chat.capturePreview?.visible) {
        chat.dismissCapturePreview?.();
        return true;
      }
      // 3) OCR result card.
      if (chat.ocrResultCard?.visible) {
        chat.dismissOcrResult?.();
        return true;
      }
      // 4) History panel.
      if (historyOpen) {
        setHistoryOpen(false);
        return true;
      }
      // 5) Settings panel.
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      // 6) Expanded → collapsed.
      if (expanded) {
        setExpanded(false);
        return true;
      }
      // Nothing internal to close — let the parent cascade run.
      return false;
    };
    onRegisterEscHandler(handler);
    return () => onRegisterEscHandler(null);
  }, [
    expanded, historyOpen, settingsOpen,
    chat.capturePreview?.visible, chat.ocrResultCard?.visible,
    chat.messages, chat.streaming,
    chat.dismissCapturePreview, chat.dismissOcrResult,
    onRegisterEscHandler,
  ]);

  // FK7-2: one-time onboarding hint for first-time KnowClaw users.
  // Persisted in localStorage so the card disappears after a single
  // dismissal and never returns. We deliberately keep this in
  // localStorage (UI-only) instead of prefs to avoid polluting the
  // backend state file.
  const ONBOARDING_KEY = 'ipm.fk7.knowclawOnboardingDone';
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    try {
      const done = window.localStorage.getItem(ONBOARDING_KEY);
      if (done !== '1') setShowOnboarding(true);
    } catch {
      // localStorage may be unavailable in unusual sandboxes — we
      // just skip the onboarding rather than crash the panel.
    }
  }, []);
  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try { window.localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* ignore */ }
  }, []);

  // FK6-5: consume any prefilled `@relPath ` text passed in from
  // FloatingMode. We defer one frame so the FloatingInput's
  // forwardRef + useImperativeHandle has had time to attach. We
  // also auto-focus the input so the user can immediately type
  // their question after the file references.
  useEffect(() => {
    const text = String(pendingInjectText || '');
    if (!text) return;
    const id = requestAnimationFrame(() => {
      const api = chat.inputApiRef?.current;
      if (api?.appendText) {
        api.appendText(text);
      } else if (api?.injectText) {
        api.injectText(text);
      }
      try { api?.focus?.(); } catch { /* ignore */ }
      onPendingInjectionConsumed?.();
    });
    return () => cancelAnimationFrame(id);
  }, [pendingInjectText, chat.inputApiRef, onPendingInjectionConsumed]);

  return (
    <div
      className="relative flex flex-col bg-white/95 overflow-hidden"
      style={{
        width: 360,
        minHeight: expanded ? 480 : 310,
        borderTopRightRadius: 0,
        borderBottomRightRadius: 18,
        transition: 'min-height 220ms ease',
      }}
    >
      <FloatingHeader
        expanded={expanded}
        streaming={chat.streaming}
        onNewChat={chat.newSession}
        onToggleExpand={() => setExpanded((e) => !e)}
        onToggleHistory={handleToggleHistory}
        onOpenSettings={handleOpenSettings}
        onBackToWorkspace={handleBackToWorkspace}
      />

      {expanded && (
        <div className="relative">
          <FloatingChatList
            messages={chat.messages}
            streaming={chat.streaming}
          />
          {historyOpen && (
            <HistoryPanel
              currentSessionId={chat.sessionId}
              onSelect={handleSelectSession}
              onDelete={chat.deleteSession}
              onClose={() => setHistoryOpen(false)}
              listSessions={chat.listSessions}
            />
          )}
        </div>
      )}

      {settingsOpen && (
        <SettingsMenu
          thinkingLevel={chat.thinkingLevel}
          onSetThinkingLevel={chat.setThinkingLevel}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* FK4: capture preview card. Shown only after a successful
          fullScreen capture; user must manually pick send / OCR /
          cancel (no auto-countdown). Sits between header/messages and
          the input so the user can see the screenshot context while
          deciding. */}
      <CapturePreviewCard
        visible={chat.capturePreview.visible}
        thumbUrl={chat.capturePreview.thumbUrl}
        width={chat.capturePreview.width}
        height={chat.capturePreview.height}
        ocrRunning={chat.capturePreview.ocrRunning}
        saving={chat.capturePreview.saving}
        onSendSummary={chat.confirmCaptureSummary}
        onOcrOnly={chat.confirmCaptureOcrOnly}
        onCancel={chat.dismissCapturePreview}
      />

      {/* FK5: OCR result card. Mutually exclusive with the capture
          preview — only one occupies this slot at a time. */}
      <OcrResultCard
        visible={chat.ocrResultCard.visible}
        text={chat.ocrResultCard.text}
        confidence={chat.ocrResultCard.confidence}
        charCount={chat.ocrResultCard.charCount}
        source={chat.ocrResultCard.source}
        onCopy={chat.copyOcrResult}
        onAskAi={chat.askAiFromOcr}
        onSaveNote={chat.saveOcrAsNote}
        onClose={chat.dismissOcrResult}
      />

      <FloatingInput
        ref={chat.inputApiRef}
        streaming={chat.streaming}
        expanded={expanded}
        onSend={expanded && chat.streaming ? chat.steer : chat.sendMessage}
        onAbort={chat.abort}
        onScreenshot={chat.triggerCaptureSummary}
        onOcr={chat.triggerOcrExtract}
        disabledQuickActions={
          chat.streaming
          || chat.capturePreview.visible
          || chat.ocrResultCard.visible
        }
      />

      {/* FK7-2: first-time onboarding hint. Three short bullets
          summarising the panel's most non-obvious affordances:
          缩略输入框、外部气泡、截屏/OCR 快捷键。Persisted in
          localStorage so it shows up exactly once per machine. */}
      {showOnboarding && (
        <div
          className="fk-card-in mx-3 mb-2 p-3 rounded-[14px] bg-violet-50 border border-violet-200 text-[11.5px] text-violet-900"
          style={{ boxShadow: '0 4px 14px rgba(99, 102, 241, 0.08)' }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <strong className="text-[12px] font-semibold">第一次进入 KnowClaw？</strong>
            <button
              type="button"
              onClick={dismissOnboarding}
              className="text-[11px] px-2 py-0.5 rounded-md text-violet-700 hover:bg-violet-100"
            >
              知道了
            </button>
          </div>
          <ul className="space-y-1 leading-[1.5] text-violet-800/95">
            <li>· 输入框输入问题或描述，回车发送；Shift+Enter 换行。</li>
            <li>· 回答会先出现在右侧悬浮气泡里，点「展开到悬浮窗内」可在此处继续。</li>
            <li>· 左下角三个按钮分别是：截屏总结 / OCR 提取 / 添加文件，Esc 可逐层收起面板。</li>
          </ul>
        </div>
      )}

      {/* FK1: a quiet, non-blocking error chip. We surface
          ipc-level failures (LLM unconfigured, send timeout) so
          the user isn't left with a silent input box. FK4/FK5
          extend it to capture / OCR error paths. */}
      {chat.error ? (
        <div
          className="mx-3 mb-2 px-2.5 py-1.5 rounded-md text-[11px]
                     border border-rose-200 bg-rose-50 text-rose-600 cursor-pointer"
          title="点击关闭"
          onClick={chat.clearError}
        >
          {chat.error.length > 80 ? chat.error.slice(0, 78) + '…' : chat.error}
        </div>
      ) : null}
    </div>
  );
}
