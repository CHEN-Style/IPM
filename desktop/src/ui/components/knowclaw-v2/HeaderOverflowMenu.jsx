// desktop/src/ui/components/knowclaw-v2/HeaderOverflowMenu.jsx
//
// E.6: when the header right cluster is in the `compact` tier we
// collapse the remaining secondary controls into a `...` popover.
//
// UI revamp: this menu used to also carry the Model selector, the
// PlanMode toggle and the Workspace selector. Those three controls
// moved into the composer's bottom toolbar in the input UI redesign,
// so they no longer appear here. The popover now hosts only the
// status / session-level controls that still live in the header:
// Thinking depth · SubAgent · Compact · FileTree toggle · Skill
// panel toggle.
//
// Outside-click handling: we ONLY close on clicks that land outside
// `rootRef`. Inner controls (ThinkingLevelSelector) have their own
// dropdowns that render in-tree (top-full absolute), so their
// dropdowns are descendants of `rootRef` and stay open while their
// own outside-click logic fires.
//
// Esc closes the popover too. We DON'T close on inner click because
// the user is expected to interact with multiple controls in one
// open session.

import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal,
  PanelRightOpen,
  PanelRightClose,
  FolderTree,
  Puzzle,
} from 'lucide-react';

export default function HeaderOverflowMenu({
  // ThinkingLevelSelector
  thinkingLevel, onThinkingChange, thinkingHint, onDismissThinkingHint,
  // SubAgentToggle
  subAgentEnabled, onToggleSubAgent,
  // CompactButton
  compactSession, compacting, contextUsage,
  // FileTree toggle
  showFileTree, onToggleFileTree,
  // SK1: Skills panel toggle
  showSkillsPanel, onToggleSkillsPanel,
  // Shared
  streaming,
  // Rendering: the page passes the actual component classes so we
  // don't duplicate render logic / re-import their internals.
  components,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouse = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const {
    ThinkingLevelSelector,
    SubAgentToggle,
    CompactButton,
  } = components || {};

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2 flex items-center rounded-lg text-xs transition-colors ${
          open
            ? 'bg-slate-100 text-slate-700'
            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5"
          role="menu"
        >
          {ThinkingLevelSelector && (
            <div className="px-2 py-1 flex items-center gap-2">
              <span className="text-[11px] text-slate-400 w-14 shrink-0">思考</span>
              <div className="flex-1 min-w-0 flex justify-end">
                <ThinkingLevelSelector
                  level={thinkingLevel}
                  onChange={onThinkingChange}
                  hint={thinkingHint}
                  onDismissHint={onDismissThinkingHint}
                  disabled={streaming}
                  tier="wide"
                />
              </div>
            </div>
          )}
          {SubAgentToggle && (
            <div className="px-2 py-1 flex items-center gap-2">
              <span className="text-[11px] text-slate-400 w-14 shrink-0">子代理</span>
              <div className="flex-1 min-w-0 flex justify-end">
                <SubAgentToggle
                  enabled={subAgentEnabled}
                  onToggle={onToggleSubAgent}
                  disabled={streaming}
                  tier="wide"
                />
              </div>
            </div>
          )}
          {CompactButton && Boolean(contextUsage) && (
            <div className="px-2 py-1 flex items-center gap-2 border-t border-slate-100 mt-1 pt-2">
              <span className="text-[11px] text-slate-400 w-14 shrink-0">压缩</span>
              <div className="flex-1 min-w-0 flex justify-end">
                <CompactButton
                  onCompact={compactSession}
                  disabled={streaming || compacting}
                  compacting={compacting}
                  visible
                  tier="wide"
                />
              </div>
            </div>
          )}
          <div className="px-2 py-1 flex items-center gap-2">
            <span className="text-[11px] text-slate-400 w-14 shrink-0">文件树</span>
            <div className="flex-1 min-w-0 flex justify-end">
              <button
                type="button"
                onClick={onToggleFileTree}
                className={`h-8 px-2 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
                  showFileTree
                    ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
                title={showFileTree ? '隐藏文件树' : '显示文件树'}
              >
                {showFileTree
                  ? <PanelRightClose size={14} />
                  : <PanelRightOpen size={14} />}
                <FolderTree size={13} />
              </button>
            </div>
          </div>
          {onToggleSkillsPanel && (
            <div className="px-2 py-1 flex items-center gap-2">
              <span className="text-[11px] text-slate-400 w-14 shrink-0">技能</span>
              <div className="flex-1 min-w-0 flex justify-end">
                <button
                  type="button"
                  onClick={onToggleSkillsPanel}
                  className={`h-8 px-2 flex items-center gap-1.5 rounded-lg text-xs transition-colors ${
                    showSkillsPanel
                      ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                  title={showSkillsPanel ? '隐藏技能面板' : '显示技能面板'}
                >
                  {showSkillsPanel
                    ? <PanelRightClose size={14} />
                    : <PanelRightOpen size={14} />}
                  <Puzzle size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
