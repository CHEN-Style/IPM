// desktop/src/ui/components/agent-chat/fileRefRender.jsx
//
// Shared parsing + rendering helpers for the `@relPath` file-reference
// syntax KnowClaw uses inside the composer textarea and the user
// message bubble. Both surfaces show the same chip-style visual so a
// reference looks identical before and after sending.
//
// Two consumers:
//
//   - `MessageBubble.jsx` calls `renderTextWithFileRefs(text)` to swap
//     each `@relPath` substring with a `<FileRefChip>` inside the
//     user bubble. No alignment constraints — the chip just flows
//     inline with surrounding text.
//
//   - `ChatInput.jsx` uses `parseFileRefs(text)` to build a highlight
//     overlay div that mirrors the textarea content. There the text
//     segments stay invisible (the textarea below renders them) but
//     the @-tokens are wrapped in a pill background so the user sees
//     coloured rectangles overlaid on top of the textarea characters.
//     Alignment depends on the overlay using identical font / padding
//     / line-height to the textarea — see ChatInput for that
//     wiring.
//
// `@`-tokens are extracted with a tolerant regex: `@` followed by one
// or more characters that aren't whitespace, an `@` sign, or one of
// `<>"|*`. Trailing punctuation (`.,;:!?）)]}】〕》】，。、；：！？`) is
// stripped so the chip doesn't eat the closing punctuation of a
// sentence like "see @docs/foo.md." — the dot stays outside the chip.

import React from 'react';
import { FileText } from 'lucide-react';

// Trailing characters we never include in a path segment. Mixes
// ASCII + common Chinese punctuation so sentences in either language
// don't drag their terminator into the chip.
const TRAILING_PUNCT = '.,;:!?）)]}】〕》〉，。、；：！？';

// Characters that legitimately appear inside a path (Latin, CJK,
// digits, plus / \ . _ - ~ : %).  Anything else terminates the path
// (notably whitespace, `@`, and the file-system illegal set
// <>"|*).
const PATH_TOKEN_SRC = '@([^\\s@<>"|*]+)';

function trimTrailingPunct(s) {
  let end = s.length;
  while (end > 0 && TRAILING_PUNCT.includes(s[end - 1])) end -= 1;
  return [s.slice(0, end), s.slice(end)];
}

/**
 * Parse a chat-message string into a flat array of segments.
 *
 * Each chip segment may carry a `trailingSpace` flag. When set, the
 * single space character that follows the `@path` in the source text
 * is considered part of the chip's visual extent (it lives inside the
 * chip background). This is how we give the chip visible padding
 * between the path text and the right edge of the chip without
 * fighting the textarea-overlay alignment constraint — the space is
 * a real character that exists in both surfaces, so layout stays
 * synchronised; we just decorate it with the chip background.
 *
 * Every segment also carries `start` / `end` indices into the source
 * string. `findChipForDeletion` below uses these to map a textarea
 * caret position onto an atomic chip range so Backspace / Delete can
 * remove the chip as one unit instead of nibbling characters off.
 *
 * @param {string} text
 * @returns {Array<{ type: 'text', value: string, start: number, end: number } | { type: 'chip', path: string, trailingSpace: boolean, start: number, end: number }>}
 */
export function parseFileRefs(text) {
  const src = String(text ?? '');
  if (!src) return [];
  const out = [];
  let last = 0;
  const re = new RegExp(PATH_TOKEN_SRC, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    if (start > last) {
      out.push({ type: 'text', value: src.slice(last, start), start: last, end: start });
    }
    const [path, tail] = trimTrailingPunct(m[1] || '');
    const matchEnd = start + m[0].length;
    if (!path) {
      out.push({ type: 'text', value: m[0], start, end: matchEnd });
      last = matchEnd;
      continue;
    }
    // Look one character past the path token: if the user typed a
    // space there (very common — `insertReferences` always appends
    // one), absorb that space into the chip so the chip background
    // visibly extends past the last path character. Skip this if
    // trailing punctuation was trimmed (the punctuation sits between
    // path and any space, so the chip background would awkwardly
    // jump over the punctuation if we tried to include the space).
    let trailingSpace = false;
    let resumeAt = matchEnd;
    if (!tail && matchEnd < src.length && src[matchEnd] === ' ') {
      trailingSpace = true;
      resumeAt = matchEnd + 1;
      re.lastIndex = resumeAt;
    }
    out.push({ type: 'chip', path, trailingSpace, start, end: resumeAt });
    if (tail) {
      out.push({ type: 'text', value: tail, start: matchEnd - tail.length, end: matchEnd });
    }
    last = resumeAt;
  }
  if (last < src.length) {
    out.push({ type: 'text', value: src.slice(last), start: last, end: src.length });
  }
  return out;
}

/**
 * Locate the chip segment that a Backspace / Delete keystroke should
 * remove atomically, given the current caret position. Returns the
 * chip segment (with `start` / `end` ranges) or `null` if no chip is
 * adjacent and the caret should fall through to normal one-character
 * deletion.
 *
 * Caret rules:
 *   - `direction = 'backward'` (Backspace): catch chips whose range
 *     ENDS at or covers the caret — i.e. the caret sits anywhere in
 *     `(seg.start, seg.end]`. A caret exactly at `seg.start` is
 *     *before* the chip and should delete the previous character
 *     instead.
 *   - `direction = 'forward'` (Delete): mirror image — catch chips
 *     whose range STARTS at or covers the caret, `[seg.start, seg.end)`.
 *     A caret exactly at `seg.end` is *after* the chip and should
 *     delete the next character instead.
 *
 * @param {Array<ReturnType<typeof parseFileRefs>[number]>} segments
 * @param {number} caret position in source text
 * @param {'backward' | 'forward'} direction
 */
export function findChipForDeletion(segments, caret, direction) {
  for (const seg of segments) {
    if (seg.type !== 'chip') continue;
    if (direction === 'backward') {
      if (caret > seg.start && caret <= seg.end) return seg;
    } else {
      if (caret >= seg.start && caret < seg.end) return seg;
    }
  }
  return null;
}

/**
 * Last segment of a forward/back-slash separated path. Used as the
 * chip label so long workspace-relative paths don't blow the bubble
 * width. The full path goes into the tooltip.
 */
export function fileBasename(path) {
  const s = String(path || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Inline chip used in user message bubbles. Mirrors the visual
 * vocabulary of the screenshot the user provided (light cyan
 * background + file icon + basename + rounded pill).
 *
 * Not used directly inside the ChatInput overlay — see
 * `renderHighlightOverlay` below for the alignment-preserving
 * version.
 */
export function FileRefChip({ path, className = '' }) {
  const label = fileBasename(path) || path;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 mx-0.5 rounded-md text-[11px] font-normal bg-sky-50 text-sky-600 ring-1 ring-sky-300/70 align-baseline leading-[1.5] ${className}`}
      title={`@${path}`}
    >
      <FileText size={11} strokeWidth={1.6} className="shrink-0 opacity-80" />
      <span className="truncate max-w-[220px]">{label}</span>
    </span>
  );
}

/**
 * Render plain text + chips for use inside a user message bubble.
 * Preserves whitespace (the bubble wraps with `whitespace-pre-wrap`
 * so newlines come through directly).
 */
export function renderTextWithFileRefs(text) {
  const segments = parseFileRefs(text);
  if (segments.length === 0) return null;
  return segments.map((seg, i) => {
    if (seg.type === 'chip') {
      // The trailing space (when parsed in) is rendered AFTER the
      // chip element itself, not inside it — the message-bubble chip
      // has its own padding so the space here is purely a separator
      // from the next inline text node.
      return (
        <React.Fragment key={`chip-${i}`}>
          <FileRefChip path={seg.path} />
          {seg.trailingSpace ? ' ' : ''}
        </React.Fragment>
      );
    }
    return <React.Fragment key={`txt-${i}`}>{seg.value}</React.Fragment>;
  });
}

/**
 * Render the highlight overlay that sits behind the ChatInput
 * textarea. Returns inline React nodes that match the textarea's
 * own font metrics so the overlay characters line up exactly with
 * the textarea characters underneath.
 *
 * The overlay wrapper is rendered with `text-transparent`, so all
 * characters are invisible — only the chip background + ring decoration
 * shows through. The textarea on top draws the actual glyphs (in
 * normal text colour) in lock-step, so the user sees: textarea text
 * overlaid on a chip-shaped background wherever a `@path` token sits.
 *
 * Critical layout invariants:
 *   - The wrapper element MUST share padding / font-size / font-family
 *     / line-height / letter-spacing with the textarea.
 *   - The wrapper MUST use `whitespace-pre-wrap` and `break-words` so
 *     line breaks happen at the same positions.
 *   - Chip background uses inline-aligned padding (px-0 mx-0) — the
 *     character `@path` stays the same width as in the textarea, only
 *     the *background* is decorated. Anything that changes width
 *     would shift subsequent characters and desynchronise the cursor.
 *   - `box-decoration-clone` lets the chip background wrap across
 *     line breaks (e.g. `@very/long/path` that wraps inside the
 *     composer) without leaving the second-line fragment unhighlighted.
 *   - We append a trailing zero-width space so an empty last line is
 *     still measured (matches how textarea reserves a phantom
 *     character for caret positioning at end-of-text).
 */
export function renderHighlightOverlay(text) {
  const segments = parseFileRefs(text);
  const nodes = [];
  segments.forEach((seg, i) => {
    if (seg.type === 'chip') {
      // Visible pill: light-sky fill + a ring so the chip reads as a
      // distinct framed badge, not just a faint highlight.
      //
      // Why no `padding + negative margin` trick here anymore:
      //   That technique extended the background past the chip's
      //   layout box. At the line edges and where a chip touched
      //   neighbouring text, the background bled outside the
      //   textarea content area or over adjacent characters, which
      //   the user described as "padding 导致元素重叠". Instead we
      //   widen the chip by absorbing the trailing space character
      //   into the chip span (see parseFileRefs above) — that space
      //   is a real character with width-in-source, so the chip's
      //   box grows by exactly one space without breaking textarea
      //   alignment. Visually the user sees the chip border sitting
      //   a space-width away from the last path character, which
      //   reads as comfortable interior padding.
      //
      //   A tiny 1px vertical halo via padding+negative-margin is
      //   still safe: vertical inline padding does not push other
      //   inline glyphs around, it just extends the background
      //   above and below the line. No overlap risk.
      //
      //   `box-decoration-clone` keeps rounded corners + ring
      //   correct when a long chip wraps onto a second line.
      nodes.push(
        <span
          key={`chip-${i}`}
          className="rounded-md bg-sky-50 ring-1 ring-sky-300/70 box-decoration-clone"
          style={{ padding: '1px 0', margin: '-1px 0' }}
        >
          @{seg.path}{seg.trailingSpace ? ' ' : ''}
        </span>,
      );
    } else {
      nodes.push(
        <React.Fragment key={`txt-${i}`}>{seg.value}</React.Fragment>,
      );
    }
  });
  nodes.push(<React.Fragment key="trail">{'\u200B'}</React.Fragment>);
  return nodes;
}
