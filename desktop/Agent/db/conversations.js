import { randomUUID } from 'node:crypto';

export function appendConversation(db, { sessionId, summary, topics = [] }) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const topicsStr = JSON.stringify(topics);

  db.prepare(`
    INSERT INTO conversations (id, session_id, ts, summary, topics, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, now, summary, topicsStr, now);

  return { id, sessionId, ts: now, summary, topics, createdAt: now };
}

export function listConversations(db, opts = {}) {
  const lim = Math.min(100, Math.max(1, Number(opts.limit) || 20));
  const off = Math.max(0, Number(opts.offset) || 0);

  const rows = db.prepare('SELECT * FROM conversations ORDER BY ts DESC LIMIT ? OFFSET ?').all(lim, off);

  return rows.map(rowToConversation);
}

export function getConversationsBySession(db, sessionId) {
  const rows = db.prepare('SELECT * FROM conversations WHERE session_id = ? ORDER BY ts ASC').all(sessionId);
  return rows.map(rowToConversation);
}

export function trimConversations(db, maxCount = 20) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM conversations').get()?.cnt || 0;
  if (count <= maxCount) return 0;

  const toDelete = count - maxCount;
  const result = db.prepare(`
    DELETE FROM conversations WHERE id IN (
      SELECT id FROM conversations ORDER BY ts ASC LIMIT ?
    )
  `).run(toDelete);

  return result.changes;
}

function rowToConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    ts: row.ts,
    summary: row.summary,
    topics: safeParse(row.topics, []),
    createdAt: row.created_at,
  };
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
