import pg from 'pg';
import { env } from '../../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function checkDatabase() {
  const startedAt = Date.now();
  const result = await pool.query<{ ok: number }>('select 1 as ok');

  let migrationCount: number | null = null;
  let latestMigration: string | null = null;
  try {
    const m = await pool.query<{ count: string; latest: string | null }>(
      `SELECT count(*)::text AS count, max(name) AS latest FROM schema_migrations`,
    );
    migrationCount = Number(m.rows[0]?.count ?? '0');
    latestMigration = m.rows[0]?.latest ?? null;
  } catch {
    // schema_migrations not yet created — migrations have not been run
  }

  return {
    ok: result.rows[0]?.ok === 1,
    latencyMs: Date.now() - startedAt,
    migrationCount,
    latestMigration,
  };
}

export async function closeDatabase() {
  await pool.end();
}
