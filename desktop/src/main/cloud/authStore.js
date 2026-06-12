// C3.5: Token storage with Electron safeStorage.
//
// Stores the access + refresh token pair per user, encrypted at rest with the
// OS credential store via Electron's safeStorage. Tokens live under
// `{userData}/tokens/{userId}.enc`, decoupled from the per-user data root so
// they survive a data-directory move.
//
// `getActiveAccessToken()` transparently refreshes an expired access token
// using the stored refresh token (rotating the pair on success).

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CLOUD_DEV_CONFIG } from './devConfig.js';
import * as userScope from './userScope.js';

const PLAIN_PREFIX = 'PLAIN:';
const REFRESH_SKEW_MS = 60_000; // refresh if <60s of access-token life remains

function tokensDir() {
  return path.join(app.getPath('userData'), 'tokens');
}

function tokenPath(userId) {
  return path.join(tokensDir(), `${encodeURIComponent(userId)}.enc`);
}

export function saveTokens(userId, { accessToken, refreshToken }) {
  if (!userId) throw new Error('saveTokens requires userId');
  fs.mkdirSync(tokensDir(), { recursive: true });
  const json = JSON.stringify({ accessToken, refreshToken, savedAt: Date.now() });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(tokenPath(userId), safeStorage.encryptString(json));
  } else {
    // Fallback when no OS keystore is available (rare on dev VMs). Per the
    // agreed design we do not need strong local protection.
    fs.writeFileSync(tokenPath(userId), Buffer.from(PLAIN_PREFIX + json, 'utf-8'));
  }
}

export function loadTokens(userId) {
  if (!userId) return null;
  try {
    const buf = fs.readFileSync(tokenPath(userId));
    if (buf.subarray(0, PLAIN_PREFIX.length).toString('utf-8') === PLAIN_PREFIX) {
      return JSON.parse(buf.subarray(PLAIN_PREFIX.length).toString('utf-8'));
    }
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf));
    }
    return null;
  } catch {
    return null;
  }
}

export function clearTokens(userId) {
  if (!userId) return;
  try {
    fs.rmSync(tokenPath(userId), { force: true });
  } catch {
    /* ignore */
  }
}

/** Decode a JWT payload without verifying the signature (for exp only). */
function decodeJwtPayload(token) {
  try {
    const seg = String(token).split('.')[1];
    if (!seg) return null;
    const json = Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function accessTokenExpiresAt(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return 0;
  return payload.exp * 1000;
}

async function callRefresh(refreshToken) {
  const res = await fetch(`${CLOUD_DEV_CONFIG.baseURL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    const err = new Error(`refresh failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Resolve a valid access token for the given user, refreshing if needed.
 * Returns null when there is no stored token or refresh fails (caller should
 * treat this as "needs re-login").
 */
export async function getAccessToken(userId) {
  const tokens = loadTokens(userId);
  if (!tokens || !tokens.accessToken) return null;

  const expiresAt = accessTokenExpiresAt(tokens.accessToken);
  if (expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }

  // Access token (near) expired — try to refresh.
  if (!tokens.refreshToken) return null;
  try {
    const result = await callRefresh(tokens.refreshToken);
    if (result?.ok && result.accessToken && result.refreshToken) {
      saveTokens(userId, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      return result.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

/** Access token for the currently logged-in user (or null when offline). */
export async function getActiveAccessToken() {
  const current = userScope.getCurrentUser();
  if (!current || !current.userId) return null;
  return getAccessToken(current.userId);
}
