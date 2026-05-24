// desktop/src/ui/components/knowclaw-v2/ChatNavTrack.jsx
//
// E.1: DeepSeek-style side navigation rail for the chat transcript.
//
// Interaction model (v3, matches DeepSeek 1:1 per dogfood feedback):
//
//   Collapsed (idle):
//     Just a thin vertical column of short horizontal tick marks,
//     12px in from the right edge. Looks like a discreet sidebar
//     ornament. No text, no panel background.
//
//   Expanded (rail hovered):
//     The entire rail morphs into a dark floating card. To the LEFT
//     of every tick, the snippet preview (~24 chars) of that user
//     turn appears. The card has a max-height and scrolls internally
//     if the conversation is long.
//
//   Item hovered (single row in the expanded card):
//     That row's snippet turns blue + medium-weight, and its tick
//     widens / thickens / gains blue tint. Click the row to
//     smooth-scroll the corresponding bubble into view.
//
// Implementation note: we use Tailwind v4 named groups
// (`group/nav`, `group/item`) so the entire interaction is
// CSS-only, no React state for hover. This is way smoother than
// onMouseEnter-driven re-renders and avoids any flicker when the
// pointer crosses tick → snippet inside the same row.
//
// Only `role === 'user'` messages produce rows. assistant / system
// / tasks bubbles would crowd the rail without adding navigational
// value. Bails out (returns null) when fewer than 2 user turns
// exist — single-turn conversations don't need a TOC.

import React, { useCallback, useMemo } from 'react';

export default function ChatNavTrack({ messages, scrollContainerRef }) {
  const userAnchors = useMemo(() => {
    const anchors = [];
    if (!Array.isArray(messages)) return anchors;
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      if (m?.role !== 'user') continue;
      const raw = typeof m.content === 'string' ? m.content : '';
      const flat = raw.replace(/\s+/g, ' ').trim();
      anchors.push({
        index: i,
        snippet: flat.slice(0, 24),
        hasMore: flat.length > 24,
      });
    }
    return anchors;
  }, [messages]);

  const scrollToAnchor = useCallback((index) => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    const el = container.querySelector(`[data-msg-index="${index}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollContainerRef]);

  if (userAnchors.length < 2) return null;

  return (
    // E.1 v3: outer wrapper owns the named `group/nav` so children
    // can react to its hover state. It also owns the vertical
    // centring (top-1/2 + -translate-y-1/2). `right-3` keeps a 12px
    // breathing gap from the scrollbar / right edge.
    <div
      className="group/nav absolute top-1/2 -translate-y-1/2 right-3 z-10"
      role="navigation"
      aria-label="对话节点导航"
    >
      {/* Card surface. Transparent + invisible borders when idle;
          light card (white + slate ring + soft shadow) when
          hovered, matching the page's light theme — same surface
          palette as the "回到底部" floating button and the right
          WorkspaceFileTree panel. The transition is on colors +
          shadow only — geometry (max-width) is handled per-row
          below so the card grows rightward smoothly as snippets
          reveal. */}
      <div
        className="flex flex-col items-end gap-0.5 py-2 px-2.5 rounded-xl
                   bg-transparent ring-1 ring-transparent shadow-none
                   group-hover/nav:bg-white/95 group-hover/nav:ring-slate-200
                   group-hover/nav:shadow-lg group-hover/nav:backdrop-blur-sm
                   transition-[background-color,box-shadow] duration-200
                   max-h-[70vh] overflow-y-auto scrollbar-hide"
      >
        {userAnchors.map((anchor) => (
          <button
            type="button"
            key={anchor.index}
            onClick={() => scrollToAnchor(anchor.index)}
            // E.1 v3: per-row named group so the tick + snippet
            // light up together when this row is hovered.
            className="group/item flex items-center justify-end gap-2.5 py-1 w-full cursor-pointer"
            title={anchor.snippet ? `${anchor.snippet}${anchor.hasMore ? '…' : ''}` : '用户消息'}
          >
            {/* Snippet preview. `max-w-0` + `opacity-0` keeps the
                text *truly* collapsed when the rail is idle (so
                the card's footprint is just the tick column). On
                rail hover it expands to ~220px with a fade-in.
                On row hover the text tints blue + bolds. Default
                text colour is slate-600 to read well on the light
                card background. */}
            <span
              className="overflow-hidden whitespace-nowrap text-[12px] leading-tight text-left
                         max-w-0 opacity-0
                         text-slate-600
                         group-hover/nav:max-w-[220px] group-hover/nav:opacity-100
                         group-hover/item:text-blue-600 group-hover/item:font-medium
                         transition-[max-width,opacity,color,font-weight] duration-200"
            >
              {anchor.snippet}
              {anchor.hasMore ? '…' : ''}
            </span>

            {/* Tick mark. Stays slightly translucent in idle so it
                doesn't compete with the messages behind. Inside
                the light panel (group-hover/nav) it firms up to
                solid slate. Row hover widens + thickens + tints
                blue to match the snippet highlight. */}
            <span
              className="shrink-0 h-px w-3.5 rounded-full bg-slate-300/80
                         group-hover/nav:bg-slate-400
                         group-hover/item:bg-blue-500 group-hover/item:w-5 group-hover/item:h-[2px]
                         transition-all duration-150"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
