import { closeDatabase } from './postgres.js';
import { listAppliedMigrations } from './migrate.js';
import { runSelfCheck } from './self-check.js';

async function main() {
  try {
    const applied = await listAppliedMigrations();
    if (applied.length === 0) {
      console.error(
        '[db:check] No migrations applied. Run "npm run db:migrate" first.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(`[db:check] Applied migrations: ${applied.join(', ')}`);

    const summary = await runSelfCheck();
    console.log('[db:check] Self-check passed.');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('[db:check] Failed:', err);
  process.exitCode = 1;
});
