// desktop/src/ui/components/knowclaw-v2/KnowClawIcon.jsx
//
// Single source of truth for rendering the KnowClaw brand mark.
// Replaces the various lucide-react `Zap` / `Brain` placeholders we
// previously used as stand-ins.
//
// Two artwork files:
//   - `KnowClawBlack.png`  — dark orbits, used on light surfaces
//                            (white card, light gradient, sidebar bg)
//   - `KnowClawBright.png` — light/white orbits, used on dark surfaces
//                            (amber→orange gradient header, violet
//                            gradient floating bubble, etc.)
//
// Pick the right asset via `tone`:
//   tone = 'bright'  → bright/white icon (for DARK backgrounds)
//   tone = 'dark'    → dark/black icon  (for LIGHT backgrounds)
//
// The PNG has built-in margin on the canvas (the orbits don't reach
// the canvas edge). To stay visually similar to the old lucide icon
// at the same nominal `size`, callers should generally bump the
// requested `size` by ~10–15% relative to the lucide size they
// replaced. We document the original sizes inline at each call site.

import React from 'react';
import darkUrl from '../../../../assets/KnowClawBlack.png';
import brightUrl from '../../../../assets/KnowClawBright.png';

const KnowClawIcon = ({ tone = 'dark', size = 20, className = '', alt = 'KnowClaw' }) => {
  const src = tone === 'bright' ? brightUrl : darkUrl;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none pointer-events-none object-contain ${className}`}
    />
  );
};

export default KnowClawIcon;
