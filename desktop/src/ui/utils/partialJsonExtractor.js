// desktop/src/ui/utils/partialJsonExtractor.js
//
// R4: incremental extraction of partial JSON produced by an LLM
// generating a tool call's arguments. pi-ai emits `toolcall_delta`
// chunks that, when concatenated, form a JSON object payload like
//
//   { "path": "foo.html", "content": "<html>\n<bo
//
// Mid-stream we want the renderer to already know:
//   - the target path (usually completed early in the stream)
//   - whatever portion of the long `content` blob has arrived,
//     properly un-escaped so the FileChangePreview can show it
//     as plain text with line breaks rather than literal "\n".
//
// JSON.parse(buffer) only works once the stream is complete, so we
// fall back to scanning helpers that tolerate truncation.
//
// These helpers are intentionally tool-shape aware (write / edit)
// rather than a generic incremental JSON parser — keeping the v1
// surface tiny avoids pulling in a dependency just to render a
// streaming code block.

// Match a fully completed JSON string field value. Allows escaped
// quotes inside via the standard `(?:[^"\\]|\\.)*` body.
const STRING_FIELD_RE = (name) =>
  new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);

// Single-char JSON escapes.
const SIMPLE_ESCAPES = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

// Decode a JSON-escaped string body (everything between the opening
// and closing `"`), gracefully truncating at the first unescaped `"`
// or at the start of an incomplete escape sequence.
//
// Returns { text, terminated }:
//   - text: the decoded prefix
//   - terminated: true when we hit an unescaped closing quote, false
//     when we ran out of input (stream still in flight)
function decodePartialString(raw) {
  let out = '';
  let i = 0;
  let terminated = false;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      terminated = true;
      break;
    }
    if (c === '\\') {
      if (i + 1 >= raw.length) {
        // Incomplete trailing escape — drop the lone backslash so the
        // preview doesn't flash a literal "\".
        break;
      }
      const next = raw[i + 1];
      if (next === 'u') {
        if (i + 6 > raw.length) break; // incomplete \uXXXX
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
        } else {
          // Malformed — surface the raw sequence verbatim so we don't
          // silently swallow user-visible content.
          out += '\\u' + hex;
        }
        i += 6;
        continue;
      }
      if (next in SIMPLE_ESCAPES) {
        out += SIMPLE_ESCAPES[next];
        i += 2;
        continue;
      }
      // Unknown escape — preserve the escaped char literally.
      out += next;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return { text: out, terminated };
}

// Locate the position immediately after a `"<name>"\s*:\s*"` opener
// inside `buffer`, returning -1 when the opener has not yet appeared.
function findStringFieldStart(buffer, name) {
  const re = new RegExp(`"${name}"\\s*:\\s*"`);
  const m = re.exec(buffer);
  if (!m) return -1;
  return m.index + m[0].length;
}

// Try a full JSON.parse first; that always wins when the stream is
// complete and avoids the slower regex/scan path.
function tryFullParse(buffer) {
  try {
    return JSON.parse(buffer);
  } catch {
    return null;
  }
}

// Extract a completed string field via regex (path / filename style
// fields that finish early in the stream).
function extractCompletedStringField(buffer, name) {
  const m = STRING_FIELD_RE(name).exec(buffer);
  return m ? m[1] : null;
}

// R4: extract whatever shape of `write` args we can pull from a
// streaming JSON buffer.
//
// Returns `null` when nothing useful is available yet (e.g. only
// `{"pa` has arrived). Otherwise returns
//   { path?: string, content?: string, _partial: boolean }
// where `_partial` is true while the underlying JSON is still
// incomplete.
export function tryExtractWriteArgs(buffer) {
  if (typeof buffer !== 'string' || buffer.length === 0) return null;

  const full = tryFullParse(buffer);
  if (full && typeof full === 'object') {
    return {
      path: typeof full.path === 'string' ? full.path : undefined,
      content: typeof full.content === 'string' ? full.content : undefined,
      _partial: false,
    };
  }

  const out = { _partial: true };

  const completedPath = extractCompletedStringField(buffer, 'path');
  if (completedPath != null) out.path = completedPath;

  const contentStart = findStringFieldStart(buffer, 'content');
  if (contentStart >= 0) {
    const slice = buffer.slice(contentStart);
    const { text } = decodePartialString(slice);
    if (text) out.content = text;
    else if (!out.path) {
      // Edge case: `"content":"` appeared but nothing decodable yet
      // and we also don't have a path → still surface an empty content
      // marker so the preview can render a placeholder header.
      out.content = '';
    } else {
      out.content = '';
    }
  }

  if (out.path == null && out.content == null) return null;
  return out;
}

// R4: extract a partial `edit` shape. v1 only attempts the path
// (and the full edits list once the JSON is complete) — incremental
// diff rendering would require a streaming JSON parser, deferred to
// a follow-up.
export function tryExtractEditArgs(buffer) {
  if (typeof buffer !== 'string' || buffer.length === 0) return null;

  const full = tryFullParse(buffer);
  if (full && typeof full === 'object') {
    return {
      path: typeof full.path === 'string' ? full.path : undefined,
      edits: Array.isArray(full.edits) ? full.edits : undefined,
      _partial: false,
    };
  }

  const completedPath = extractCompletedStringField(buffer, 'path');
  if (completedPath == null) return null;
  return { path: completedPath, _partial: true };
}

// R4: dispatcher used by the event handler.
export function tryExtractPartialArgs(toolName, buffer) {
  if (toolName === 'write') return tryExtractWriteArgs(buffer);
  if (toolName === 'edit') return tryExtractEditArgs(buffer);
  return null;
}
