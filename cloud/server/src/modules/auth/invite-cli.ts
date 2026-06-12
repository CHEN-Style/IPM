// CLI to create an org-scoped invite code.
//
// Usage:
//   npm run invite:create -- --org <orgId> [--role member|admin|owner]
//                            [--max-uses 50] [--expires-days 30]
//
// With no --org it falls back to the seeded dev org so a fresh checkout can
// mint a usable code immediately.

import crypto from 'node:crypto';
import { pool, closeDatabase } from '../../infra/db/postgres.js';
import { DEV_ORG_ID } from '../../config/devConstants.js';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `IPM-${block()}-${block()}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orgId = args.org || DEV_ORG_ID;
  const role = (args.role || 'member') as 'owner' | 'admin' | 'member';
  const maxUses = Number(args['max-uses'] || 50);
  const expiresDays = args['expires-days'] ? Number(args['expires-days']) : null;

  if (!['owner', 'admin', 'member'].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }

  const orgCheck = await pool.query(`SELECT name FROM orgs WHERE id = $1`, [orgId]);
  if (orgCheck.rowCount === 0) {
    throw new Error(`Org not found: ${orgId}`);
  }

  const code = generateCode();
  const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400_000).toISOString() : null;

  await pool.query(
    `INSERT INTO invite_codes (org_id, code, role, max_uses, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, code, role, maxUses, expiresAt],
  );

  console.log('[invite:create] Created invite code:');
  console.log(`  code     : ${code}`);
  console.log(`  org      : ${orgCheck.rows[0].name} (${orgId})`);
  console.log(`  role     : ${role}`);
  console.log(`  maxUses  : ${maxUses}`);
  console.log(`  expires  : ${expiresAt ?? 'never'}`);
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[invite:create] Failed:', err instanceof Error ? err.message : err);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
