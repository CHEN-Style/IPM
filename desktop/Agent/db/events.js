import { randomUUID } from 'node:crypto';

export function appendEvent(db, eventData) {
  const record = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    event: eventData.event || '',
    file_name: eventData.fileName || '',
    ext: eventData.ext || '',
    source_path: eventData.sourcePath || '',
    source_dir: eventData.sourceDir || '',
    suggested_folder: eventData.suggestedFolder || '',
    rationale: eventData.rationale || '',
    confidence: eventData.confidence ?? null,
    classified_by: eventData.classifiedBy || '',
    actual_folder: eventData.actualFolder || null,
    moved_to_rel_path: eventData.movedToRelPath || null,
    user_feedback: eventData.userFeedback || null,
    feedback_at: null,
  };

  db.prepare(`
    INSERT INTO events (id, ts, event, file_name, ext, source_path, source_dir,
      suggested_folder, rationale, confidence, classified_by,
      actual_folder, moved_to_rel_path, user_feedback, feedback_at)
    VALUES (@id, @ts, @event, @file_name, @ext, @source_path, @source_dir,
      @suggested_folder, @rationale, @confidence, @classified_by,
      @actual_folder, @moved_to_rel_path, @user_feedback, @feedback_at)
  `).run(record);

  return rowToEvent(record);
}

export function listEvents(db, opts = {}) {
  const conditions = [];
  const params = {};

  if (opts.eventType && opts.eventType !== 'all') {
    conditions.push('event = @eventType');
    params.eventType = opts.eventType;
  }

  if (opts.search) {
    const like = `%${opts.search}%`;
    conditions.push(`(
      file_name LIKE @search COLLATE NOCASE
      OR suggested_folder LIKE @search COLLATE NOCASE
      OR actual_folder LIKE @search COLLATE NOCASE
      OR user_feedback LIKE @search COLLATE NOCASE
    )`);
    params.search = like;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM events ${where}`).get(params);
  const total = totalRow?.cnt || 0;

  const off = Math.max(0, Number(opts.offset) || 0);
  const lim = Math.min(200, Math.max(1, Number(opts.limit) || 50));

  const rows = db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC LIMIT @lim OFFSET @off`).all({
    ...params,
    lim,
    off,
  });

  return { total, offset: off, limit: lim, events: rows.map(rowToEvent) };
}

export function updateEventFeedback(db, eventId, feedback) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE events SET user_feedback = ?, feedback_at = ? WHERE id = ?').run(
    feedback || null,
    now,
    eventId,
  );
  if (result.changes === 0) throw new Error('未找到对应事件');
  return true;
}

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    ts: row.ts,
    event: row.event,
    fileName: row.file_name,
    ext: row.ext,
    sourcePath: row.source_path,
    sourceDir: row.source_dir,
    suggestedFolder: row.suggested_folder,
    rationale: row.rationale,
    confidence: row.confidence,
    classifiedBy: row.classified_by,
    actualFolder: row.actual_folder,
    movedToRelPath: row.moved_to_rel_path,
    userFeedback: row.user_feedback,
    feedbackAt: row.feedback_at,
  };
}
