// desktop/Agent/pi-runtime/sessionFactory.js
//
// Phase-2: thin wrapper around pi's `SessionManager` static factories.
//
// Why a wrapper instead of calling `SessionManager.*` directly:
//   1. We need session files in IPM's own userData directory, not in
//      pi's global `~/.pi/agent/sessions/`. pi's `getDefaultSessionDir`
//      is not exported from the package's public entry point, so we
//      replicate its cwd-encoding scheme here and pass an explicit
//      `sessionDir` to every SessionManager factory.
//   2. We centralize the four supported modes (`new` / `continueRecent`
//      / `open` / `inMemory`) so bootstrap.js stays focused on session
//      lifecycle, not storage.
//
// Storage layout:
//   $KNOWCLAW_SESSION_ROOT/<cwdHash>/<timestamp>_<uuid>.jsonl
//
//   - `$KNOWCLAW_SESSION_ROOT` is set by `main.js` to
//     `app.getPath('userData')/knowclaw-sessions`. When running outside
//     Electron (tests / standalone) we fall back to
//     `os.homedir()/.ipm-knowclaw/sessions` so the module still works.
//   - `<cwdHash>` uses pi's encoding (`--<cwd>--` with `/\\:` replaced
//     by `-`) so the layout is interchangeable with pi defaults if a
//     user ever points pi at the same root.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';

const DEFAULT_FALLBACK_ROOT = path.join(os.homedir(), '.ipm-knowclaw', 'sessions');

/**
 * Resolve the session-root directory that holds per-cwd subdirectories.
 * Reads `process.env.KNOWCLAW_SESSION_ROOT` (set by main.js).
 */
function getSessionRoot() {
  const fromEnv = process.env.KNOWCLAW_SESSION_ROOT;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv;
  }
  return DEFAULT_FALLBACK_ROOT;
}

/**
 * Encode a cwd into a filesystem-safe subdirectory name. Matches pi's
 * own `getDefaultSessionDir` scheme so the layout is interchangeable.
 *
 * @param {string} cwd
 * @returns {string}
 */
function encodeCwd(cwd) {
  const trimmed = String(cwd || '').replace(/^[/\\]/, '').replace(/[/\\]+$/, '');
  return `--${trimmed.replace(/[/\\:]/g, '-')}--`;
}

/**
 * Get the absolute session directory for a given cwd. Ensures the
 * directory exists (mkdir -p).
 *
 * @param {string} cwd
 * @returns {string}
 */
export function getSessionDir(cwd) {
  const dir = path.join(getSessionRoot(), encodeCwd(cwd));
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Caller will get the path back; downstream pi APIs will surface
    // any write errors via their own try/catch.
  }
  return dir;
}

/**
 * @typedef {'new' | 'continueRecent' | 'open' | 'inMemory'} SessionMode
 */

/**
 * Build a SessionManager for the given mode + cwd. Throws if `mode` is
 * unsupported or if `mode === 'open'` is requested without a
 * `sessionFile`.
 *
 * @param {object} opts
 * @param {SessionMode} [opts.mode='continueRecent']
 * @param {string} opts.cwd
 * @param {string} [opts.sessionFile]  Required when mode === 'open'.
 * @returns {import('@earendil-works/pi-coding-agent').SessionManager}
 */
export function makeSessionManager(opts = {}) {
  const cwd = String(opts.cwd || process.cwd());
  const mode = opts.mode || 'continueRecent';

  if (mode === 'inMemory') {
    return SessionManager.inMemory(cwd);
  }

  const sessionDir = getSessionDir(cwd);

  switch (mode) {
    case 'new':
      return SessionManager.create(cwd, sessionDir);
    case 'continueRecent':
      return SessionManager.continueRecent(cwd, sessionDir);
    case 'open': {
      if (!opts.sessionFile) {
        throw new Error("makeSessionManager: mode='open' requires sessionFile");
      }
      return SessionManager.open(opts.sessionFile, sessionDir, cwd);
    }
    default:
      throw new Error(`makeSessionManager: unsupported mode '${mode}'`);
  }
}

/**
 * @typedef {object} SessionListEntry
 * @property {string} path           Absolute path to the .jsonl file.
 * @property {string} id             Session UUID (from header).
 * @property {string} cwd            cwd recorded in the header.
 * @property {string | undefined} name  User-set session name, if any.
 * @property {Date}   created
 * @property {Date}   modified
 * @property {number} messageCount
 * @property {string} firstMessage   First user message (preview).
 */

/**
 * List persisted sessions for a cwd, newest-first.
 *
 * @param {string} cwd
 * @returns {Promise<SessionListEntry[]>}
 */
export async function listSessions(cwd) {
  const sessionDir = getSessionDir(cwd);
  try {
    const sessions = await SessionManager.list(cwd, sessionDir);
    return sessions.map((s) => ({
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created,
      modified: s.modified,
      messageCount: s.messageCount,
      firstMessage: s.firstMessage,
    }));
  } catch {
    return [];
  }
}

/**
 * Best-effort introspection of a SessionManager: persisted state and
 * the underlying file path (when persisted). Used by bootstrap.js for
 * diagnostic logging.
 *
 * @param {*} sm
 * @returns {{ persisted: boolean, sessionFile: string | null }}
 */
export function describeSessionManager(sm) {
  if (!sm) return { persisted: false, sessionFile: null };
  let persisted = false;
  let sessionFile = null;
  try {
    if (typeof sm.isPersisted === 'function') {
      persisted = Boolean(sm.isPersisted());
    }
  } catch { /* ignore */ }
  try {
    if (typeof sm.getSessionFile === 'function') {
      sessionFile = sm.getSessionFile() || null;
    }
  } catch { /* ignore */ }
  return { persisted, sessionFile };
}
