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

import fs from 'node:fs';
import path from 'node:path';
import { getBindingStatus } from '../cloud/cloudBinding.js';
import { scanWorkspace } from '../cloud/workspaceScanner.js';
import { publishWorkspace } from '../cloud/publishWorkspace.js';
import { pullWorkspace, pullUpdate } from '../cloud/pullWorkspace.js';
import { pushSync, computeWorkspaceSyncPlan } from '../cloud/pushSync.js';
import { getSyncSummary } from '../cloud/syncStatus.js';
import { downloadPlaceholder } from '../cloud/downloadOnDemand.js';
import { restoreFileFromVersion } from '../cloud/fileRestore.js';
import { createAuthCloudClient } from '../cloud/cloudClient.js';
import { getLockedWorkspaces } from '../cloud/publishLock.js';
import * as userScope from '../cloud/userScope.js';

// Throttle progress pushes so a project with thousands of files does not
// flood the renderer IPC channel.
const PROGRESS_MIN_INTERVAL_MS = 120;

export function registerCloudIpc({ ipcMain, getWorkspaceDirOrThrow, createLocalCloudProject }) {
  if (!ipcMain) throw new Error('registerCloudIpc: ipcMain is required');
  if (typeof getWorkspaceDirOrThrow !== 'function') {
    throw new Error('registerCloudIpc: getWorkspaceDirOrThrow is required');
  }

  // Active publish/pull cancellation flags, keyed by normalized key.
  const cancelFlags = new Map();
  const pullCancelFlags = new Map();
  // C5 sync cancellation flags, keyed by projectDir.
  const syncCancelFlags = new Map();

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

    // C3.5+: Use the authenticated client so the workspace is created under
    // the real logged-in user (not the hardcoded dev identity).
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '请先登录后再发布云端项目', code: 'OFFLINE' };
    }
    const cloudClient = createAuthCloudClient();
    const currentUser = userScope.getCurrentUser();

    try {
      const result = await publishWorkspace({
        projectDir,
        projectName,
        domain,
        cloudName: payload?.cloudName || projectName,
        description: payload?.description || '',
        message: payload?.message || '初始发布',
        orgId: currentUser.orgId || undefined,
        userId: currentUser.userId,
        userDisplayName: currentUser.displayName || currentUser.email || '',
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

  // ── C4: list org workspaces (cloud browse) ──────────────────────
  ipcMain.handle('cloud/listWorkspaces', async () => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法访问云端项目', code: 'OFFLINE' };
    }
    try {
      const client = createAuthCloudClient();
      const res = await client.get('/api/workspaces');
      return res;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── C4: join a workspace ────────────────────────────────────────
  ipcMain.handle('cloud/joinWorkspace', async (_evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法加入云端项目', code: 'OFFLINE' };
    }
    const workspaceId = payload?.workspaceId;
    if (!workspaceId) return { ok: false, error: '缺少 workspaceId' };
    try {
      const client = createAuthCloudClient();
      const res = await client.post(`/api/workspaces/${workspaceId}/join`, {});
      return res;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── C4: pull a workspace into a fresh local copy ────────────────
  // Track workspaces actively being pulled so double-clicks cannot create
  // duplicate local copies.
  const activePullWorkspaces = new Set();

  ipcMain.handle('cloud/pull', async (evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法拉取云端项目', code: 'OFFLINE' };
    }
    if (typeof createLocalCloudProject !== 'function') {
      return { ok: false, error: '本地项目创建器不可用' };
    }
    const workspaceId = payload?.workspaceId;
    const cloudName = payload?.name || '云端项目';
    const domain = payload?.domain || 'projects';
    if (!workspaceId) return { ok: false, error: '缺少 workspaceId' };

    if (activePullWorkspaces.has(workspaceId)) {
      return { ok: false, error: '该项目正在拉取中，请勿重复操作', code: 'PULL_IN_PROGRESS' };
    }
    activePullWorkspaces.add(workspaceId);
    pullCancelFlags.set(workspaceId, false);

    let lastSentAt = 0;
    const onProgress = (progress) => {
      const now = Date.now();
      const isTerminal = progress.status === 'done' || progress.status === 'error';
      if (!isTerminal && now - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastSentAt = now;
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:pullProgress', { workspaceId, ...progress });
      }
    };

    let local = null;
    try {
      const client = createAuthCloudClient();
      // Ensure membership before reading the manifest (idempotent).
      await client.post(`/api/workspaces/${workspaceId}/join`, {}).catch(() => undefined);

      // Verify cloud connectivity by fetching the manifest first, BEFORE
      // creating any local directory. This ensures an OSS/network error
      // cannot leave behind empty duplicate project folders.
      const manifest = await client.get(`/api/workspaces/${workspaceId}/versions/latest`);
      if (!manifest?.ok) throw new Error(manifest?.error || '获取清单失败');

      // Create the local destination project (system dirs only; the manifest
      // carries the real folder/file structure).
      local = createLocalCloudProject({ domain, name: cloudName });

      const current = userScope.getCurrentUser() || {};
      const result = await pullWorkspace({
        workspaceId,
        projectDir: local.projectDir,
        domain: local.domain,
        cloudClient: client,
        prefetchedManifest: manifest,
        userMeta: { userId: current.userId, displayName: current.displayName, orgId: current.orgId },
        shouldCancel: () => pullCancelFlags.get(workspaceId) === true,
        onProgress,
      });
      return { ...result, projectName: local.finalName, domain: local.domain };
    } catch (err) {
      // Clean up the freshly created local directory on failure so the user
      // does not end up with orphaned empty project folders.
      if (local?.projectDir) {
        try {
          const binding = getBindingStatus(local.projectDir);
          if (!binding.bound) {
            fs.rmSync(local.projectDir, { recursive: true, force: true });
          }
        } catch { /* best-effort cleanup */ }
      }
      const message = err instanceof Error ? err.message : String(err);
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:pullProgress', {
          workspaceId,
          step: 'error',
          status: 'error',
          error: message,
          code: err?.code || null,
        });
      }
      return { ok: false, error: message, code: err?.code || null };
    } finally {
      activePullWorkspaces.delete(workspaceId);
      pullCancelFlags.delete(workspaceId);
    }
  });

  ipcMain.handle('cloud/cancelPull', async (_evt, payload) => {
    const workspaceId = payload?.workspaceId;
    if (workspaceId && pullCancelFlags.has(workspaceId)) {
      pullCancelFlags.set(workspaceId, true);
      return { ok: true, cancelling: true };
    }
    return { ok: true, cancelling: false };
  });

  // ── C5: lightweight sync status (local + remote change detection) ─
  ipcMain.handle('cloud/getSyncStatus', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const status = getBindingStatus(projectDir);
    if (!status.bound) return { ok: true, bound: false };
    const bindingRole = status.binding?.role || 'editor';
    if (!userScope.isLoggedIn()) {
      return { ok: true, bound: true, offline: true, role: bindingRole };
    }
    try {
      const client = createAuthCloudClient();
      const summary = await getSyncSummary({ projectDir, cloudClient: client });
      // Prefer the server-authoritative role from sync-status (backed by
      // workspace_members) over the locally cached binding role.
      return {
        ok: true,
        bound: true,
        role: summary.myRole || bindingRole,
        ...summary,
        // Surface remote check failure so the UI can show a warning instead
        // of silently showing "已同步" when the API call actually failed.
        remoteCheckFailed: Boolean(summary.remoteError),
      };
    } catch (err) {
      console.error('[cloud/getSyncStatus] error:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── C5: compute a sync plan (preview, no writes) ────────────────
  ipcMain.handle('cloud/computeSyncPlan', async (_evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法同步云端项目', code: 'OFFLINE' };
    }
    const { name: projectName, domain, projectDir } = getWorkspaceDirOrThrow(
      payload?.projectName,
      payload?.domain,
    );
    try {
      const client = createAuthCloudClient();
      const ctx = await computeWorkspaceSyncPlan({ projectDir, domain, projectName, cloudClient: client });
      return { ok: true, plan: ctx.plan, remoteAhead: ctx.remoteAhead, userRole: ctx.userRole };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: err?.code || null };
    }
  });

  // ── C5: push local changes (upload + commit sync version) ───────
  ipcMain.handle('cloud/pushSync', async (evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法同步云端项目', code: 'OFFLINE' };
    }
    const { name: projectName, domain, projectDir } = getWorkspaceDirOrThrow(
      payload?.projectName,
      payload?.domain,
    );
    syncCancelFlags.set(projectDir, false);

    let lastSentAt = 0;
    const onProgress = (progress) => {
      const now = Date.now();
      const isTerminal = progress.status === 'done' || progress.status === 'error';
      if (!isTerminal && now - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastSentAt = now;
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:syncProgress', { projectName, domain, direction: 'push', ...progress });
      }
    };

    try {
      const client = createAuthCloudClient();
      const result = await pushSync({
        projectDir,
        domain,
        projectName,
        message: payload?.message || '同步更新',
        cloudClient: client,
        shouldCancel: () => syncCancelFlags.get(projectDir) === true,
        onProgress,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:syncProgress', {
          projectName,
          domain,
          direction: 'push',
          step: 'error',
          status: 'error',
          error: message,
          code: err?.code || null,
        });
      }
      return { ok: false, error: message, code: err?.code || null, plan: err?.plan || null };
    } finally {
      syncCancelFlags.delete(projectDir);
    }
  });

  // ── C5: pull cloud changes onto an existing local copy ──────────
  ipcMain.handle('cloud/pullUpdate', async (evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法同步云端项目', code: 'OFFLINE' };
    }
    const { name: projectName, domain, projectDir } = getWorkspaceDirOrThrow(
      payload?.projectName,
      payload?.domain,
    );
    syncCancelFlags.set(projectDir, false);

    let lastSentAt = 0;
    const onProgress = (progress) => {
      const now = Date.now();
      const isTerminal = progress.status === 'done' || progress.status === 'error';
      if (!isTerminal && now - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastSentAt = now;
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:syncProgress', { projectName, domain, direction: 'pull', ...progress });
      }
    };

    try {
      const client = createAuthCloudClient();
      const current = userScope.getCurrentUser() || {};
      const result = await pullUpdate({
        projectDir,
        domain,
        projectName,
        cloudClient: client,
        userMeta: { userId: current.userId, displayName: current.displayName, orgId: current.orgId },
        shouldCancel: () => syncCancelFlags.get(projectDir) === true,
        onProgress,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!evt.sender.isDestroyed()) {
        evt.sender.send('cloud:syncProgress', {
          projectName,
          domain,
          direction: 'pull',
          step: 'error',
          status: 'error',
          error: message,
          code: err?.code || null,
        });
      }
      return { ok: false, error: message, code: err?.code || null, plan: err?.plan || null };
    } finally {
      syncCancelFlags.delete(projectDir);
    }
  });

  // ── C5: cancel an in-flight push/pull sync ──────────────────────
  ipcMain.handle('cloud/cancelSync', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    if (syncCancelFlags.has(projectDir)) {
      syncCancelFlags.set(projectDir, true);
      return { ok: true, cancelling: true };
    }
    return { ok: true, cancelling: false };
  });

  // ── C5: create a milestone version (owner only) ─────────────────
  ipcMain.handle('cloud/createMilestone', async (_evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法创建版本', code: 'OFFLINE' };
    }
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const status = getBindingStatus(projectDir);
    if (!status.bound) return { ok: false, error: '该项目未绑定云端' };
    const label = String(payload?.label || '').trim();
    if (!label) return { ok: false, error: '请填写版本名称' };

    const workspaceId = status.binding.cloudWorkspaceId;
    try {
      const client = createAuthCloudClient();
      // Promote the current version to a milestone.
      const statusRes = await client.get(`/api/workspaces/${workspaceId}/sync-status`);
      const versionId = statusRes?.currentVersionId;
      if (!versionId) return { ok: false, error: '当前没有可标记的版本' };
      const res = await client.post(`/api/workspaces/${workspaceId}/versions/${versionId}/promote`, { label });
      return res;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: err?.code || null };
    }
  });

  // ── C5: list versions / milestones ──────────────────────────────
  ipcMain.handle('cloud/listVersions', async (_evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法访问版本历史', code: 'OFFLINE' };
    }
    const workspaceId = payload?.workspaceId;
    if (!workspaceId) {
      const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
      const status = getBindingStatus(projectDir);
      if (!status.bound) return { ok: false, error: '该项目未绑定云端' };
      payload = { ...payload, workspaceId: status.binding.cloudWorkspaceId };
    }
    try {
      const client = createAuthCloudClient();
      const qs = payload?.type ? `?type=${encodeURIComponent(payload.type)}` : '';
      const res = await client.get(`/api/workspaces/${payload.workspaceId}/versions${qs}`);
      return res;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── C6: per-file history for restore ─────────────────────────────
  ipcMain.handle('cloud/listFileHistory', async (_evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法访问文件历史', code: 'OFFLINE' };
    }
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const status = getBindingStatus(projectDir);
    if (!status.bound) return { ok: false, error: '该项目未绑定云端' };
    const relPath = String(payload?.relPath || payload?.path || '').trim();
    if (!relPath) return { ok: false, error: '缺少文件路径' };

    try {
      const client = createAuthCloudClient();
      const qs = `?path=${encodeURIComponent(relPath)}`;
      return await client.get(`/api/workspaces/${status.binding.cloudWorkspaceId}/file-history${qs}`);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: err?.code || null };
    }
  });

  // ── C6: restore one historical file into local workspace ─────────
  ipcMain.handle('cloud/restoreFileFromVersion', async (_evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法恢复云端文件', code: 'OFFLINE' };
    }
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const status = getBindingStatus(projectDir);
    if (!status.bound) return { ok: false, error: '该项目未绑定云端' };
    const relPath = String(payload?.relPath || payload?.path || '').trim();
    const versionId = payload?.versionId;
    if (!relPath) return { ok: false, error: '缺少文件路径' };
    if (!versionId) return { ok: false, error: '缺少版本 ID' };

    try {
      const client = createAuthCloudClient();
      return await restoreFileFromVersion({
        projectDir,
        workspaceId: status.binding.cloudWorkspaceId,
        versionId,
        relPath,
        cloudClient: client,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: err?.code || null };
    }
  });

  // ── H4: cloud project management hub ──────────────────────────────
  // Thin pass-through helpers: every handler requires login, then proxies to
  // the corresponding server endpoint via the authenticated client.
  const requireCloud = () => {
    if (!userScope.isLoggedIn()) {
      const err = new Error('离线模式下无法访问云端项目');
      err.code = 'OFFLINE';
      throw err;
    }
    return createAuthCloudClient();
  };
  const proxy = (fn) => async (_evt, payload) => {
    try {
      const client = requireCloud();
      return await fn(client, payload || {});
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: err?.code || null };
    }
  };

  // Public (discoverable) workspaces in my org.
  ipcMain.handle('cloud/listPublicWorkspaces', proxy(
    (client) => client.get('/api/workspaces/public'),
  ));

  // Join a private workspace using a project invite code (grants editor).
  ipcMain.handle('cloud/joinByCode', proxy(
    (client, p) => client.post('/api/workspaces/join-by-code', { code: String(p.code || '').trim() }),
  ));

  // Member-visible project overview (stats, recent versions, my role).
  ipcMain.handle('cloud/getWorkspaceOverview', proxy(
    (client, p) => client.get(`/api/workspaces/${p.workspaceId}/overview`),
  ));

  // Member list (any member may view).
  ipcMain.handle('cloud/listWorkspaceMembers', proxy(
    (client, p) => client.get(`/api/workspaces/${p.workspaceId}/members`),
  ));

  // Owner self-service: viewer ↔ editor.
  ipcMain.handle('cloud/setMemberRole', proxy(
    (client, p) => client.post(`/api/workspaces/${p.workspaceId}/members/${p.userId}/role`, { role: p.role }),
  ));

  // Owner self-service: remove a member.
  ipcMain.handle('cloud/removeMember', proxy(
    (client, p) => client.post(`/api/workspaces/${p.workspaceId}/members/${p.userId}/remove`, {}),
  ));

  // Owner self-service: transfer ownership (previous owner becomes editor).
  ipcMain.handle('cloud/transferOwner', proxy(
    (client, p) => client.post(`/api/workspaces/${p.workspaceId}/transfer-owner`, { newOwnerId: p.newOwnerId }),
  ));

  // Owner self-service: private ↔ public.
  ipcMain.handle('cloud/setVisibility', proxy(
    (client, p) => client.post(`/api/workspaces/${p.workspaceId}/visibility`, { visibility: p.visibility }),
  ));

  // Owner self-service: invite codes.
  ipcMain.handle('cloud/listInvites', proxy(
    (client, p) => client.get(`/api/workspaces/${p.workspaceId}/invites`),
  ));
  ipcMain.handle('cloud/createInvite', proxy(
    (client, p) => client.post(`/api/workspaces/${p.workspaceId}/invites`, {
      maxUses: p.maxUses ?? 1,
      ...(p.expiresInDays ? { expiresInDays: p.expiresInDays } : {}),
    }),
  ));
  ipcMain.handle('cloud/revokeInvite', proxy(
    (client, p) => client.post(`/api/workspaces/${p.workspaceId}/invites/${p.inviteId}/revoke`, {}),
  ));

  // ── C4: on-demand download of a placeholdered large file ────────
  ipcMain.handle('cloud/downloadFile', async (evt, payload) => {
    if (!userScope.isLoggedIn()) {
      return { ok: false, error: '离线模式下无法下载云端文件', code: 'OFFLINE' };
    }
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.placeholderRelPath || '').replace(/^[/\\]+/, '');
    if (!relPath) return { ok: false, error: '缺少占位文件路径' };
    const placeholderPath = path.join(projectDir, ...relPath.split(/[/\\]/).filter(Boolean));

    try {
      const client = createAuthCloudClient();
      let lastSentAt = 0;
      const result = await downloadPlaceholder({
        placeholderPath,
        cloudClient: client,
        onProgress: ({ received, total }) => {
          const now = Date.now();
          if (now - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
          lastSentAt = now;
          if (!evt.sender.isDestroyed()) {
            evt.sender.send('cloud:pullProgress', {
              step: 'fileDownload',
              status: 'running',
              placeholderRelPath: relPath,
              received,
              total,
            });
          }
        },
      });
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: err?.code || null };
    }
  });
}
