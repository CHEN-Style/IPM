// H2 Enterprise Admin IPC: org info, member management, invite management.
//
// Thin pass-through to the cloud `/api/org/**` endpoints. Permission rules
// (owner immutable, admin manages members only, no self-disable) are enforced
// server-side; the renderer only adapts the UI to the caller's role.

import { createAuthCloudClient } from '../cloud/cloudClient.js';

function fail(err) {
  return {
    ok: false,
    error: String(err?.message || err),
    // H1 machine-readable code (ORG_FORBIDDEN / OWNER_IMMUTABLE / ...).
    code: err?.code || null,
  };
}

export function registerOrgIpc({ ipcMain }) {
  if (!ipcMain) throw new Error('registerOrgIpc: ipcMain is required');

  ipcMain.handle('org/getInfo', async () => {
    try {
      const client = createAuthCloudClient();
      return await client.get('/api/org');
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/listMembers', async () => {
    try {
      const client = createAuthCloudClient();
      return await client.get('/api/org/members');
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/setMemberRole', async (_evt, payload) => {
    const userId = typeof payload?.userId === 'string' ? payload.userId : '';
    const role = payload?.role === 'admin' || payload?.role === 'member' ? payload.role : '';
    if (!userId || !role) return { ok: false, error: 'userId 和 role 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/members/${userId}/role`, { role });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/disableMember', async (_evt, payload) => {
    const userId = typeof payload?.userId === 'string' ? payload.userId : '';
    if (!userId) return { ok: false, error: 'userId 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/members/${userId}/disable`, {});
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/restoreMember', async (_evt, payload) => {
    const userId = typeof payload?.userId === 'string' ? payload.userId : '';
    if (!userId) return { ok: false, error: 'userId 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/members/${userId}/restore`, {});
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/listInvites', async () => {
    try {
      const client = createAuthCloudClient();
      return await client.get('/api/org/invites');
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/createInvite', async (_evt, payload) => {
    const role = payload?.role === 'admin' ? 'admin' : 'member';
    const maxUses = Number.isInteger(payload?.maxUses) && payload.maxUses > 0 ? payload.maxUses : 10;
    const expiresDays =
      Number.isInteger(payload?.expiresDays) && payload.expiresDays > 0 ? payload.expiresDays : null;
    try {
      const client = createAuthCloudClient();
      return await client.post('/api/org/invites', { role, maxUses, expiresDays });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/revokeInvite', async (_evt, payload) => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) return { ok: false, error: 'id 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/invites/${id}/revoke`, {});
    } catch (err) {
      return fail(err);
    }
  });

  // ── H7: enterprise stats & audit ──────────────────────────────────

  ipcMain.handle('org/getStats', async () => {
    try {
      const client = createAuthCloudClient();
      return await client.get('/api/org/stats');
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/listEvents', async (_evt, payload) => {
    const params = new URLSearchParams();
    const f = payload && typeof payload === 'object' ? payload : {};
    if (typeof f.type === 'string' && f.type) params.set('type', f.type);
    if (typeof f.actor === 'string' && f.actor) params.set('actor', f.actor);
    if (typeof f.workspaceId === 'string' && f.workspaceId) params.set('workspaceId', f.workspaceId);
    if (typeof f.skillId === 'string' && f.skillId) params.set('skillId', f.skillId);
    if (typeof f.templateId === 'string' && f.templateId) params.set('templateId', f.templateId);
    if (Number.isInteger(f.limit) && f.limit > 0) params.set('limit', String(f.limit));
    if (typeof f.before === 'string' && f.before) params.set('before', f.before);
    const qs = params.toString();
    try {
      const client = createAuthCloudClient();
      return await client.get(`/api/org/events${qs ? `?${qs}` : ''}`);
    } catch (err) {
      return fail(err);
    }
  });

  // ── H3: workspace governance ──────────────────────────────────────

  ipcMain.handle('org/listWorkspaces', async () => {
    try {
      const client = createAuthCloudClient();
      return await client.get('/api/org/workspaces');
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/getWorkspaceDetail', async (_evt, payload) => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) return { ok: false, error: 'id 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.get(`/api/org/workspaces/${id}`);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/setWorkspaceStatus', async (_evt, payload) => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const action = ['archive', 'restore', 'disable'].includes(payload?.action) ? payload.action : '';
    if (!id || !action) return { ok: false, error: 'id 和 action 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/workspaces/${id}/${action}`, {});
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/transferWorkspaceOwner', async (_evt, payload) => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const userId = typeof payload?.userId === 'string' ? payload.userId : '';
    if (!id || !userId) return { ok: false, error: 'id 和 userId 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/workspaces/${id}/transfer-owner`, { userId });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('org/removeWorkspaceMember', async (_evt, payload) => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const userId = typeof payload?.userId === 'string' ? payload.userId : '';
    if (!id || !userId) return { ok: false, error: 'id 和 userId 必填' };
    try {
      const client = createAuthCloudClient();
      return await client.post(`/api/org/workspaces/${id}/members/${userId}/remove`, {});
    } catch (err) {
      return fail(err);
    }
  });
}
