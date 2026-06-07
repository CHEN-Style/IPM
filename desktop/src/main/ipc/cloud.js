// Cloud IPC surface.
//
// C2 (offline):
//   - cloud/getBindingStatus : read meta/cloud.json, report binding state
//   - cloud/scanWorkspace    : full SHA-256 scan of a workspace's files
//   - cloud:scanProgress     : per-file hashing progress (push)
// C3 (publish):
//   - cloud/publish              : run the full publish pipeline
//   - cloud/cancelPublish        : request cancellation of an active publish
//   - cloud/getLockedWorkspaces  : list workspaces currently locked
//   - cloud:publishProgress      : publish step progress (push)

import { getBindingStatus } from '../cloud/cloudBinding.js';
import { scanWorkspace } from '../cloud/workspaceScanner.js';
import { publishWorkspace } from '../cloud/publishWorkspace.js';
import { createDevCloudClient } from '../cloud/cloudClient.js';
import { getLockedWorkspaces } from '../cloud/publishLock.js';

// Throttle progress pushes so a project with thousands of files does not
// flood the renderer IPC channel.
const PROGRESS_MIN_INTERVAL_MS = 120;

export function registerCloudIpc({ ipcMain, getWorkspaceDirOrThrow }) {
  if (!ipcMain) throw new Error('registerCloudIpc: ipcMain is required');
  if (typeof getWorkspaceDirOrThrow !== 'function') {
    throw new Error('registerCloudIpc: getWorkspaceDirOrThrow is required');
  }

  // Active publish cancellation flags, keyed by normalized project dir.
  const cancelFlags = new Map();

  ipcMain.handle('cloud/getBindingStatus', async (_evt, payload) => {
    const { name: projectName, domain, projectDir } = getWorkspaceDirOrThrow(
      payload?.projectName,
      payload?.domain,
    );
    const { bound, binding } = getBindingStatus(projectDir);
    return { ok: true, projectName, domain, bound, binding };
  });

  ipcMain.handle('cloud/scanWorkspace', async (evt, payload) => {
    const { name: projectName, domain, projectDir } = getWorkspaceDirOrThrow(
      payload?.projectName,
      payload?.domain,
    );

    let lastSentAt = 0;
    const onProgress = (progress) => {
      const now = Date.now();
      // Always let the final file through; throttle the rest.
      const isLast = progress.total > 0 && progress.current >= progress.total;
      if (!isLast && now - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastSentAt = now;
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:scanProgress', {
          projectName,
          domain,
          ...progress,
        });
      }
    };

    const result = await scanWorkspace(projectDir, { domain, projectName, onProgress });
    return { ok: true, ...result };
  });

  ipcMain.handle('cloud/publish', async (evt, payload) => {
    const { name: projectName, domain, projectDir } = getWorkspaceDirOrThrow(
      payload?.projectName,
      payload?.domain,
    );

    // Refuse double-publish of an already bound workspace.
    const status = getBindingStatus(projectDir);
    if (status.bound) {
      return { ok: false, error: '该项目已绑定云端，无法重复发布' };
    }

    cancelFlags.set(projectDir, false);

    let lastSentAt = 0;
    const onProgress = (progress) => {
      const now = Date.now();
      const isTerminal = progress.status === 'done' || progress.status === 'error';
      if (!isTerminal && now - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastSentAt = now;
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:publishProgress', { projectName, domain, ...progress });
      }
    };

    const cloudClient = createDevCloudClient();

    try {
      const result = await publishWorkspace({
        projectDir,
        projectName,
        domain,
        cloudName: payload?.cloudName || projectName,
        description: payload?.description || '',
        message: payload?.message || '初始发布',
        cloudClient,
        shouldCancel: () => cancelFlags.get(projectDir) === true,
        onProgress,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:publishProgress', {
          projectName,
          domain,
          step: 'error',
          status: 'error',
          error: message,
          code: err?.code || null,
        });
      }
      return { ok: false, error: message, code: err?.code || null };
    } finally {
      cancelFlags.delete(projectDir);
    }
  });

  ipcMain.handle('cloud/cancelPublish', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    if (cancelFlags.has(projectDir)) {
      cancelFlags.set(projectDir, true);
      return { ok: true, cancelling: true };
    }
    return { ok: true, cancelling: false };
  });

  ipcMain.handle('cloud/getLockedWorkspaces', async () => {
    return { ok: true, locked: getLockedWorkspaces() };
  });
}
