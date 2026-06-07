// C3: In-memory publish lock.
//
// While a workspace is being published (or, later, pushed) we must prevent any
// concurrent modification of its files — by the user via explorer/project ops,
// by AI auto-classification, or by the KnowClaw agent writing into the same
// directory. This module tracks locked workspace directories and offers a
// guard the IPC handlers call before performing a write.
//
// Matching is path-prefix based so that KnowClaw, whose cwd is an absolute
// path decoupled from the IPM project name, is also covered: if its cwd falls
// under a locked project directory, the operation is blocked.

import path from 'node:path';

const lockedPaths = new Map(); // normalizedDir -> { projectDir, domain, projectName, startedAt }

export class WorkspaceLockedError extends Error {
  constructor(message = '该项目正在云端发布，暂时无法修改') {
    super(message);
    this.name = 'WorkspaceLockedError';
    this.code = 'WORKSPACE_LOCKED';
  }
}

function normalize(p) {
  if (!p) return '';
  return path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
}

export function lockWorkspace(projectDir, info = {}) {
  const key = normalize(projectDir);
  if (!key) throw new Error('lockWorkspace: projectDir is required');
  lockedPaths.set(key, {
    projectDir,
    domain: info.domain ?? null,
    projectName: info.projectName ?? null,
    startedAt: new Date().toISOString(),
  });
  return key;
}

export function unlockWorkspace(projectDir) {
  return lockedPaths.delete(normalize(projectDir));
}

/**
 * Whether the given path is locked. Returns true if `targetPath` equals a
 * locked dir or is nested under one (prefix match), so child paths and the
 * KnowClaw cwd are both covered.
 */
export function isWorkspaceLocked(targetPath) {
  const target = normalize(targetPath);
  if (!target) return false;
  if (lockedPaths.has(target)) return true;
  for (const lockedKey of lockedPaths.keys()) {
    if (target === lockedKey || target.startsWith(`${lockedKey}${path.sep.toLowerCase()}`) || target.startsWith(`${lockedKey}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Throw a WorkspaceLockedError if the path is locked. IPC write handlers call
 * this at their entry point.
 */
export function assertNotLocked(targetPath) {
  if (isWorkspaceLocked(targetPath)) {
    throw new WorkspaceLockedError();
  }
}

export function getLockedWorkspaces() {
  return [...lockedPaths.values()].map((v) => ({
    projectDir: v.projectDir,
    domain: v.domain,
    projectName: v.projectName,
    startedAt: v.startedAt,
  }));
}
