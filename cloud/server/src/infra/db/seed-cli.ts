import { closeDatabase } from './postgres.js';
import { runSeed } from './seed.js';

async function main() {
  try {
    const summary = await runSeed();
    console.log('[seed] Dev identity ready.');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exitCode = 1;
});
