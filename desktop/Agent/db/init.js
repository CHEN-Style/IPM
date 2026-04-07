import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const CURRENT_VERSION = 8;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_rel_path TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  ext TEXT DEFAULT '',
  suggested_folder TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT DEFAULT '',
  confidence REAL DEFAULT 0,
  classified_by TEXT DEFAULT '',
  agent_meta TEXT DEFAULT '{}',
  trace TEXT DEFAULT '[]',
  tool_call_count INTEGER DEFAULT 0,
  moved_to_rel_path TEXT,
  target_rel_path TEXT,
  user_feedback TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  rejected_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_folder ON suggestions(suggested_folder);

CREATE TABLE IF NOT EXISTS source_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_rel_path TEXT UNIQUE NOT NULL,
  source_path TEXT NOT NULL,
  source_dir TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_size_bytes INTEGER DEFAULT 0,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_records_rel ON source_records(source_rel_path);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  file_name TEXT NOT NULL,
  ext TEXT DEFAULT '',
  source_path TEXT DEFAULT '',
  source_dir TEXT DEFAULT '',
  suggested_folder TEXT DEFAULT '',
  rationale TEXT DEFAULT '',
  confidence REAL,
  classified_by TEXT DEFAULT '',
  actual_folder TEXT,
  moved_to_rel_path TEXT,
  user_feedback TEXT,
  feedback_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_activity_log_ts ON activity_log(ts);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  summary TEXT NOT NULL,
  topics TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_ts ON conversations(ts);
`;

export function getDbPath(projectDir) {
  return path.join(projectDir, 'meta', 'project.db');
}

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER DEFAULT 0,
  summary TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT DEFAULT '',
  tools_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
`;

const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS knowledge_items (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'snippet',
  title         TEXT NOT NULL DEFAULT '',
  content_text  TEXT DEFAULT '',
  content_json  TEXT DEFAULT NULL,
  content_path  TEXT DEFAULT '',
  summary       TEXT DEFAULT '',
  tags          TEXT DEFAULT '[]',
  importance    TEXT DEFAULT NULL,
  source_kind   TEXT DEFAULT 'manual',
  source_url    TEXT DEFAULT NULL,
  pinned        INTEGER DEFAULT 0,
  archived      INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ki_type ON knowledge_items(type);
CREATE INDEX IF NOT EXISTS idx_ki_created ON knowledge_items(created_at);
CREATE INDEX IF NOT EXISTS idx_ki_pinned ON knowledge_items(pinned);
CREATE INDEX IF NOT EXISTS idx_ki_archived ON knowledge_items(archived);

CREATE TABLE IF NOT EXISTS knowledge_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'file',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kl_item ON knowledge_links(item_id);
CREATE INDEX IF NOT EXISTS idx_kl_target ON knowledge_links(target_path);
`;

const MIGRATION_V4 = `
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  is_main     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_items (
  id              TEXT PRIMARY KEY,
  board_id        TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  knowledge_id    TEXT NOT NULL,
  source_project  TEXT NOT NULL DEFAULT '',
  source_domain   TEXT NOT NULL DEFAULT 'projects',
  x               REAL NOT NULL DEFAULT 100,
  y               REAL NOT NULL DEFAULT 100,
  rotation        REAL NOT NULL DEFAULT 0,
  width           REAL NOT NULL DEFAULT 240,
  height          REAL DEFAULT NULL,
  z_index         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bi_board ON board_items(board_id);
CREATE INDEX IF NOT EXISTS idx_bi_knowledge ON board_items(knowledge_id);
`;

const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS board_connections (
  id            TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  from_item_id  TEXT NOT NULL REFERENCES board_items(id) ON DELETE CASCADE,
  to_item_id    TEXT NOT NULL REFERENCES board_items(id) ON DELETE CASCADE,
  color         TEXT NOT NULL DEFAULT '#e8a0a0',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bc_board ON board_connections(board_id);

CREATE TABLE IF NOT EXISTS board_groups (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  width       REAL NOT NULL DEFAULT 400,
  height      REAL NOT NULL DEFAULT 300,
  color       TEXT NOT NULL DEFAULT 'rgba(74,158,142,0.08)',
  z_index     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bg_board ON board_groups(board_id);
`;

function safeAlter(db, sql) {
  try { db.exec(sql); } catch { /* column may already exist */ }
}

export function initDb(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const version = db.pragma('user_version', { simple: true });

  if (version < 1) {
    db.exec(SCHEMA_SQL);
  }

  if (version < 2) {
    db.exec(MIGRATION_V2);
    safeAlter(db, "ALTER TABLE activity_log ADD COLUMN session_id TEXT DEFAULT ''");
    safeAlter(db, 'ALTER TABLE activity_log ADD COLUMN is_undone INTEGER DEFAULT 0');
    safeAlter(db, "ALTER TABLE activity_log ADD COLUMN undo_data TEXT DEFAULT '{}'");
  }

  if (version < 3) {
    db.exec(MIGRATION_V3);
  }

  if (version < 4) {
    db.exec(MIGRATION_V4);
  }

  if (version < 5) {
    db.exec(MIGRATION_V5);
    safeAlter(db, 'ALTER TABLE board_items ADD COLUMN locked INTEGER DEFAULT 0');
    safeAlter(db, 'ALTER TABLE board_items ADD COLUMN group_id TEXT DEFAULT NULL');
    safeAlter(db, "ALTER TABLE boards ADD COLUMN bg_style TEXT DEFAULT 'grid'");
    safeAlter(db, "ALTER TABLE boards ADD COLUMN bg_color TEXT DEFAULT ''");
  }

  if (version < 6) {
    db.pragma('foreign_keys = OFF');
    const hasOldConns = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='board_connections'").get();
    if (hasOldConns) {
      db.exec(`
        CREATE TABLE board_connections_v2 (
          id            TEXT PRIMARY KEY,
          board_id      TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          from_item_id  TEXT NOT NULL,
          to_item_id    TEXT NOT NULL,
          color         TEXT NOT NULL DEFAULT '#e8a0a0',
          created_at    TEXT NOT NULL
        );
        INSERT INTO board_connections_v2 SELECT * FROM board_connections;
        DROP TABLE board_connections;
        ALTER TABLE board_connections_v2 RENAME TO board_connections;
        CREATE INDEX IF NOT EXISTS idx_bc_board ON board_connections(board_id);
      `);
    }
    db.pragma('foreign_keys = ON');
    safeAlter(db, 'ALTER TABLE board_groups ADD COLUMN locked INTEGER DEFAULT 0');
  }

  if (version < 7) {
    safeAlter(db, "ALTER TABLE board_groups ADD COLUMN frame_style TEXT DEFAULT 'default'");
  }

  if (version < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS board_timelines (
        id          TEXT PRIMARY KEY,
        board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name        TEXT NOT NULL DEFAULT '',
        orientation TEXT NOT NULL DEFAULT 'vertical',
        x           REAL NOT NULL DEFAULT 0,
        y           REAL NOT NULL DEFAULT 0,
        width       REAL NOT NULL DEFAULT 160,
        height      REAL NOT NULL DEFAULT 500,
        z_index     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bt_board ON board_timelines(board_id);

      CREATE TABLE IF NOT EXISTS board_timeline_points (
        id          TEXT PRIMARY KEY,
        timeline_id TEXT NOT NULL REFERENCES board_timelines(id) ON DELETE CASCADE,
        label       TEXT NOT NULL DEFAULT '',
        position    REAL NOT NULL DEFAULT 0,
        color       TEXT NOT NULL DEFAULT '#4a9e8e',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_btp_timeline ON board_timeline_points(timeline_id);
    `);
  }

  if (version < CURRENT_VERSION) {
    db.pragma(`user_version = ${CURRENT_VERSION}`);
  }

  return db;
}

export function openProjectDb(projectDir) {
  const dbPath = getDbPath(projectDir);
  const metaDir = path.dirname(dbPath);
  if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true });

  const db = new Database(dbPath);
  initDb(db);
  return db;
}
