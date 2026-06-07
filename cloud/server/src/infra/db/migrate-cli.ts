import { closeDatabase } from './postgres.js';
import { runMigrations } from './migrate.js';

async function main() {
  try {
    await runMigrations();
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exitCode = 1;
});
