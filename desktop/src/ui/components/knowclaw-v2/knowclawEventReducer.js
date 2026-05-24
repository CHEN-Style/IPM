// desktop/src/ui/components/knowclaw-v2/knowclawEventReducer.js
//
// D.1: Pure helper functions used by the KnowClaw v2 event handler.
// Extracted out of `useKnowClawV2Chat.js` so the App-level
// `KnowClawPersistProvider` and any future renderer can share the
// exact same message-mapping logic without duplicating it.
//
// These functions are deliberately stateless — they take a snapshot
// of `messages` (or a small subset of event fields) and return a new
// array / value. State mutations (setMessages, setStreaming, ...) are
// performed by the caller in the provider scope.

// Ensure the message list ends with an "in-flight" assistant bubble.
// Idempotent — if the last bubble is already a streaming assistant
// bubble, returns the input unchanged.
export function ensureStreamingMessage(messages) {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last?.streaming) return messages;
  return [
    ...messages,
    { role: 'assistant', content: '', streaming: true, tools: [], ts: Date.now() },
  ];
}

// Convert a pi tool-result payload (often `[{ type: 'text', text }]`)
// into a single displayable string. Never throws — falls back to
// JSON.stringify or String() on any odd shape.
export function stringifyResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    const texts = result
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : null))
      .filter(Boolean);
    if (texts.length > 0) return texts.join('\n');
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// Apply a partial patch to a tool entry inside an assistant bubble,
// matched by toolCallId. Walks the messages array from the tail
// because in-flight tool calls always live on the latest bubble.
// Returns the input unchanged when no match is found.
export function updateToolByCallId(messages, toolCallId, patch) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tools)) {
      const idx = msg.tools.findIndex((t) => t.toolCallId === toolCallId);
      if (idx >= 0) {
        const updatedTools = msg.tools.map((t, j) => (j === idx ? { ...t, ...patch } : t));
        return [...messages.slice(0, i), { ...msg, tools: updatedTools }, ...messages.slice(i + 1)];
      }
    }
  }
  return messages;
}

// K2: convert any path (absolute / posix / windows) into a posix-style
// relative path against `cwd`. Returns null when the candidate isn't
// inside the cwd subtree.
export function toRelPosix(cwd, candidate) {
  if (!cwd || !candidate) return null;
  const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
  const cwdN = norm(cwd);
  const cN = norm(candidate);
  if (cN.toLowerCase().startsWith(cwdN.toLowerCase() + '/')) {
    return cN.slice(cwdN.length + 1);
  }
  if (cN.toLowerCase() === cwdN.toLowerCase()) return '';
  if (!/^([a-zA-Z]:|\/)/.test(cN)) {
    return cN.replace(/^\.\//, '');
  }
  return null;
}

// K2: pi's `write` / `edit` / `read` tools put the target file in
// args.path; `bash` carries a command string. We best-effort scan
// `bash` commands for create/copy/move syntax so files produced via
// shell still light up in the workspace tree.
export function extractTouchedFilesFromEvent(event) {
  const out = [];
  const name = event?.toolName || '';
  const args = (event && typeof event.args === 'object' && event.args) || null;
  if (!args) return out;
  if (name === 'write') {
    if (typeof args.path === 'string') out.push({ path: args.path, action: 'new' });
  } else if (name === 'edit') {
    if (typeof args.path === 'string') out.push({ path: args.path, action: 'edited' });
  } else if (name === 'bash') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    if (!cmd) return out;
    const patterns = [
      /\btouch\s+([^;&|<>\s]+)/g,
      /\bmkdir(?:\s+-p)?\s+([^;&|<>\s]+)/g,
      /\bcp\s+(?:-[^\s]+\s+)*[^;&|<>\s]+\s+([^;&|<>\s]+)/g,
      /\bmv\s+(?:-[^\s]+\s+)*[^;&|<>\s]+\s+([^;&|<>\s]+)/g,
      />>?\s+([^;&|<>\s]+)/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(cmd)) !== null) {
        const p = m[1];
        if (p) out.push({ path: p, action: 'new' });
      }
    }
  }
  return out;
}

// K2: human-readable summary of a tool call (rendered in ToolCallCard).
// Kept short — full args/result are visible inside the expanded card.
export function summarizeToolArgs(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const shorten = (s, n = 80) => {
    const str = String(s ?? '');
    if (str.length <= n) return str;
    return str.slice(0, n) + '…';
  };
  switch (name) {
    case 'read':
      return a.path ? `读取 ${a.path}` : '';
    case 'write':
      return a.path ? `写入 ${a.path}` : '';
    case 'edit':
      return a.path ? `编辑 ${a.path}` : '';
    case 'ls':
      return a.path ? `列出 ${a.path}` : '';
    case 'grep':
      return a.pattern ? `搜索 “${shorten(a.pattern, 40)}”${a.path ? ' in ' + a.path : ''}` : '';
    case 'find':
      return a.pattern ? `查找 “${shorten(a.pattern, 40)}”${a.path ? ' in ' + a.path : ''}` : '';
    case 'bash':
      return a.command ? shorten(a.command, 80) : '';
    case 'search_web':
      return a.query ? `搜索: ${shorten(a.query, 60)}` : '';
    case 'fetch_web': {
      if (!a.url) return '';
      try {
        const u = new URL(a.url);
        return a.rendered ? `渲染抓取: ${u.hostname}` : `抓取: ${u.hostname}`;
      } catch {
        return `抓取: ${shorten(a.url, 60)}`;
      }
    }
    case 'task_manager': {
      const n = Array.isArray(a.tasks) ? a.tasks.length : 0;
      return n > 0 ? `更新任务清单（${n} 项）` : '更新任务清单';
    }
    case 'delegate_task':
      return a.task ? shorten(a.task, 80) : '';
    case 'ask_user': {
      const n = Array.isArray(a.questions) ? a.questions.length : 0;
      return n > 0 ? `向用户提问（${n} 题）` : '向用户提问';
    }
    case 'save_plan':
      return a.filename ? `保存方案: ${shorten(String(a.filename), 60)}` : '保存方案到 .knowclaw/plans/';
    case 'check_environment':
      return a.tool ? `检查 ${a.tool}` : '检查运行环境';
    default:
      return '';
  }
}

// U7: minimal task-array shape normalisation. Accepts whatever the
// model handed task_manager and returns only the valid {id, title,
// status} (+ optional notes) entries. Malformed entries are silently
// dropped — task_manager itself does its own validation on the
// runtime side, but rendering should never trip over a bad payload.
export function normalizeTasksArray(raw) {
  if (!Array.isArray(raw)) return [];
  const normalized = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const id = typeof t.id === 'string' ? t.id : '';
    const title = typeof t.title === 'string' ? t.title : '';
    const status = typeof t.status === 'string' ? t.status : 'pending';
    if (!id || !title) continue;
    const entry = { id, title, status };
    if (typeof t.notes === 'string' && t.notes) entry.notes = t.notes;
    normalized.push(entry);
  }
  return normalized;
}
