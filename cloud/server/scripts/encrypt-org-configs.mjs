// H6 one-time backfill: seal any legacy plaintext org_config_templates.config_json
// rows with AES-256-GCM. Idempotent — rows already carrying the `__enc` marker
// are skipped. Reads DATABASE_URL and CONFIG_ENC_KEY from cloud/server/.env.
//
// Usage: node scripts/encrypt-org-configs.mjs

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENC_MARKER = 'aes-256-gcm';

function readEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const get = (key, fallback) => {
    const m = new RegExp(`^${key}=(.+)$`, 'm').exec(text);
    return m ? m[1].trim() : fallback;
  };
  const dbUrl = get('DATABASE_URL');
  if (!dbUrl) throw new Error('无法从 .env 读取 DATABASE_URL');
  const encKey = get('CONFIG_ENC_KEY', 'dev-insecure-config-enc-key-change-me');
  return { dbUrl, encKey };
}

// Must match cloud/server/src/infra/crypto.ts deriveKey().
function deriveKey(raw) {
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    /* not base64 */
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.scryptSync(raw, 'ipm-config-enc-salt-v1', 32);
}

function encryptConfig(key, config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(config ?? {}), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: ENC_MARKER,
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

function isEncrypted(value) {
  return Boolean(value && typeof value === 'object' && value.__enc === ENC_MARKER && typeof value.data === 'string');
}

async function main() {
  const { dbUrl, encKey } = readEnv();
  const key = deriveKey(encKey);
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: dbUrl });

  let scanned = 0;
  let sealed = 0;
  try {
    const rows = await pool.query('SELECT id, config_json FROM org_config_templates');
    for (const row of rows.rows) {
      scanned += 1;
      if (isEncrypted(row.config_json)) continue;
      const envelope = encryptConfig(key, row.config_json || {});
      // eslint-disable-next-line no-await-in-loop
      await pool.query('UPDATE org_config_templates SET config_json = $1::jsonb WHERE id = $2', [
        JSON.stringify(envelope),
        row.id,
      ]);
      sealed += 1;
    }
    console.log(`[encrypt-org-configs] scanned=${scanned} sealed=${sealed} skipped=${scanned - sealed}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
