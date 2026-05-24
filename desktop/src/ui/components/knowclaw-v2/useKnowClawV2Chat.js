// desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js
//
// D.1: this hook used to own every piece of KnowClaw v2 state. The
// problem was that on page navigation (e.g. switching to MyData) the
// hook unmounted, dropped its `onEvent` listener, and discarded the
// message buffer — so streaming events sent by the main process
// during that window were lost permanently.
//
// After D.1 all conversation state lives in `KnowClawPersistProvider`
// (mounted at App level — see `desktop/src/ui/hooks/useKnowClawPersist.jsx`).
// This file is now a thin facade that:
//
//   - Pulls state + actions out of the App-level Context.
//   - Owns one piece of *page-local* UI state (`showSessionPanel`)
//     because it has no reason to survive page navigation and is
//     unrelated to the live session.
//
// The exported shape is intentionally backwards-compatible with the
// pre-D.1 version so `KnowClawV2Page.jsx` keeps working without
// touching every prop binding.
//
// `summarizeToolArgs` is still re-exported here because
// `agent-chat/MessageBubble.jsx` imports it from this module path —
// rather than churning that import we keep the re-export and point
// callers at the new home in `knowclawEventReducer.js`.

import { useState } from 'react';
import { useKnowClawPersist } from '../../hooks/useKnowClawPersist.jsx';

export { summarizeToolArgs } from './knowclawEventReducer.js';

export default function useKnowClawV2Chat() {
  const ctx = useKnowClawPersist();

  // Page-local UI: whether the historical session drawer is open.
  // This doesn't survive page navigation by design — the panel is a
  // disclosure affordance of this page, not a global preference.
  const [showSessionPanel, setShowSessionPanel] = useState(false);

  return {
    ...ctx,
    showSessionPanel,
    setShowSessionPanel,
  };
}
