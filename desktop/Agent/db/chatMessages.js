export function appendMessage(db, { sessionId, role, content = '', toolsJson = '[]' }) {
  const now = new Date().toISOString();
  const tools = typeof toolsJson === 'string' ? toolsJson : JSON.stringify(toolsJson);
  const info = db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, tools_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, role, content, tools, now);
  return { id: info.lastInsertRowid, sessionId, role, content, toolsJson: tools, createdAt: now };
}

export function listMessages(db, sessionId) {
  const rows = db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
  ).all(sessionId);
  return rows.map(rowToMessage);
}

export function countMessages(db, sessionId) {
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?',
  ).get(sessionId);
  return row?.cnt || 0;
}

function rowToMessage(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    tools: safeParse(row.tools_json, []),
    createdAt: row.created_at,
  };
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
