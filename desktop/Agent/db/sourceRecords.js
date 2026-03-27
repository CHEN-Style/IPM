export function upsertSourceRecord(db, entry) {
  const sourceRelPath = String(entry.sourceRelPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!sourceRelPath) return null;

  const now = new Date().toISOString();
  const row = {
    source_rel_path: sourceRelPath,
    source_path: String(entry.sourcePath || ''),
    source_dir: String(entry.sourceDir || ''),
    file_name: String(entry.fileName || ''),
    source_size_bytes: Number.isFinite(entry.sourceSizeBytes) ? entry.sourceSizeBytes : 0,
    captured_at: entry.capturedAt || now,
  };

  db.prepare(`
    INSERT INTO source_records (source_rel_path, source_path, source_dir, file_name, source_size_bytes, captured_at)
    VALUES (@source_rel_path, @source_path, @source_dir, @file_name, @source_size_bytes, @captured_at)
    ON CONFLICT(source_rel_path) DO UPDATE SET
      source_path = @source_path,
      source_dir = @source_dir,
      file_name = @file_name,
      source_size_bytes = @source_size_bytes,
      captured_at = @captured_at
  `).run(row);

  return row;
}

export function deleteSourceRecord(db, sourceRelPathRaw) {
  const sourceRelPath = normalize(sourceRelPathRaw);
  if (!sourceRelPath) return false;
  const result = db.prepare('DELETE FROM source_records WHERE source_rel_path = ?').run(sourceRelPath);
  return result.changes > 0;
}

export function lookupSourceRecord(db, sourceRelPathRaw) {
  const sourceRelPath = normalize(sourceRelPathRaw);
  if (!sourceRelPath) return null;
  const row = db.prepare('SELECT * FROM source_records WHERE source_rel_path = ?').get(sourceRelPath);
  if (!row) return null;
  return {
    sourceRelPath: row.source_rel_path,
    sourcePath: row.source_path,
    sourceDir: row.source_dir,
    fileName: row.file_name,
    sourceSizeBytes: row.source_size_bytes,
    capturedAt: row.captured_at,
  };
}

export function getSourceInfo(db, sourceRelPathRaw) {
  const row = lookupSourceRecord(db, sourceRelPathRaw);
  if (!row) return null;
  return { sourcePath: row.sourcePath, sourceDir: row.sourceDir };
}

function normalize(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
}
