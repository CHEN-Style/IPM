// H6 Config Center: symmetric at-rest encryption for org config templates.
//
// Org config templates can embed provider API keys and search-API keys. Those
// are stored in `org_config_templates.config_json`. To avoid keeping plaintext
// secrets in the database, the config object is sealed with AES-256-GCM into an
// envelope and stored as jsonb. Reads transparently unseal; legacy plaintext
// rows (written before H6) are detected by the absence of the `__enc` marker
// and returned as-is, so the change is backward compatible.

import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const ENC_MARKER = 'aes-256-gcm';

// Derive a stable 32-byte key from CONFIG_ENC_KEY. The raw env value may be
// base64, hex, or an arbitrary passphrase; scrypt stretches whatever we get to
// exactly 32 bytes with a fixed salt (the salt only needs to be stable, not
// secret, since the input entropy is the env secret itself).
function deriveKey(): Buffer {
  const raw = env.CONFIG_ENC_KEY;
  // Accept a directly-provided 32-byte key in base64 or hex form first.
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    /* not base64 */
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.scryptSync(raw, 'ipm-config-enc-salt-v1', 32);
}

const KEY = deriveKey();

export interface EncryptedEnvelope {
  __enc: typeof ENC_MARKER;
  v: 1;
  iv: string; // base64
  tag: string; // base64
  data: string; // base64 ciphertext
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).__enc === ENC_MARKER &&
      typeof (value as Record<string, unknown>).data === 'string',
  );
}

/**
 * Seal a JSON-serializable config object into an AES-256-GCM envelope suitable
 * for storing directly as jsonb.
 */
export function encryptConfig(config: unknown): EncryptedEnvelope {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
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

/**
 * Unseal a stored config value. If it is a legacy plaintext object (no `__enc`
 * marker) it is returned unchanged, so reads work across the migration window.
 */
export function decryptConfig<T = unknown>(stored: unknown): T {
  if (!isEncryptedEnvelope(stored)) {
    return (stored ?? {}) as T;
  }
  const iv = Buffer.from(stored.iv, 'base64');
  const tag = Buffer.from(stored.tag, 'base64');
  const data = Buffer.from(stored.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
