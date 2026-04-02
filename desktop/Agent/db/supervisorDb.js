import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const CURRENT_VERSION = 3;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER DEFAULT 0,
  summary TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sv_chat_sessions_updated ON chat_sessions(updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT DEFAULT '',
  tools_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sv_chat_messages_session ON chat_messages(session_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  session_id TEXT DEFAULT '',
  is_undone INTEGER DEFAULT 0,
  undo_data TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sv_activity_log_ts ON activity_log(ts);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  summary TEXT NOT NULL,
  topics TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sv_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_sv_conversations_ts ON conversations(ts);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL DEFAULT '',
  content TEXT DEFAULT '',
  project_name TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sv_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_sv_notifications_created ON notifications(created_at);
`;

const SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS preference_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  project_dir TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'projects',
  pattern TEXT NOT NULL DEFAULT '',
  conditions TEXT NOT NULL DEFAULT '{}',
  target_folder TEXT NOT NULL,
  suggested_strength REAL DEFAULT 0.7,
  evidence_summary TEXT DEFAULT '',
  sample_files TEXT DEFAULT '[]',
  event_count INTEGER DEFAULT 0,
  accept_rate REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sv_pref_candidates_status ON preference_candidates(status);
CREATE INDEX IF NOT EXISTS idx_sv_pref_candidates_project ON preference_candidates(project_name);

CREATE TABLE IF NOT EXISTS preference_analysis_log (
  project_name TEXT PRIMARY KEY,
  last_analysis_at TEXT NOT NULL,
  events_analyzed INTEGER DEFAULT 0
);
`;

const SCHEMA_V3_SQL = `
CREATE TABLE IF NOT EXISTS skill_executions (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  input_json TEXT DEFAULT '{}',
  output_json TEXT DEFAULT '{}',
  log_text TEXT DEFAULT '',
  error TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sv_skill_exec_skill ON skill_executions(skill_name);
CREATE INDEX IF NOT EXISTS idx_sv_skill_exec_status ON skill_executions(status);
CREATE INDEX IF NOT EXISTS idx_sv_skill_exec_started ON skill_executions(started_at);
`;

let cachedDb = null;

export function getSupervisorDbPath(appRoot) {
  return path.join(appRoot, 'meta', 'supervisor.db');
}

export function getSupervisorDb(appRoot) {
  if (cachedDb) return cachedDb;

  const dbPath = getSupervisorDbPath(appRoot);
  const metaDir = path.dirname(dbPath);
  if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const version = db.pragma('user_version', { simple: true });

  if (version < 1) {
    db.exec(SCHEMA_SQL);
  }
  if (version < 2) {
    db.exec(SCHEMA_V2_SQL);
  }
  if (version < 3) {
    db.exec(SCHEMA_V3_SQL);
  }

  if (version < CURRENT_VERSION) {
    db.pragma(`user_version = ${CURRENT_VERSION}`);
  }

  cachedDb = db;
  return db;
}

export function closeSupervisorDb() {
  if (cachedDb) {
    try { cachedDb.close(); } catch { /* ignore */ }
    cachedDb = null;
  }
}

export function addNotification(db, { type = 'info', title, content = '', projectName = '' }) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO notifications (type, title, content, project_name, is_read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(type, title, content, projectName, now);
  return { id: info.lastInsertRowid, type, title, content, projectName, isRead: false, createdAt: now };
}

export function listNotifications(db, opts = {}) {
  const onlyUnread = opts.onlyUnread ?? false;
  const lim = Math.min(100, Math.max(1, Number(opts.limit) || 50));
  const off = Math.max(0, Number(opts.offset) || 0);

  const where = onlyUnread ? 'WHERE is_read = 0' : '';
  const rows = db.prepare(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(lim, off);
  return rows.map(rowToNotification);
}

export function getUnreadCount(db) {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE is_read = 0').get();
  return row?.cnt || 0;
}

export function markNotificationRead(db, id) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
}

export function markAllNotificationsRead(db) {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
}

function rowToNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    projectName: row.project_name,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

// ── Preference Candidates ──

export function addCandidate(db, c) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO preference_candidates
      (project_name, project_dir, domain, pattern, conditions, target_folder,
       suggested_strength, evidence_summary, sample_files, event_count, accept_rate, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    c.projectName, c.projectDir, c.domain || 'projects',
    c.pattern || '', JSON.stringify(c.conditions || {}), c.targetFolder,
    c.suggestedStrength ?? 0.7, c.evidenceSummary || '',
    JSON.stringify(c.sampleFiles || []), c.eventCount || 0, c.acceptRate || 0,
    now,
  );
  return { id: info.lastInsertRowid, ...c, status: 'pending', createdAt: now };
}

export function listCandidates(db, opts = {}) {
  const status = opts.status || 'pending';
  const projectName = opts.projectName || '';
  const conditions = ['status = ?'];
  const params = [status];
  if (projectName) {
    conditions.push('project_name = ?');
    params.push(projectName);
  }
  const rows = db.prepare(
    `SELECT * FROM preference_candidates WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
  ).all(...params);
  return rows.map(rowToCandidate);
}

export function setCandidateStatus(db, id, status) {
  const now = new Date().toISOString();
  db.prepare('UPDATE preference_candidates SET status = ?, resolved_at = ? WHERE id = ?').run(status, now, id);
}

function rowToCandidate(row) {
  return {
    id: row.id,
    projectName: row.project_name,
    projectDir: row.project_dir,
    domain: row.domain,
    pattern: row.pattern,
    conditions: safeParse(row.conditions, {}),
    targetFolder: row.target_folder,
    suggestedStrength: row.suggested_strength,
    evidenceSummary: row.evidence_summary,
    sampleFiles: safeParse(row.sample_files, []),
    eventCount: row.event_count,
    acceptRate: row.accept_rate,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── Preference Analysis Log ──

export function getLastAnalysisTime(db, projectName) {
  const row = db.prepare('SELECT last_analysis_at FROM preference_analysis_log WHERE project_name = ?').get(projectName);
  return row?.last_analysis_at || null;
}

export function updateAnalysisTime(db, projectName, eventsAnalyzed) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO preference_analysis_log (project_name, last_analysis_at, events_analyzed)
    VALUES (?, ?, ?)
    ON CONFLICT(project_name) DO UPDATE SET last_analysis_at = ?, events_analyzed = ?
  `).run(projectName, now, eventsAnalyzed, now, eventsAnalyzed);
}

// ── Skill Executions ──

export function addSkillExecution(db, { id, skillName, inputJson }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO skill_executions (id, skill_name, status, started_at, input_json)
    VALUES (?, ?, 'running', ?, ?)
  `).run(id, skillName, now, JSON.stringify(inputJson || {}));
  return { id, skillName, status: 'running', startedAt: now };
}

export function updateSkillExecution(db, id, patch) {
  const sets = [];
  const params = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.outputJson !== undefined) { sets.push('output_json = ?'); params.push(JSON.stringify(patch.outputJson)); }
  if (patch.logText !== undefined) { sets.push('log_text = ?'); params.push(patch.logText); }
  if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error); }
  if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled') {
    sets.push('ended_at = ?');
    params.push(new Date().toISOString());
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE skill_executions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function listSkillExecutions(db, opts = {}) {
  const lim = Math.min(100, Math.max(1, Number(opts.limit) || 20));
  const off = Math.max(0, Number(opts.offset) || 0);
  const conditions = [];
  const params = [];
  if (opts.skillName) { conditions.push('skill_name = ?'); params.push(opts.skillName); }
  if (opts.status) { conditions.push('status = ?'); params.push(opts.status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(lim, off);
  const rows = db.prepare(
    `SELECT * FROM skill_executions ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
  ).all(...params);
  return rows.map(rowToSkillExecution);
}

export function getSkillExecution(db, id) {
  const row = db.prepare('SELECT * FROM skill_executions WHERE id = ?').get(id);
  return row ? rowToSkillExecution(row) : null;
}

function rowToSkillExecution(row) {
  return {
    id: row.id,
    skillName: row.skill_name,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    inputJson: safeParse(row.input_json, {}),
    outputJson: safeParse(row.output_json, {}),
    logText: row.log_text,
    error: row.error,
  };
}
