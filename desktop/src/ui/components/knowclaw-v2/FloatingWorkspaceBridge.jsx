// desktop/src/ui/components/knowclaw-v2/FloatingWorkspaceBridge.jsx
//
// FK6-2: bridge between the floating window's "回到空间" button and
// the main-window KnowClaw page. The floating window calls
// `ui.backToFloatingWorkspace()` which kicks off a roundtrip:
// the main process pushes `ui:openFloatingWorkspaceRequest` to the
// main-window renderer; this component listens, decides whether the
// switch is safe, and replies via `ui.replyOpenFloatingWorkspace`.
//
// Placement: inside `KnowClawPersistProvider` AND under the App's
// `setActiveNav` closure — the easiest way to give one component
// both `useKnowClawPersist()` access and the navigation setter is
// to mount it from inside App.jsx and pass `onNavigateToKnowClaw`
// as a prop. The bridge itself renders nothing.
//
// Safety: when the main-window KnowClaw is mid-stream we MUST NOT
// auto-switch workspaces (knowclaw:setCwd tears down the active
// session). We reply with `blocked: true` so the main process
// leaves the floating window visible, and we surface a toast so
// the user knows why nothing happened.

import { useEffect } from 'react';
import { useKnowClawPersist } from '../../hooks/useKnowClawPersist.jsx';
import { useToast } from '../../hooks/useToast.js';

function joinFloatingWorkspacePath(userFileRoot) {
  if (!userFileRoot) return '';
  const root = String(userFileRoot).replace(/[\\/]+$/, '');
  // The main-process `knowclaw:setCwd` handler calls `path.resolve`
  // on whatever the renderer hands it, which normalises mixed
  // separators on Windows. Detect the dominant separator from the
  // root we were given so the IPC payload looks native (helps when
  // debugging from the console).
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}workspaces${sep}_floating`;
}

export default function FloatingWorkspaceBridge({ onNavigateToKnowClaw }) {
  const {
    streaming,
    userFileRoot,
    currentCwd,
    setCwd,
  } = useKnowClawPersist();
  const { showToast } = useToast();

  useEffect(() => {
    const off = window.ipm?.ui?.onOpenFloatingWorkspaceRequest?.(async (data) => {
      const requestId = String(data?.requestId || '');
      if (!requestId) return;

      const reply = async (result) => {
        try {
          await window.ipm?.ui?.replyOpenFloatingWorkspace?.(requestId, result);
        } catch {
          // ignore — main process has a 4s timeout fallback
        }
      };

      // Safety: never reset an in-flight main-window session.
      if (streaming) {
        showToast(
          '主台 KnowClaw 正在回答，请先停止或等待完成后再「回到空间」',
          'warn',
        );
        await reply({ ok: false, blocked: true, reason: 'main_knowclaw_streaming' });
        return;
      }

      const floatingPath = joinFloatingWorkspacePath(userFileRoot);

      // Navigate to KnowClaw page first so the user sees the page
      // they're about to land on before the cwd swap clears the
      // chat. The setActiveNav callback comes from App.jsx.
      try {
        onNavigateToKnowClaw?.();
      } catch {
        // ignore — non-fatal; the workspace swap still proceeds.
      }

      // If we don't know the userFileRoot yet (e.g. getStatus
      // hasn't resolved on a freshly-launched main window), bail
      // gracefully — the user can re-click after the page hydrates.
      if (!floatingPath) {
        showToast('主台正在加载工作空间信息，请稍后重试「回到空间」', 'warn');
        await reply({ ok: false, reason: 'userfile_root_unknown' });
        return;
      }

      // Skip the workspace swap when we're already on _floating —
      // setCwd would needlessly tear down the active session.
      if (currentCwd && String(currentCwd).toLowerCase() === floatingPath.toLowerCase()) {
        await reply({ ok: true, alreadyOnTarget: true });
        return;
      }

      try {
        const res = await setCwd(floatingPath);
        if (!res?.ok) {
          showToast(`切换到「悬浮助手」工作空间失败: ${res?.error || '未知错误'}`, 'error');
          await reply({ ok: false, reason: 'set_cwd_failed', error: res?.error });
          return;
        }
        await reply({ ok: true });
      } catch (err) {
        const errText = String(err?.message || err);
        showToast(`切换到「悬浮助手」工作空间失败: ${errText}`, 'error');
        await reply({ ok: false, reason: 'set_cwd_threw', error: errText });
      }
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, [streaming, userFileRoot, currentCwd, setCwd, showToast, onNavigateToKnowClaw]);

  return null;
}
