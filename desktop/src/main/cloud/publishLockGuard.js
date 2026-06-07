// C3: Centralized publish-lock guard for IPC write handlers.
//
// Rather than editing every write handler, we wrap `ipcMain` in a Proxy that
// intercepts `.handle` for a known set of write channels. Before the original
// handler runs, the guard resolves the target project directory from the
// payload (each channel uses slightly different keys) and, if that directory
// is currently locked for publishing, throws WorkspaceLockedError.
//
// KnowClaw's `send` / `uploadToWorkspace` are NOT covered here because they
// key off an absolute `ch.cwd` rather than {projectName, domain}; those are
// guarded inline inside knowclaw.js.

import { isWorkspaceLocked, WorkspaceLockedError } from './publishLock.js';

// Maps a guarded channel to a function that returns the target projectDir
// from the IPC payload. Returning null means "cannot resolve, skip guard".
function buildResolvers(getWorkspaceDirOrThrow) {
  const byProjectName = (p) => getWorkspaceDirOrThrow(p?.projectName, p?.domain).projectDir;
  const projectByName = (p) => getWorkspaceDirOrThrow(p?.name, 'projects').projectDir;
  const projectByOldName = (p) => getWorkspaceDirOrThrow(p?.oldName, 'projects').projectDir;
  const caseByName = (p) => getWorkspaceDirOrThrow(p?.name, 'cases').projectDir;
  const caseByOldName = (p) => getWorkspaceDirOrThrow(p?.oldName, 'cases').projectDir;

  return {
    'explorer/mkdir': byProjectName,
    'explorer/delete': byProjectName,
    'explorer/upload': byProjectName,
    'explorer/drop-upload': byProjectName,
    'explorer/rename': byProjectName,
    'explorer/move': byProjectName,
    'projects/delete': projectByName,
    'projects/rename': projectByOldName,
    'cases/delete': caseByName,
    'cases/rename': caseByOldName,
    'aiStorage/accept': byProjectName,
    'aiStorage/acceptAll': byProjectName,
    'floating/copyToTemp': byProjectName,
  };
}

export function createLockGuardedIpcMain(ipcMain, { getWorkspaceDirOrThrow }) {
  if (typeof getWorkspaceDirOrThrow !== 'function') {
    throw new Error('createLockGuardedIpcMain: getWorkspaceDirOrThrow is required');
  }
  const resolvers = buildResolvers(getWorkspaceDirOrThrow);

  return new Proxy(ipcMain, {
    get(target, prop, receiver) {
      if (prop === 'handle') {
        return (channel, handler) => {
          const resolve = resolvers[channel];
          if (!resolve) {
            return target.handle(channel, handler);
          }
          return target.handle(channel, async (evt, payload, ...rest) => {
            let projectDir = null;
            try {
              projectDir = resolve(payload);
            } catch {
              // Resolution failed (e.g. dir missing). Let the original handler
              // run so it can produce its own, more specific error.
              projectDir = null;
            }
            if (projectDir && isWorkspaceLocked(projectDir)) {
              throw new WorkspaceLockedError();
            }
            return handler(evt, payload, ...rest);
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      // Bind functions so `this` stays the real ipcMain.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
