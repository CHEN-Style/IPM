export function createSession(db, { id, title = '' }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_sessions (id, title, status, message_count, summary, created_at, updated_at)
    VALUES (?, ?, 'active', 0, '', ?, ?)
  `).run(id, title, now, now);
  return { id, title, status: 'active', messageCount: 0, summary: '', createdAt: now, updatedAt: now };
}

export function updateSession(db, id, patch = {}) {
  const sets = [];
  const params = {};
  if (patch.title !== undefined) { sets.push('title = @title'); params.title = patch.title; }
  if (patch.status !== undefined) { sets.push('status = @status'); params.status = patch.status; }
  if (patch.summary !== undefined) { sets.push('summary = @summary'); params.summary = patch.summary; }
  if (patch.messageCount !== undefined) { sets.push('message_count = @mc'); params.mc = patch.messageCount; }
  if (!sets.length) return;
  sets.push('updated_at = @now');
  params.now = new Date().toISOString();
  params.id = id;
  db.prepare(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function listSessions(db, opts = {}) {
  const lim = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  const off = Math.max(0, Number(opts.offset) || 0);
  const rows = db.prepare(
    'SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?',
  ).all(lim, off);
  return rows.map(rowToSession);
}

export function getSessionById(db, id) {
  const row = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
  return row ? rowToSession(row) : null;
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
}

export function markActiveSessions(db, newStatus = 'interrupted') {
  const result = db.prepare(
    "UPDATE chat_sessions SET status = ?, updated_at = ? WHERE status = 'active'",
  ).run(newStatus, new Date().toISOString());
  return result.changes;
}

function rowToSession(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    messageCount: row.message_count,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
