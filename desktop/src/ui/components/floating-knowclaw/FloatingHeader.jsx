// desktop/src/ui/components/floating-knowclaw/FloatingHeader.jsx
//
// FK1: header strip for the floating-window KnowClaw panel.
//
// Visual contract (per `Agent/k3-floating-knowclaw-demo.html`):
//   - 40px tall, white-ish gradient background, single-pixel bottom
//     divider so it reads as a header even against the panel's
//     white body.
//   - Left side: bare-text "KnowClaw" title + a small "回到空间"
//     pill button. The KnowClaw icon mark was removed per the
//     user's "信息密度过高" feedback round on 2026-05-24.
//   - Right side: three icon buttons — `新对话` (pencil, NOT a `+`
//     so it doesn't collide visually with the input's "add file"
//     quick-action), `展开 / 收起` (text-only toggle), and a
//     `设置` (cog) placeholder. Gap is 4px to mirror demo spacing.
//
// FK1 wires only `新对话` and `展开 / 收起` to real callbacks. The
// other two (`回到空间`, `设置`) are intentional stubs in FK1; they
// pass through to onBackToWorkspace / onOpenSettings props that the
// parent leaves undefined, so the buttons emit a console hint
// instead of crashing.

import React from 'react';
import { Pencil, Settings, Clock } from 'lucide-react';

export default function FloatingHeader({
  expanded = false,
  streaming = false,
  onNewChat,
  onToggleExpand,
  onBackToWorkspace,
  onOpenSettings,
  onToggleHistory,
}) {
  // FK1 stub. FK6 will swap this for `window.ipm.ui.backToFloatingWorkspace()`.
  const handleBackToWorkspace = () => {
    if (typeof onBackToWorkspace === 'function') {
      onBackToWorkspace();
      return;
    }
    // eslint-disable-next-line no-console
    console.info('[KnowClawFloating] 回到空间 — FK6 待接线');
  };

  // FK3 will turn this into a real menu with model + thinkingLevel
  // controls. For now it's just a placeholder so the visual matches
  // the demo's three-button right cluster.
  const handleSettings = () => {
    if (typeof onOpenSettings === 'function') {
      onOpenSettings();
      return;
    }
    // eslint-disable-next-line no-console
    console.info('[KnowClawFloating] 设置 — FK3 待接线');
  };

  return (
    <header
      className="flex items-center gap-2 px-3 border-b border-slate-200/80"
      style={{
        height: 40,
        background: 'linear-gradient(180deg, #ffffff, #fbfdff)',
      }}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <strong className="text-[13px] leading-tight text-slate-800">KnowClaw</strong>
        <button
          type="button"
          onClick={handleBackToWorkspace}
          className="h-6 max-w-[96px] px-[9px] rounded-lg border border-slate-200 bg-slate-50
                     text-[11px] font-bold text-slate-500
                     whitespace-nowrap overflow-hidden text-ellipsis
                     hover:border-slate-300 hover:bg-white hover:text-slate-800
                     transition-colors"
          title="回到中台并打开 KnowClaw 的 _floating 工作空间"
        >
          回到空间
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNewChat}
          disabled={streaming}
          className="min-w-[28px] h-6 grid place-items-center
                     rounded-lg border border-slate-200 bg-white
                     text-slate-500 text-[11px] font-extrabold
                     hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          title={streaming ? '当前正在回答中，先中止再新建' : '新对话'}
          aria-label="新对话"
        >
          <Pencil size={13} />
        </button>
        {expanded && (
          <button
            type="button"
            onClick={onToggleHistory}
            className="min-w-[28px] h-6 grid place-items-center
                       rounded-lg border border-slate-200 bg-white
                       text-slate-500 text-[11px] font-extrabold
                       hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50
                       transition-colors"
            title="历史会话"
            aria-label="历史会话"
          >
            <Clock size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-[28px] h-6 px-2 grid place-items-center
                     rounded-lg border border-slate-200 bg-white
                     text-slate-500 text-[11px] font-extrabold
                     hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50
                     transition-colors"
          title={expanded ? '收起对话' : '展开对话'}
          aria-label={expanded ? '收起对话' : '展开对话'}
        >
          {expanded ? '收起' : '展开'}
        </button>
        <button
          type="button"
          onClick={handleSettings}
          className="min-w-[28px] h-6 grid place-items-center
                     rounded-lg border border-slate-200 bg-white
                     text-slate-500 text-[11px] font-extrabold
                     hover:text-slate-800 hover:border-slate-300 hover:bg-slate-50
                     transition-colors"
          title="设置"
          aria-label="设置"
        >
          <Settings size={13} />
        </button>
      </div>
    </header>
  );
}
