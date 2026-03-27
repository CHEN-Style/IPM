import fs from 'node:fs';
import path from 'node:path';

export function migrateJsonToSqlite(db, projectDir) {
  const metaDir = path.join(projectDir, 'meta');

  const migrated = { suggestions: 0, sourceRecords: 0, events: 0, activityLog: 0 };

  migrateSuggestions(db, metaDir, migrated);
  migrateSourceRecords(db, metaDir, migrated);
  migrateEvents(db, metaDir, migrated);
  migrateActivityLog(db, metaDir, migrated);

  return migrated;
}

function migrateSuggestions(db, metaDir, stats) {
  const filePath = path.join(metaDir, 'ai-storage.json');
  if (!fs.existsSync(filePath)) return;

  try {
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(doc?.suggestions) ? doc.suggestions : [];
    if (!items.length) return;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO suggestions (
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
    `);

    const insertAll = db.transaction(() => {
      for (const s of items) {
        const relPath = String(s.sourceRelPath || '');
        if (!relPath) continue;
        const now = s.updatedAt || s.createdAt || new Date().toISOString();
        stmt.run({
          source_rel_path: relPath,
          file_name: String(s.fileName || ''),
          ext: String(s.ext || ''),
          suggested_folder: String(s.suggestedFolderRelPath || ''),
          status: s.status || 'pending',
          rationale: String(s.rationale || ''),
          confidence: typeof s.confidence === 'number' ? s.confidence : 0,
          classified_by: String(s.classifiedBy || ''),
          agent_meta: JSON.stringify(s.agentMeta || {}),
          trace: JSON.stringify(s.trace || []),
          tool_call_count: Number(s.toolCallCount) || 0,
          moved_to_rel_path: s.movedToRelPath || null,
          target_rel_path: s.targetRelPath || null,
          user_feedback: s.userFeedback || null,
          created_at: s.createdAt || now,
          updated_at: s.updatedAt || now,
          accepted_at: s.acceptedAt || null,
          rejected_at: s.rejectedAt || null,
        });
        stats.suggestions++;
      }
    });

    insertAll();
  } catch (e) {
    console.error('[migrate] Failed to migrate ai-storage.json:', e.message);
  }
}

function migrateSourceRecords(db, metaDir, stats) {
  const filePath = path.join(metaDir, 'temp-source-record.json');
  if (!fs.existsSync(filePath)) return;

  try {
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(doc?.items) ? doc.items : [];
    if (!items.length) return;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO source_records (source_rel_path, source_path, source_dir, file_name, source_size_bytes, captured_at)
      VALUES (@source_rel_path, @source_path, @source_dir, @file_name, @source_size_bytes, @captured_at)
    `);

    const insertAll = db.transaction(() => {
      for (const item of items) {
        const relPath = String(item.sourceRelPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
        if (!relPath) continue;
        stmt.run({
          source_rel_path: relPath,
          source_path: String(item.sourcePath || ''),
          source_dir: String(item.sourceDir || ''),
          file_name: String(item.fileName || ''),
          source_size_bytes: Number.isFinite(item.sourceSizeBytes) ? item.sourceSizeBytes : 0,
          captured_at: item.capturedAt || new Date().toISOString(),
        });
        stats.sourceRecords++;
      }
    });

    insertAll();
  } catch (e) {
    console.error('[migrate] Failed to migrate temp-source-record.json:', e.message);
  }
}

function migrateEvents(db, metaDir, stats) {
  const filePath = path.join(metaDir, 'classify-events.jsonl');
  if (!fs.existsSync(filePath)) return;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    if (!lines.length) return;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO events (id, ts, event, file_name, ext, source_path, source_dir,
        suggested_folder, rationale, confidence, classified_by,
        actual_folder, moved_to_rel_path, user_feedback, feedback_at)
      VALUES (@id, @ts, @event, @file_name, @ext, @source_path, @source_dir,
        @suggested_folder, @rationale, @confidence, @classified_by,
        @actual_folder, @moved_to_rel_path, @user_feedback, @feedback_at)
    `);

    const insertAll = db.transaction(() => {
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (!e.id) continue;
          stmt.run({
            id: e.id,
            ts: e.ts || new Date().toISOString(),
            event: e.event || '',
            file_name: e.fileName || '',
            ext: e.ext || '',
            source_path: e.sourcePath || '',
            source_dir: e.sourceDir || '',
            suggested_folder: e.suggestedFolder || '',
            rationale: e.rationale || '',
            confidence: e.confidence ?? null,
            classified_by: e.classifiedBy || '',
            actual_folder: e.actualFolder || null,
            moved_to_rel_path: e.movedToRelPath || null,
            user_feedback: e.userFeedback || null,
            feedback_at: e.feedbackAt || null,
          });
          stats.events++;
        } catch {
          // skip malformed lines
        }
      }
    });

    insertAll();
  } catch (e) {
    console.error('[migrate] Failed to migrate classify-events.jsonl:', e.message);
  }
}

function migrateActivityLog(db, metaDir, stats) {
  const filePath = path.join(metaDir, 'log.jsonl');
  if (!fs.existsSync(filePath)) return;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    if (!lines.length) return;

    const stmt = db.prepare('INSERT INTO activity_log (ts, event, data) VALUES (@ts, @event, @data)');

    const insertAll = db.transaction(() => {
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          stmt.run({
            ts: obj.ts || new Date().toISOString(),
            event: obj.event || 'unknown',
            data: JSON.stringify(obj),
          });
          stats.activityLog++;
        } catch {
          // skip
        }
      }
    });

    insertAll();
  } catch (e) {
    console.error('[migrate] Failed to migrate log.jsonl:', e.message);
  }
}
