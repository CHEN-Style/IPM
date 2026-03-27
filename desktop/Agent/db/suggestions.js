export function upsertSuggestion(db, suggestion) {
  const now = new Date().toISOString();
  const row = {
    source_rel_path: String(suggestion.sourceRelPath || ''),
    file_name: String(suggestion.fileName || ''),
    ext: String(suggestion.ext || ''),
    suggested_folder: String(suggestion.suggestedFolderRelPath || ''),
    status: suggestion.status || 'pending',
    rationale: String(suggestion.rationale || ''),
    confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : 0,
    classified_by: String(suggestion.classifiedBy || ''),
    agent_meta: JSON.stringify(suggestion.agentMeta || {}),
    trace: JSON.stringify(suggestion.trace || []),
    tool_call_count: Number(suggestion.toolCallCount) || 0,
    moved_to_rel_path: suggestion.movedToRelPath || null,
    target_rel_path: suggestion.targetRelPath || null,
    user_feedback: suggestion.userFeedback || null,
    created_at: suggestion.createdAt || now,
    updated_at: now,
    accepted_at: suggestion.acceptedAt || null,
    rejected_at: suggestion.rejectedAt || null,
  };

  const stmt = db.prepare(`
    INSERT INTO suggestions (
      source_rel_path, file_name, ext, suggested_folder, status,
      rationale, confidence, classified_by, agent_meta, trace,
      tool_call_count, moved_to_rel_path, target_rel_path, user_feedback,
      created_at, updated_at, accepted_at, rejected_at
    ) VALUES (
      @source_rel_path, @file_name, @ext, @suggested_folder, @status,
      @rationale, @confidence, @classified_by, @agent_meta, @trace,
      @tool_call_count, @moved_to_rel_path, @target_rel_path, @user_feedback,
      @created_at, @updated_at, @accepted_at, @rejected_at
    )
    ON CONFLICT(source_rel_path) DO UPDATE SET
      file_name = @file_name,
      ext = @ext,
      suggested_folder = @suggested_folder,
      status = @status,
      rationale = @rationale,
      confidence = @confidence,
      classified_by = @classified_by,
      agent_meta = @agent_meta,
      trace = @trace,
      tool_call_count = @tool_call_count,
      moved_to_rel_path = @moved_to_rel_path,
      target_rel_path = @target_rel_path,
      user_feedback = @user_feedback,
      updated_at = @updated_at,
      accepted_at = COALESCE(@accepted_at, accepted_at),
      rejected_at = COALESCE(@rejected_at, rejected_at)
  `);

  stmt.run(row);
  return rowToSuggestion(db.prepare('SELECT * FROM suggestions WHERE source_rel_path = ?').get(row.source_rel_path));
}

export function listSuggestions(db, opts = {}) {
  const conditions = [];
  const params = {};

  if (opts.status) {
    conditions.push('status = @status');
    params.status = String(opts.status);
  }
  if (opts.folderRelPath) {
    conditions.push('suggested_folder = @folder');
    params.folder = String(opts.folderRelPath);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM suggestions ${where} ORDER BY created_at DESC`).all(params);
  return rows.map(rowToSuggestion);
}

export function getSuggestionByRelPath(db, sourceRelPath) {
  const row = db.prepare('SELECT * FROM suggestions WHERE source_rel_path = ?').get(String(sourceRelPath));
  return row ? rowToSuggestion(row) : null;
}

export function setSuggestionStatus(db, sourceRelPath, patch = {}) {
  const existing = db.prepare('SELECT * FROM suggestions WHERE source_rel_path = ?').get(String(sourceRelPath));
  if (!existing) return null;

  const now = new Date().toISOString();
  const updates = [];
  const params = { source_rel_path: String(sourceRelPath), updated_at: now };

  for (const [key, col] of Object.entries(PATCH_COL_MAP)) {
    if (patch[key] !== undefined) {
      updates.push(`${col} = @${col}`);
      params[col] = patch[key];
    }
  }

  updates.push('updated_at = @updated_at');

  if (updates.length > 1) {
    db.prepare(`UPDATE suggestions SET ${updates.join(', ')} WHERE source_rel_path = @source_rel_path`).run(params);
  }

  return rowToSuggestion(db.prepare('SELECT * FROM suggestions WHERE source_rel_path = ?').get(String(sourceRelPath)));
}

const PATCH_COL_MAP = {
  status: 'status',
  acceptedAt: 'accepted_at',
  rejectedAt: 'rejected_at',
  movedToRelPath: 'moved_to_rel_path',
  targetRelPath: 'target_rel_path',
  userFeedback: 'user_feedback',
  rationale: 'rationale',
  confidence: 'confidence',
  classifiedBy: 'classified_by',
};

function rowToSuggestion(row) {
  if (!row) return null;
  return {
    sourceRelPath: row.source_rel_path,
    fileName: row.file_name,
    ext: row.ext,
    suggestedFolderRelPath: row.suggested_folder,
    status: row.status,
    rationale: row.rationale,
    confidence: row.confidence,
    classifiedBy: row.classified_by,
    agentMeta: safeParse(row.agent_meta, {}),
    trace: safeParse(row.trace, []),
    toolCallCount: row.tool_call_count,
    movedToRelPath: row.moved_to_rel_path,
    targetRelPath: row.target_rel_path,
    userFeedback: row.user_feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
  };
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
