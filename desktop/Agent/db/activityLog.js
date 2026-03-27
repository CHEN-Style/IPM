export function appendLog(db, event, data = {}, extra = {}) {
  const ts = new Date().toISOString();
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const sessionId = extra.sessionId || '';
  const undoData = extra.undoData ? JSON.stringify(extra.undoData) : '{}';
  db.prepare(
    'INSERT INTO activity_log (ts, event, data, session_id, is_undone, undo_data) VALUES (?, ?, ?, ?, 0, ?)',
  ).run(ts, event, dataStr, sessionId, undoData);
  return db.prepare('SELECT last_insert_rowid() as id').get().id;
}

export function listLogs(db, opts = {}) {
  const conditions = [];
  const params = {};

  if (opts.event) {
    conditions.push('event = @event');
    params.event = opts.event;
  }
  if (opts.since) {
    conditions.push('ts >= @since');
    params.since = opts.since;
  }
  if (opts.until) {
    conditions.push('ts <= @until');
    params.until = opts.until;
  }
  if (opts.undoneOnly === false) {
    conditions.push('is_undone = 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const lim = Math.min(500, Math.max(1, Number(opts.limit) || 100));
  const off = Math.max(0, Number(opts.offset) || 0);

  const rows = db.prepare(`SELECT * FROM activity_log ${where} ORDER BY ts DESC LIMIT @lim OFFSET @off`).all({
    ...params,
    lim,
    off,
  });

  return rows.map(rowToLog);
}

export function getLogById(db, id) {
  const row = db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id);
  return row ? rowToLog(row) : null;
}

export function getLastUndoableLog(db) {
  const row = db.prepare(
    "SELECT * FROM activity_log WHERE is_undone = 0 AND event LIKE 'agent.%' ORDER BY ts DESC LIMIT 1",
  ).get();
  return row ? rowToLog(row) : null;
}

export function markUndone(db, id) {
  db.prepare('UPDATE activity_log SET is_undone = 1 WHERE id = ?').run(id);
}

function rowToLog(row) {
  return {
    id: row.id,
    ts: row.ts,
    event: row.event,
    data: safeParse(row.data, {}),
    sessionId: row.session_id || '',
    isUndone: !!row.is_undone,
    undoData: safeParse(row.undo_data, {}),
  };
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
