import { openProjectDb } from './init.js';
import { migrateJsonToSqlite } from './migrate.js';

const dbCache = new Map();
const migratedSet = new Set();

export function getProjectDb(projectDir) {
  if (dbCache.has(projectDir)) return dbCache.get(projectDir);

  const db = openProjectDb(projectDir);

  if (!migratedSet.has(projectDir)) {
    try {
      const hasData = db.prepare("SELECT COUNT(*) as cnt FROM suggestions").get()?.cnt || 0;
      if (hasData === 0) {
        const stats = migrateJsonToSqlite(db, projectDir);
        if (stats.suggestions || stats.sourceRecords || stats.events || stats.activityLog) {
          console.log(`[db] Migrated project data for ${projectDir}:`, stats);
        }
      }
    } catch (e) {
      console.error(`[db] Migration failed for ${projectDir}:`, e.message);
    }
    migratedSet.add(projectDir);
  }

  dbCache.set(projectDir, db);
  return db;
}

export function closeProjectDb(projectDir) {
  const db = dbCache.get(projectDir);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    dbCache.delete(projectDir);
    migratedSet.delete(projectDir);
  }
}

export function closeAllDbs() {
  for (const [dir, db] of dbCache.entries()) {
    try { db.close(); } catch { /* ignore */ }
  }
  dbCache.clear();
  migratedSet.clear();
}
