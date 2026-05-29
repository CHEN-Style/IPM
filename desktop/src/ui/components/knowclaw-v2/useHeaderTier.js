// desktop/src/ui/components/knowclaw-v2/useHeaderTier.js
//
// E.6: derive a 3-tier responsive layout flag (wide / medium / compact)
// from the actual measured width of the header right cluster, NOT from
// viewport breakpoints. The header sits inside a flex layout whose
// available width depends on whether the side session panel is open,
// whether the file tree is open, OS chrome, etc — viewport queries
// can't see any of that, but ResizeObserver on the container can.
//
// Tier semantics (consumed by KnowClawV2Page):
//   wide    — every control inline + full text label
//   medium  — every control inline + label hidden (icon-only)
//   compact — primary controls inline, the rest collapsed into an
//             overflow popover (... button → HeaderOverflowMenu)
//
// Hysteresis: we cache the previous tier and require the new width
// to cross the boundary by HYSTERESIS_PX before flipping. This kills
// the jitter you get when the user slowly drags a window edge across
// a threshold (otherwise the layout would thrash between tiers every
// few px).

import { useEffect, useRef, useState } from 'react';

// Thresholds tuned against the FULL HEADER row width (which equals
// the chat-column window width, since the header sits flush with the
// viewport edges minus padding). Measuring the outer header — not
// the inner right cluster — avoids a feedback loop where wide-tier
// controls have larger intrinsic width than what their own container
// can hold, which would jitter tier across renders.
//
// Budget reasoning after K2/K3: the header can be inside a much
// narrower chat column even when the app window is fullscreen because
// SessionPanel (w-72) and WorkspaceFileTree (w-72) can both be open.
// The old 1280/980 breakpoints were tuned for the no-side-panel case
// and still allowed the "medium" toolbar to squeeze badly. Be more
// conservative: below ~1180px the header becomes a two-line compact
// layout; above that medium keeps all primary controls inline with
// icon-only secondary controls.
const WIDE_MIN_PX    = 1500;
const MEDIUM_MIN_PX  = 1180;
const HYSTERESIS_PX  = 40;

function classifyWidth(width, prevTier) {
  // No prevTier yet → straight classification, no hysteresis.
  if (!prevTier) {
    if (width >= WIDE_MIN_PX)   return 'wide';
    if (width >= MEDIUM_MIN_PX) return 'medium';
    return 'compact';
  }
  // Apply hysteresis: only upgrade tier if width is clearly past the
  // threshold; only downgrade if clearly below. Inside the deadband
  // the tier sticks.
  if (prevTier === 'compact') {
    if (width >= MEDIUM_MIN_PX + HYSTERESIS_PX) {
      return width >= WIDE_MIN_PX + HYSTERESIS_PX ? 'wide' : 'medium';
    }
    return 'compact';
  }
  if (prevTier === 'medium') {
    if (width >= WIDE_MIN_PX + HYSTERESIS_PX) return 'wide';
    if (width <  MEDIUM_MIN_PX - HYSTERESIS_PX) return 'compact';
    return 'medium';
  }
  // prev === 'wide'
  if (width < WIDE_MIN_PX - HYSTERESIS_PX) {
    return width < MEDIUM_MIN_PX - HYSTERESIS_PX ? 'compact' : 'medium';
  }
  return 'wide';
}

export default function useHeaderTier(containerRef) {
  // Default to 'wide' so first paint matches the historical layout;
  // ResizeObserver will downgrade on the very next frame if needed.
  const [tier, setTier] = useState('wide');
  const tierRef = useRef('wide');

  useEffect(() => {
    const el = containerRef?.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const update = (width) => {
      const next = classifyWidth(width, tierRef.current);
      if (next !== tierRef.current) {
        tierRef.current = next;
        setTier(next);
      }
    };

    // Seed once synchronously so we don't render one frame of 'wide'
    // when the real container is narrow.
    update(el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect?.width ?? entry.target.getBoundingClientRect().width;
        update(w);
      }
    });
    observer.observe(el);

    return () => {
      try { observer.disconnect(); } catch { /* ignore */ }
    };
  }, [containerRef]);

  return tier;
}
