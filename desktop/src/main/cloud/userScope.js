// C3.5: Per-user local data scope.
//
// IPM's local data (projects/cases/study/workspaces/_app) historically lived
// directly under the "base file root" (the configurable data directory). With
// cloud accounts we isolate each logged-in user's data under
// `users/{userId}/`, while anonymous/offline usage lives under `_offline/`.
//
// Layout under baseRoot:
//   _auth/current.json   { userId, email, displayName, orgId, orgRole } | { offline: true }
//   _offline/            offline (no-account) data root
//   users/{userId}/      per-user data root
//
// This module owns: reading/writing current.json, resolving the active data
// root, and the one-time migration of legacy top-level data into _offline/.

import fs from 'node:fs';
import path from 'node:path';

let baseRootResolver = null; // () => string
let currentUser = null; // { userId, email, displayName, orgId, orgRole } | { offline: true } | null
let initialized = false;

// Legacy top-level directories that, on first upgrade, get relocated into
// `_offline/` so existing local data is preserved under the offline scope.
const LEGACY_DIRS = ['projects', 'cases', 'study', 'workspaces', '_app'];

// Reserved top-level names the scope itself owns; never treated as legacy data.
const RESERVED_DIRS = new Set(['_auth', '_offline', 'users']);

function getBaseRoot() {
  if (!baseRootResolver) throw new Error('userScope not initialized');
  return baseRootResolver();
}

function getAuthDir() {
  return path.join(getBaseRoot(), '_auth');
}

function getCurrentUserPath() {
  return path.join(getAuthDir(), 'current.json');
}

function readCurrentUserFile() {
  try {
    const p = getCurrentUserPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    /* ignore */
  }
  return null;
}

function writeCurrentUserFile(value) {
  fs.mkdirSync(getAuthDir(), { recursive: true });
  if (value === null) {
    try {
      fs.rmSync(getCurrentUserPath(), { force: true });
    } catch {
      /* ignore */
    }
    return;
  }
  fs.writeFileSync(getCurrentUserPath(), JSON.stringify(value, null, 2), 'utf-8');
}

/**
 * One-time migration: if legacy data lives directly under baseRoot and
 * `_offline/` does not yet exist, move it into `_offline/`.
 */
function migrateLegacyToOffline() {
  const base = getBaseRoot();
  const offlineRoot = path.join(base, '_offline');

  const hasLegacy = LEGACY_DIRS.some((d) => {
    const p = path.join(base, d);
    // Only count as legacy if the dir exists at the top level AND has not
    // already been moved (i.e. `_offline/<dir>` does not exist yet).
    return fs.existsSync(p) && !fs.existsSync(path.join(offlineRoot, d));
  });
  if (!hasLegacy) return; // nothing left to migrate

  fs.mkdirSync(offlineRoot, { recursive: true });
  for (const entry of LEGACY_DIRS) {
    const src = path.join(base, entry);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(offlineRoot, entry);
    if (fs.existsSync(dest)) continue; // already migrated in a previous run
    try {
      fs.renameSync(src, dest);
    } catch {
      // Cross-device, locked, or non-empty target: fall back to copy.
      try {
        fs.cpSync(src, dest, { recursive: true });
      } catch (cpErr) {
        console.warn('[userScope] legacy migration copy failed for', entry, cpErr?.message || cpErr);
        continue; // leave the source in place; will retry next boot
      }
      // Best-effort remove the source. If it fails (e.g. locked / non-empty
      // due to runtime files), that's fine — the copy succeeded and we won't
      // re-migrate because `dest` already exists.
      try {
        fs.rmSync(src, { recursive: true, force: true });
      } catch {
        // harmless leftover — ignored
      }
    }
  }
  console.log('[userScope] migrated legacy local data into _offline/');
}

/**
 * Initialize the scope. `getBaseFileRoot` returns the configurable base root.
 * Safe to call once at startup before any data path is resolved.
 */
export function initUserScope(getBaseFileRoot) {
  baseRootResolver = getBaseFileRoot;
  migrateLegacyToOffline();
  currentUser = readCurrentUserFile();
  initialized = true;
}

export function isInitialized() {
  return initialized;
}

/** The active data root for the currently selected user (or offline). */
export function getActiveUserRoot() {
  const base = getBaseRoot();
  if (currentUser && currentUser.userId) {
    return path.join(base, 'users', currentUser.userId);
  }
  return path.join(base, '_offline');
}

export function getCurrentUser() {
  return currentUser;
}

/** True when a real account is logged in (not offline / not unset). */
export function isLoggedIn() {
  return Boolean(currentUser && currentUser.userId);
}

/** True when the user explicitly chose offline mode. */
export function isOffline() {
  return Boolean(currentUser && currentUser.offline);
}

/**
 * Whether the login screen should be shown: no choice has been made yet
 * (neither logged in nor explicitly offline).
 */
export function needsAuthChoice() {
  return !isLoggedIn() && !isOffline();
}

/** Persist + activate a logged-in user. */
export function setCurrentUser(userInfo) {
  if (!userInfo || !userInfo.userId) throw new Error('setCurrentUser requires userId');
  const value = {
    userId: userInfo.userId,
    email: userInfo.email || '',
    displayName: userInfo.displayName || '',
    orgId: userInfo.orgId || '',
    orgRole: userInfo.orgRole || 'member',
  };
  writeCurrentUserFile(value);
  currentUser = value;
  // Ensure the per-user root exists.
  fs.mkdirSync(getActiveUserRoot(), { recursive: true });
  return currentUser;
}

/** Persist + activate explicit offline mode. */
export function setOffline() {
  const value = { offline: true };
  writeCurrentUserFile(value);
  currentUser = value;
  fs.mkdirSync(getActiveUserRoot(), { recursive: true });
  return currentUser;
}

/** Clear the current selection (used by logout before showing login). */
export function clearCurrentUser() {
  writeCurrentUserFile(null);
  currentUser = null;
}
