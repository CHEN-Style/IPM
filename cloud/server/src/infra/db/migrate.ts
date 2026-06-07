import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, 'migrations');

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_MIGRATIONS_DDL);

    const allFiles = await readdir(migrationsDir);
    const sqlFiles = allFiles.filter((f) => f.endsWith('.sql')).sort();

    const existing = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations',
    );
    const applied = new Set(existing.rows.map((r) => r.name));

    const skipped = sqlFiles.filter((f) => applied.has(f));
    const pending = sqlFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(
        `[migrate] No pending migrations (${skipped.length} already applied).`,
      );
      return { applied: [], skipped };
    }

    const appliedNow: string[] = [];
    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`[migrate] Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        appliedNow.push(file);
        console.log(`[migrate] Applied ${file}.`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    console.log(
      `[migrate] Done. ${appliedNow.length} new, ${skipped.length} previously applied.`,
    );
    return { applied: appliedNow, skipped };
  } finally {
    client.release();
  }
}

export async function listAppliedMigrations(): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    `SELECT name FROM schema_migrations ORDER BY name`,
  );
  return result.rows.map((r) => r.name);
}
