import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import {
  ChevronDown, ChevronRight, Wrench, Loader2,
  Check, X, Undo2, Zap, MessageSquare,
  AlertCircle, Sparkles, Hourglass, Copy,
} from 'lucide-react';
import { marked } from 'marked';

import TaskCard, { TaskCardSummary } from '../knowclaw-v2/TaskCard.jsx';
import AskUserCard from '../knowclaw-v2/AskUserCard.jsx';
import FileChangePreview from '../knowclaw-v2/FileChangePreview.jsx';
import DelegateTaskResult from '../knowclaw-v2/DelegateTaskResult.jsx';
import { summarizeToolArgs } from '../knowclaw-v2/useKnowClawV2Chat.js';
import { renderTextWithFileRefs } from './fileRefRender.jsx';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return '';
  try { return marked.parse(text); } catch { return text.replace(/\n/g, '<br/>'); }
}

async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

function tableToTsv(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  return rows
    .map((row) => Array.from(row.querySelectorAll('th,td'))
      .map((cell) => cell.innerText.replace(/\s+/g, ' ').trim())
      .join('\t'))
    .join('\n');
}

function addCopyButton(target, textFactory, title, kind = 'block') {
  const isCode = kind === 'code';
  const wrapper = document.createElement('div');
  wrapper.className = isCode ? 'kc-copyable-block kc-code-editor-block' : 'kc-copyable-block';
  wrapper.style.position = 'relative';
  wrapper.style.marginTop = '0.75em';
  wrapper.style.marginBottom = '0.75em';
  if (kind === 'table') {
    wrapper.style.paddingTop = '4px';
  }
  target.parentNode.insertBefore(wrapper, target);
  if (isCode) {
    const titlebar = document.createElement('div');
    titlebar.className = 'kc-code-titlebar';
    titlebar.innerHTML = '<span class="kc-code-dot kc-red"></span><span class="kc-code-dot kc-yellow"></span><span class="kc-code-dot kc-green"></span>';
    wrapper.appendChild(titlebar);
    wrapper.appendChild(target);
  } else {
    wrapper.appendChild(target);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.className = 'kc-inline-copy-btn';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
  Object.assign(btn.style, {
    position: 'absolute',
    top: kind === 'table' ? '10px' : isCode ? '6px' : '8px',
    right: '8px',
    zIndex: '10',
    width: '26px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    borderRadius: '6px',
    border: '1px solid #d8dbed',
    background: 'rgba(255, 255, 255, 0.92)',
    color: '#475569',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
    opacity: '0',
    pointerEvents: 'none',
    cursor: 'pointer',
    transition: 'opacity 120ms ease, background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease',
  });
  wrapper.addEventListener('mouseenter', () => {
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  });
  wrapper.addEventListener('mouseleave', () => {
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
  });
  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#ffffff';
    btn.style.color = '#3e4b9c';
    btn.style.borderColor = '#c3c9e8';
    btn.style.transform = 'translateY(-1px)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.92)';
    btn.style.color = '#475569';
    btn.style.borderColor = '#d8dbed';
    btn.style.transform = 'translateY(0)';
  });
  btn.addEventListener('click', async (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    const ok = await copyText(textFactory());
    btn.innerHTML = ok
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
    btn.style.color = ok ? '#059669' : '#dc2626';
    window.setTimeout(() => {
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
      btn.style.color = '#475569';
    }, 1400);
  });
  wrapper.appendChild(btn);
}

function CopyableMarkdown({ html, rawText }) {
  const ref = useRef(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('kc-copyable-block')) return;
      addCopyButton(pre, () => {
        const code = pre.querySelector('code');
        return code ? code.innerText : pre.innerText;
      }, '复制代码', 'code');
    });
    root.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('kc-copyable-block')) return;
      addCopyButton(table, () => tableToTsv(table), '复制表格（TSV，可直接粘贴到表格软件）', 'table');
    });
    return undefined;
  });

  const handleCopyAll = async () => {
    const ok = await copyText(rawText);
    if (!ok) return;
    setCopiedAll(true);
    window.setTimeout(() => setCopiedAll(false), 1400);
  };

  return (
    <>
      <div
        ref={ref}
        className="prose-chat"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="mt-2 flex items-center justify-start">
        <button
          type="button"
          onClick={handleCopyAll}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title="复制整条回答"
        >
          {copiedAll ? <Check size={12} /> : <Copy size={12} />}
          <span>{copiedAll ? '已复制' : '复制回答'}</span>
        </button>
      </div>
    </>
  );
}

/* ── Agent status loader (SVG + animated dot) ────────────────────
 *
 * Single source of truth for the "agent is busy" visual. Replaces both
 * the old rotating-phrase `ThinkingIndicator` and the lucide-icon
 * `HeartbeatStrip` pill. The SVG/animation comes from a Uiverse loader
 * (the "circle + orbiting dot" variant), trimmed to just the circle
 * shape since that's what we use as the generic spinner. More shapes
 * (triangle / square / etc.) can be added later as state-specific
 * icons by extending `KC_LOADER_VARIANTS` and accepting a `variant`
 * prop on `<AgentStatusLoader/>`.
 *
 * The source markup is sized to a 44×44 canvas with hard-coded pixel
 * positions for the orbiting dot. To embed at an arbitrary `size` we
 * keep the inner 44×44 element untouched and apply a uniform CSS
 * `scale()` on it — this preserves the source's pixel math (dot start
 * position, translate keyframes, stroke width) and lets the browser
 * downscale to display size. */

const KC_LOADER_STYLE_ID = 'kc-loader-style';

// Inject the shared keyframes/CSS exactly once into <head>. Doing it
// at module level (rather than inside the component via a JSX `<style>`
// tag) avoids React inserting a duplicate style node per render and
// keeps the markup tree clean for downstream tooling.
function ensureLoaderStyleInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KC_LOADER_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = KC_LOADER_STYLE_ID;
  el.textContent = `
    /* ── Shared shell ──────────────────────────────────────── */
    .kc-loader-shell {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    /* Icon variants inherit color via currentColor from the shell.
       slate-500 matches the status label so the icon strokes blend
       into the same muted caption tone. */
    .kc-loader-shell.kc-loader-icon { color: #64748b; }

    /* ── Generic spinner (orbiting dot around a stroked ring) ─ */
    .kc-loader-spinner {
      /* Path color tracks slate-500 so the ring matches the label
         text; the orbiting dot keeps the brand blue for accent. */
      --kc-loader-path: #64748b;
      --kc-loader-dot: #0052d9;
      --kc-loader-duration: 3s;
      width: 44px;
      height: 44px;
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
    }
    .kc-loader-spinner::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      position: absolute;
      display: block;
      background: var(--kc-loader-dot);
      top: 37px;
      left: 19px;
      transform: translate(-18px, -18px);
      animation: kc-dotRect var(--kc-loader-duration) cubic-bezier(0.785, 0.135, 0.15, 0.86) infinite;
    }
    .kc-loader-spinner svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .kc-loader-spinner svg circle {
      fill: none;
      stroke: var(--kc-loader-path);
      stroke-width: 10px;
      stroke-linejoin: round;
      stroke-linecap: round;
      stroke-dasharray: 150 50 150 50;
      stroke-dashoffset: 75;
      animation: kc-pathCircle var(--kc-loader-duration) cubic-bezier(0.785, 0.135, 0.15, 0.86) infinite;
    }
    @keyframes kc-pathCircle {
      25%  { stroke-dashoffset: 125; }
      50%  { stroke-dashoffset: 175; }
      75%  { stroke-dashoffset: 225; }
      100% { stroke-dashoffset: 275; }
    }
    @keyframes kc-dotRect {
      25%  { transform: translate(0, 0); }
      50%  { transform: translate(18px, -18px); }
      75%  { transform: translate(0, -36px); }
      100% { transform: translate(-18px, -18px); }
    }

    /* ── State icons with twinkling sparkle ─────────────────── */
    /* The icons are static line drawings (book / edit / terminal /
       tool). To convey "still working" we pulse just the small blue
       sparkle accent that lives inside each icon. Pure opacity
       animation — transform on SVG paths gets weird with multi-
       subpath stars (they collapse toward the bbox centre). The
       edit variant splits its 3 stars into separate path nodes
       so we can stagger them via inline animation-delay. */
    .kc-loader-spark {
      animation: kc-sparkle 1.4s ease-in-out infinite;
      transform-origin: center;
    }
    @keyframes kc-sparkle {
      0%, 100% { opacity: 0.3; }
      50%      { opacity: 1; }
    }

    /* ── Status label fade-in on phase change ─────────────── */
    @keyframes kc-statusFade {
      0%   { opacity: 0; transform: translateY(2px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .kc-status-label {
      animation: kc-statusFade 220ms ease-out both;
    }
  `;
  document.head.appendChild(el);
}

/* State icons. Each is a small SVG component that:
 *   - draws its body using `stroke="currentColor"` so the icon picks
 *     up the slate-500 we set on `.kc-loader-icon`;
 *   - keeps the original `fill="#bbd3fb"` light-blue fills as-is;
 *   - tags the blue `#0052d9` accent path(s) with `kc-loader-spark`
 *     so the shared sparkle keyframe pulses just that path. */

function IconBook({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6.5V22.0002C12 20.3434 9.31371 19.0002 6 19.0002C4.46329 19.0002 3.06151 19.2891 2 19.7641V4.26389C2 4.26389 3 3.5 6 3.5C9.31371 3.5 12 4.84315 12 6.5Z" fill="#bbd3fb" />
      <path className="kc-loader-spark" d="M19.25 3L19.7697 4.23028L21 4.75L19.7697 5.26972L19.25 6.5L18.7303 5.26972L17.5 4.75L18.7303 4.23028L19.25 3Z" strokeWidth={1.5} stroke="#0052d9" />
      <path d="M12 22.0002V6.50002M12 22.0002C12 20.3434 14.6863 19.0002 18 19.0002C19.5367 19.0002 20.9385 19.2891 22 19.7641V9.99982M12 22.0002C12 20.3434 9.31371 19.0002 6 19.0002C4.46329 19.0002 3.06151 19.2891 2 19.7641V4.26389C2 4.26389 3 3.5 6 3.5C9.31371 3.5 12 4.84317 12 6.50002M12 6.50002C12 5.88665 12.3682 5.31628 13 4.84113" strokeLinecap="square" strokeWidth={1.5} stroke="currentColor" />
    </svg>
  );
}

function IconEdit({ size }) {
  // The source icon packs all 3 sparkles into one <path>. We split
  // them into separate paths so we can stagger animation-delay and
  // get a sequential twinkle instead of all blinking in lockstep.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.50049 12.9995L10.0005 17.4995L21.0005 6.49951L16.5005 1.99951L5.50049 12.9995Z" fill="#bbd3fb" />
      <path d="M10.0005 17.4995L5.50049 12.9995M10.0005 17.4995L7.58628 19.9139C7.21121 20.289 6.70247 20.4998 6.17201 20.4998H2.49976L2.50035 16.8277C2.50044 16.2974 2.71115 15.7889 3.08614 15.4139L5.50049 12.9995M10.0005 17.4995L21.0005 6.49951L16.5005 1.99951L5.50049 12.9995" strokeWidth={1.5} stroke="currentColor" />
      <path className="kc-loader-spark" style={{ animationDelay: '0s' }}    d="M5 3 5.33234 3.66766 6 4 5.33234 4.33234 5 5 4.66766 4.33234 4 4 4.66766 3.66766 5 3Z" strokeWidth={1.5} stroke="#0052d9" />
      <path className="kc-loader-spark" style={{ animationDelay: '0.3s' }}  d="M12.75 20 12.9993 20.5007 13.5 20.75 12.9993 20.9993 12.75 21.5 12.5007 20.9993 12 20.75 12.5007 20.5007 12.75 20Z" strokeWidth={1.5} stroke="#0052d9" />
      <path className="kc-loader-spark" style={{ animationDelay: '0.6s' }}  d="M19.5 14 20.1223 15.3777 21.5 16 20.1223 16.6223 19.5 18 18.8777 16.6223 17.5 16 18.8777 15.3777 19.5 14Z" strokeWidth={1.5} stroke="#0052d9" />
    </svg>
  );
}

function IconTerminal({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.33 14.33L8.65686 12L6.33 9.67M13 16H18M22 11V20H2L2 4L12 4" strokeLinecap="square" strokeWidth={1.5} stroke="currentColor" />
      <path className="kc-loader-spark" d="M19 2.75L19.7 4.29996L21.25 5L19.7 5.70004L19 7.25L18.3 5.70004L16.75 5L18.3 4.29996L19 2.75Z" strokeWidth={1.5} stroke="#0052d9" />
    </svg>
  );
}

function IconTool({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 14H10V21H3V14ZM14 14H21V21H14V14ZM3 3H10V10H3V3Z" fill="#bbd3fb" />
      <path d="M3 14H10V21H3V14ZM14 14H21V21H14V14ZM3 3H10V10H3V3Z" strokeWidth={1.5} stroke="currentColor" />
      <path className="kc-loader-spark" d="M18 3.75L18.7 5.29996L20.25 6L18.7 6.70004L18 8.25L17.3 6.70004L15.75 6L17.3 5.29996L18 3.75Z" strokeWidth={1.5} stroke="#0052d9" />
    </svg>
  );
}

const ICON_RENDERERS = {
  book:     IconBook,
  edit:     IconEdit,
  terminal: IconTerminal,
  tool:     IconTool,
};

function CircleLoader({ size = 22, variant = 'circle' }) {
  useEffect(() => { ensureLoaderStyleInjected(); }, []);

  // Generic spinner (orbiting dot around a stroked ring). Kept as the
  // default / fallback so we always render something even if a phase
  // points at an unknown variant key.
  if (variant === 'circle' || !ICON_RENDERERS[variant]) {
    const scale = size / 44;
    return (
      <span
        className="kc-loader-shell"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span
          className="kc-loader-spinner"
          style={{ transform: `scale(${scale})` }}
        >
          <svg viewBox="0 0 80 80">
            <circle r="32" cy="40" cx="40" />
          </svg>
        </span>
      </span>
    );
  }

  // State-specific icon variants (book / edit / terminal / tool). The
  // shell additionally gets `kc-loader-icon` so the icon strokes pick
  // up the right `currentColor`, and the sparkle path inside the SVG
  // pulses via the shared kc-sparkle keyframe.
  const Icon = ICON_RENDERERS[variant];
  return (
    <span
      className="kc-loader-shell kc-loader-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  );
}

/* ── Thinking block (U0: extended-thinking stream) ── */

function ThinkingBlock({ thinking, isStreaming }) {
  // While the model is still emitting thinking, force the block open so
  // the user can watch the reasoning live. Once the turn ends we let the
  // user collapse it back via the toggle (default collapsed).
  const [userExpanded, setUserExpanded] = useState(false);
  if (!thinking) return null;
  const expanded = isStreaming || userExpanded;
  const label = isStreaming ? '思考中...' : `思考过程 (${thinking.length} 字)`;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => !isStreaming && setUserExpanded((v) => !v)}
        disabled={isStreaming}
        className={`flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors ${
          isStreaming ? 'cursor-default' : 'cursor-pointer'
        }`}
        title={isStreaming ? '正在思考' : (expanded ? '收起思考过程' : '展开思考过程')}
      >
        {isStreaming ? (
          <Loader2 size={12} className="animate-spin" />
        ) : expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
        <span className="italic">{label}</span>
      </button>
      {expanded && (
        isStreaming ? (
          <div className="mt-1.5 flex">
            <div
              className="shrink-0 w-0.5 rounded-full"
              style={{
                background:
                  'linear-gradient(180deg, #cbd5e1 0%, #f1f5f9 50%, #cbd5e1 100%)',
                backgroundSize: '100% 200%',
                animation: 'thinkShimmer 1.8s linear infinite',
              }}
            />
            <div className="pl-3 flex-1 min-w-0 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
              {thinking}
              <span className="inline-block w-px h-3.5 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />
            </div>
            <style>{`
              @keyframes thinkShimmer {
                0%   { background-position: 0% 0%; }
                100% { background-position: 0% 200%; }
              }
            `}</style>
          </div>
        ) : (
          <div className="mt-1.5 pl-3 border-l-2 border-slate-200 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
            {thinking}
          </div>
        )
      )}
    </div>
  );
}

/* ── Tool status config ── */

const STATUS_CONFIG = {
  // R4: `preparing` lands when the LLM has just started emitting the
  // tool call (toolcall_start) — args are not yet complete. We show a
  // pulsing sparkle to convey "model is generating" rather than the
  // generic spinner so users can distinguish "thinking up the call"
  // from "tool is actually running".
  preparing:   { icon: Sparkles, spin: false, pulse: true, color: 'text-violet-500', label: '生成中...' },
  // R4: `pending_exec` lands at toolcall_end and clears the moment
  // `tool_execution_start` arrives — usually a single frame, but we
  // want a distinct label for the brief "args parsed, about to run"
  // window so the UI never silently swallows that transition.
  pending_exec: { icon: Hourglass, spin: false, color: 'text-amber-500', label: '即将执行' },
  running:     { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  interrupted: { icon: Loader2, spin: false, color: 'text-amber-500', label: '等待确认' },
  confirmed:   { icon: Loader2, spin: true,  color: 'text-blue-500',  label: '执行中...' },
  cancelled:   { icon: X,       spin: false, color: 'text-gray-400',  label: '已取消' },
  done:        { icon: Check,   spin: false, color: 'text-emerald-500', label: null },
  error:       { icon: AlertCircle, spin: false, color: 'text-rose-500', label: '执行失败' },
};

// K2: render a tool's elapsed wall-clock time. `start` is set when
// `tool_execution_start` arrives; `end` lands with the matching
// `tool_execution_end`. We display whole seconds for anything under a
// minute and `m:ss` above.
function formatElapsedMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/* ── Tool call card ── */

// U3: tail the last N lines of a long stdout snapshot so the inline
// "live output" stripe stays compact. The full snapshot is still
// available behind the "展开全部" toggle.
function tailLines(text, n) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  if (lines.length <= n) return lines.join('\n');
  return lines.slice(-n).join('\n');
}

const ToolCallCard = ({ tool, projectName, domain }) => {
  const [expanded, setExpanded] = useState(false);
  const [undoState, setUndoState] = useState('idle');
  const undoTimer = useRef(null);
  // U3: when the live stream of stdout/stderr is long, default to a
  // collapsed (tail-only) view and let the user expand to read the
  // full buffer. Independent from the "result" expand state above
  // because the live stream disappears the moment the tool finishes.
  const [streamExpanded, setStreamExpanded] = useState(false);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const cfg = STATUS_CONFIG[tool.status] || STATUS_CONFIG.done;
  const Icon = cfg.icon || Wrench;
  // R4: `preparing` and `pending_exec` are also "busy" — the card
  // should not be treated as terminal (no `tool.result` yet, the
  // model may still be streaming args). Keeping the result panel
  // gated on !isBusy also avoids flashing a stale `result` from a
  // previous turn during the brief preparing→running transition.
  const isBusy = (
    tool.status === 'running'
    || tool.status === 'preparing'
    || tool.status === 'pending_exec'
    || tool.status === 'interrupted'
    || tool.status === 'confirmed'
  );
  // E.2 + R4: file-mutator tools (write / edit) render a live preview
  // straight from `tool.args` once the SDK hands them over fully, OR
  // from `tool.partialArgs` extracted incrementally from
  // `toolcall_delta` while the model is still emitting JSON.
  const isFileMutator = tool.name === 'write' || tool.name === 'edit';
  const hasFullArgs = isFileMutator && tool.args && typeof tool.args === 'object';
  const hasPartialArgs = isFileMutator && tool.partialArgs && typeof tool.partialArgs === 'object';
  const hasPreviewableArgs = hasFullArgs || hasPartialArgs;
  const isDelegateTask = tool.name === 'delegate_task';
  const canExpand = hasPreviewableArgs || (!isBusy && !!tool.result);
  const showUndo = tool.undoActionId && tool.status === 'done' && undoState !== 'done';
  const streamingStdout = isBusy ? (tool.streamingStdout || '') : '';
  const streamLineCount = streamingStdout ? streamingStdout.split(/\r?\n/).length : 0;

  // E.2: auto-expand the moment a write/edit tool starts so users
  // see the content/diff without having to hunt for a toggle. We
  // only fire when `hasPreviewableArgs` first becomes true and the
  // card is still collapsed; once the user has interacted with it,
  // their preference is respected (including collapsing it back).
  const autoExpandedRef = useRef(false);
  useEffect(() => {
    if (hasPreviewableArgs && !autoExpandedRef.current) {
      autoExpandedRef.current = true;
      setExpanded(true);
    }
  }, [hasPreviewableArgs]);

  // K2: friendly parameter summary. Prefer the value stashed by the
  // hook (`tool.summary` — written at `tool_execution_start`) but
  // fall back to re-deriving it from args so historic bubbles loaded
  // from JSONL still get a nice label.
  const summary = useMemo(() => {
    if (tool.summary) return tool.summary;
    if (tool.args && typeof tool.args === 'object') {
      try { return summarizeToolArgs(tool.name, tool.args); } catch { /* ignore */ }
    }
    return '';
  }, [tool.summary, tool.name, tool.args]);

  const elapsed = useMemo(() => {
    if (tool.startTime && tool.endTime && tool.endTime >= tool.startTime) {
      return formatElapsedMs(tool.endTime - tool.startTime);
    }
    return '';
  }, [tool.startTime, tool.endTime]);

  const handleUndo = async (e) => {
    e.stopPropagation();
    if (undoState === 'loading') return;
    setUndoState('loading');
    try {
      const res = await window.ipm?.agent?.undoAction?.(projectName, domain, String(tool.undoActionId));
      if (res?.ok) {
        setUndoState('done');
      } else {
        setUndoState('error');
        undoTimer.current = setTimeout(() => setUndoState('idle'), 3000);
      }
    } catch {
      setUndoState('error');
      undoTimer.current = setTimeout(() => setUndoState('idle'), 3000);
    }
  };

  return (
    <div className="my-1.5 bg-gray-50/80 border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs transition-colors ${
          canExpand ? 'hover:bg-gray-100/60 cursor-pointer' : 'cursor-default'
        }`}
      >
        <Icon
          size={13}
          className={`${cfg.color}${cfg.spin ? ' animate-spin' : ''}${cfg.pulse ? ' animate-pulse' : ''} shrink-0`}
        />
        <span className="font-mono text-gray-500 uppercase tracking-wider text-[11px] shrink-0">
          {tool.name}
        </span>
        {/* K2: friendly parameter summary. We render it as a regular
            (non-mono) span so it visually separates from the tool
            name and stays readable when paths are long. */}
        {summary && (
          <span
            className="text-gray-600 truncate min-w-0"
            title={summary}
          >
            {summary}
          </span>
        )}
        {cfg.label && (
          <span className={`${cfg.color} text-[10px] font-medium shrink-0`}>{cfg.label}</span>
        )}
        <span className="flex-1" />
        {/* K2: elapsed wall-clock time once the tool finishes. */}
        {elapsed && !isBusy && (
          <span className="text-[10px] text-gray-400 font-mono shrink-0">
            {elapsed}
          </span>
        )}
        {canExpand && (
          expanded
            ? <ChevronDown size={12} className="text-gray-400" />
            : <ChevronRight size={12} className="text-gray-400" />
        )}
      </button>

      {/* E.2: file-mutator preview takes priority over the generic
          result panel. We render the args-driven view (write content
          / edit diff) on top, and tuck the SDK's terse confirmation
          string (e.g. "Successfully wrote 1234 bytes to ...") into a
          single muted footer line so users still know the call
          finished and what it returned. For non-file tools we fall
          back to the historic result <pre>. */}
      {expanded && hasPreviewableArgs && (
        <div className="border-t border-gray-100">
          <FileChangePreview tool={tool} />
          {!isBusy && tool.result && (
            <div className="px-3.5 py-1.5 text-[10.5px] text-gray-400 border-t border-gray-100 bg-gray-50/60 font-mono truncate" title={tool.result}>
              {tool.result.length > 200 ? tool.result.slice(0, 200) + '…' : tool.result}
            </div>
          )}
        </div>
      )}

      {expanded && !hasPreviewableArgs && tool.result && (
        isDelegateTask ? (
          <div className="border-t border-gray-100">
            <DelegateTaskResult result={tool.result} args={tool.args} />
          </div>
        ) : (
          <div className="px-3.5 py-2.5 border-t border-gray-100 bg-white">
            <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed font-mono">
              {tool.result.length > 800 ? tool.result.slice(0, 800) + '...' : tool.result}
            </pre>
          </div>
        )
      )}

      {/* U3: live stdout/stderr while bash (and similar long-running
          tools) execute. Shown only while the tool is still busy —
          the moment `tool_execution_end` arrives the streaming
          snapshot is cleared in favour of `tool.result`. */}
      {streamingStdout && (
        <div className="border-t border-gray-100">
          <pre
            className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words overflow-y-auto"
            style={{
              background: '#0f172a',
              color: '#e2e8f0',
              padding: '8px 12px',
              maxHeight: streamExpanded ? '20rem' : '8rem',
            }}
          >
            {streamExpanded ? streamingStdout : tailLines(streamingStdout, 8)}
          </pre>
          {streamLineCount > 8 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setStreamExpanded((v) => !v); }}
              className="w-full px-3 py-1 text-[10px] text-slate-400 hover:text-slate-200 bg-slate-900/90 hover:bg-slate-900 transition-colors border-t border-slate-800"
            >
              {streamExpanded ? `收起 · ${streamLineCount} 行` : `展开全部 · ${streamLineCount} 行`}
            </button>
          )}
        </div>
      )}

      {showUndo && (
        <div className="px-3.5 py-2 border-t border-gray-100 bg-white flex justify-end">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoState === 'loading'}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-50"
          >
            {undoState === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            <span>{undoState === 'error' ? '撤销失败' : '撤销'}</span>
          </button>
        </div>
      )}

      {undoState === 'done' && (
        <div className="px-3.5 py-2 border-t border-gray-100 bg-white flex justify-end">
          <span className="flex items-center gap-1 text-[11px] text-gray-400">
            <Check size={11} /> 已撤销
          </span>
        </div>
      )}
    </div>
  );
};

/* ── U8b-8: user image attachments + lightbox ── */

function attachmentDataUrl(att) {
  if (!att?.data || !att?.mimeType) return '';
  const data = String(att.data);
  if (data.startsWith('data:')) return data;
  return `data:${att.mimeType};base64,${data}`;
}

function UserAttachments({ attachments }) {
  const [lightboxSrc, setLightboxSrc] = useState(null);
  if (!attachments?.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-2 justify-end">
        {attachments.map((att, i) => {
          const src = attachmentDataUrl(att);
          if (!src) return null;
          return (
            <button
              key={`${att.mimeType}-${i}`}
              type="button"
              onClick={() => setLightboxSrc(src)}
              className="block w-16 h-16 rounded-lg overflow-hidden border border-gray-200 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              title="点击查看大图"
            >
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          );
        })}
      </div>
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxSrc(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLightboxSrc(null); }}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setLightboxSrc(null)}
            title="关闭"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/* ── Agent status indicator (merged heartbeat + thinking) ────────
 *
 * Rendered at the top of the active assistant bubble while pi is
 * streaming. Responsibilities (unchanged from the old K2 strip):
 *   1. Surface a coarse-grain status — `thinking` / `writing` /
 *      `tool` / `idle` — so the user sees something is happening
 *      even when text/thinking deltas come in burst-y or a long
 *      tool call is mid-execution.
 *   2. After 30s of silence (no events at all) flip to an explicit
 *      "等待模型响应中…（已 N秒）" warning so the user knows the
 *      app isn't frozen — usually means the upstream provider is
 *      slow or the network path stalled.
 *
 * What changed (this commit): the pill UI with lucide icons + coloured
 * background per phase was replaced with the cleaner spinner-and-grey-
 * label layout that used to belong to ThinkingIndicator. The icon
 * itself is now the SVG `CircleLoader` (black orbits + brand-blue
 * orbiting dot), and ThinkingIndicator was deleted — the status
 * indicator now covers both early-stream "no content yet" placeholder
 * and ongoing phase reporting in a single component. Per-state custom
 * icons can be wired in later by passing a `variant` to CircleLoader. */

const PHASE_LABEL = {
  thinking: '思考中…',
  writing:  '正在回复…',
  tool:     '正在调用工具…',
  idle:     '等待中…',
};

// Coarse phase → loader variant. `thinking` has no dedicated artwork
// yet, so it falls back to the spinner. `writing` is the model
// emitting text, which we visualise with the edit-pencil + sparkles
// icon so it reads as "agent is putting something down on paper".
const PHASE_LOADER_VARIANT = {
  thinking: 'circle',
  writing:  'edit',
  tool:     'tool',
  idle:     'circle',
};

// Fine-grained tool → loader variant. The agent emits the actual
// tool function name on each call (`read`, `write`, `edit`, `bash`,
// etc., see knowclawEventReducer.summarizeToolArgs); we map the ones
// we have dedicated artwork for and fall back to the generic 2×2
// `tool` icon for everything else (`grep`, `ls`, `find`, `fetch_web`,
// `task_manager`, `delegate_task`, `ask_user`, `save_plan`, …).
function toolNameToVariant(name) {
  switch (name) {
    case 'read':
      return 'book';
    case 'write':
    case 'edit':
      return 'edit';
    case 'bash':
      return 'terminal';
    default:
      return 'tool';
  }
}

function HeartbeatStrip({ phase, activeToolName, idleSeconds }) {
  const STALE_THRESHOLD = 30;
  const isStale = typeof idleSeconds === 'number' && idleSeconds >= STALE_THRESHOLD;

  // Resolve label + variant together because the stale branch
  // overrides the entire phase and `phase === 'tool'` needs to peek
  // at the actual tool name to pick a specific icon.
  let label;
  let variant;
  if (isStale) {
    label = `等待模型响应中…（已 ${idleSeconds}s）`;
    variant = 'circle';
  } else if (phase === 'tool') {
    label = activeToolName
      ? `正在执行 ${activeToolName}…`
      : PHASE_LABEL.tool;
    variant = toolNameToVariant(activeToolName);
  } else {
    label = PHASE_LABEL[phase] || PHASE_LABEL.idle;
    variant = PHASE_LOADER_VARIANT[phase] || PHASE_LOADER_VARIANT.idle;
  }

  return (
    <div className="flex items-center gap-2.5 py-1 mb-1">
      <CircleLoader size={22} variant={variant} />
      {/* `key={label}` triggers the fade-in keyframe on every label
          change so phase transitions look intentional rather than
          jarring. The label intentionally stays slate-500 even in the
          stale branch — the loader animation already conveys "still
          working", and the previous amber warning pill was visually
          loud out of proportion to its semantic. */}
      <span key={label} className="text-sm text-slate-500 font-medium kc-status-label">
        {label}
      </span>
    </div>
  );
}

/* ── Message bubble ── */

const MessageBubble = ({ message, projectName, domain, streamingPhase, activeToolName, idleSeconds, isLatestTasksBubble, onAskUserReply, onAskUserCancel, onAskUserSkip }) => {
  // U7: highest-priority branch — `kind:'tasks'` system bubbles are
  // rendered as a checklist card, not as a normal text/system bubble.
  // We bail out BEFORE any other branch (including the system-text
  // pill below) so an empty `message.content` doesn't render a stray
  // grey pill alongside the card.
  // D.5: only the LATEST tasks bubble renders the full TaskCard; older
  // snapshots collapse into a single summary line so stale `in_progress`
  // rows no longer keep spinning after a newer snapshot supersedes them.
  if (message.kind === 'tasks') {
    if (isLatestTasksBubble) {
      return (
        <div className="mb-4">
          <TaskCard tasks={message.tasks} ts={message.ts} />
        </div>
      );
    }
    return (
      <div className="mb-2">
        <TaskCardSummary tasks={message.tasks} ts={message.ts} />
      </div>
    );
  }

  // E.5: structured ask_user prompt bubble. Routed before the system
  // branch because ask_user bubbles have no `role` field — they're
  // identified solely by `kind`. The card handles its own answered /
  // cancelled state.
  if (message.kind === 'ask_user') {
    return (
      <div className="mb-3">
        <AskUserCard
          message={message}
          onReply={onAskUserReply}
          onCancel={onAskUserCancel}
          onSkip={onAskUserSkip}
        />
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-4">
        <div className="px-4 py-1.5 bg-gray-100 rounded-full text-xs text-gray-500">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const renderedHtml = useMemo(() => renderMarkdown(message.content), [message.content]);

  if (isUser) {
    // U4: when the user injected this message via the steer/followUp
    // queue (KnowClawV2 only — legacy chats never set `message.kind`),
    // hang a small badge above the bubble so the transcript clearly
    // marks "this was an interrupt" vs "this was queued" vs "this
    // was a fresh turn". The badge is purely informational; the
    // bubble itself keeps the same styling so existing screenshots
    // / visual regression baselines stay stable.
    const kind = message.kind;
    const showBadge = kind === 'steer' || kind === 'followUp';
    return (
      <div className="flex justify-end mb-6">
        <div className="max-w-[75%] flex flex-col items-end">
          {showBadge && (
            <div
              className={`mb-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                kind === 'steer'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
              title={
                kind === 'steer'
                  ? '打断 - 在下一个工具间隙立即送达 agent'
                  : '追问 - agent 处理完当前任务后再处理'
              }
            >
              {kind === 'steer' ? <Zap size={10} /> : <MessageSquare size={10} />}
              <span>{kind === 'steer' ? '打断' : '追问'}</span>
            </div>
          )}
          {message.attachments?.length > 0 && (
            <UserAttachments attachments={message.attachments} />
          )}
          {message.content ? (
            // File-ref chips: any `@relPath` token in the user text is
            // swapped for a coloured chip with the file basename so the
            // bubble matches the composer's chip styling instead of
            // showing a raw underline-noisy "@long/path.md". The full
            // path lives in the chip's tooltip; the bubble content
            // sent to the LLM is unchanged (see useKnowClawPersist).
            <div className="px-4 py-3 rounded-2xl rounded-br-sm bg-gray-100 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {renderTextWithFileRefs(message.content)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Assistant reply: no avatar bubble. The previous gray-circle +
  // Sparkles glyph created a "chat persona" feel that competed with
  // the new status indicator and the markdown body. Dropping it
  // lets the content sit flush with the bubble's left edge for a
  // cleaner, document-style reply.
  return (
    <div className="mb-6">
      <div className="min-w-0">
        <div className="flex-1 min-w-0">
          {/* K2: heartbeat strip — only rendered while this bubble is
              actively streaming AND the page handed down a phase. The
              KnowClawV2Page only passes phase data to the last
              streaming assistant bubble, so older bubbles never see
              this strip. */}
          {message.streaming && streamingPhase && (
            <HeartbeatStrip
              phase={streamingPhase}
              activeToolName={activeToolName}
              idleSeconds={idleSeconds}
            />
          )}
          {/* U0: thinking stream sits above the final answer so the
              user can watch reasoning unfold before content arrives. */}
          {message.thinking && (
            <ThinkingBlock
              thinking={message.thinking}
              isStreaming={Boolean(message.streaming && !message.content)}
            />
          )}

          {message.content ? (
            <>
              <CopyableMarkdown html={renderedHtml} rawText={message.content} />
              {message.streaming && (
                <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse rounded-sm ml-0.5 align-text-bottom" />
              )}
            </>
          ) : null}
          {/* No more inline ThinkingIndicator fallback here. The
              merged AgentStatusIndicator at the top of the bubble
              (HeartbeatStrip) already covers the "streaming but no
              content/thinking yet" state, so a second placeholder
              would just stack two spinners. */}

          {message.tools?.length > 0 && (
            <div className="mt-2.5 space-y-1">
              {message.tools.map((tool, i) => (
                <ToolCallCard
                  key={`${tool.name}-${i}`}
                  tool={tool}
                  projectName={projectName}
                  domain={domain}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
