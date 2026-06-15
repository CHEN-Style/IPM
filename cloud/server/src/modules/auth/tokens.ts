// C3.5 Auth: JWT access tokens + opaque refresh tokens.
//
// Access tokens are short-lived signed JWTs carrying the user identity. Refresh
// tokens are long-lived random strings; only their SHA-256 hash is stored in
// the database so a DB leak does not expose usable tokens.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { pool } from '../../infra/db/postgres.js';

export interface AccessTokenPayload {
  sub: string; // user id
  // H1: platform admins may have no org membership; their tokens carry null.
  orgId: string | null;
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('Invalid access token payload');
  }
  return decoded as AccessTokenPayload;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30d
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] ?? multipliers.d);
}

/**
 * Mint a fresh refresh token, persist its hash, and return the raw token to the
 * caller. The raw token is never stored server-side.
 */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES));

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt.toISOString()],
  );
  return raw;
}

export interface RefreshResult {
  userId: string;
  tokenId: string;
}

/**
 * Validate a raw refresh token against the store. Returns the owning user if
 * the token is present, unexpired and unrevoked; otherwise null.
 */
export async function lookupRefreshToken(raw: string): Promise<RefreshResult | null> {
  const tokenHash = hashToken(raw);
  const res = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  if (res.rowCount === 0) return null;
  return { userId: res.rows[0].user_id, tokenId: res.rows[0].id };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  const tokenHash = hashToken(raw);
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`,
    [tokenHash],
  );
}
