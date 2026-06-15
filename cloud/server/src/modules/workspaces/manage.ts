// H4: project-owner self-service management.
//
// H3 gave enterprise admins a governance backstop (org/routes.ts); this file
// gives the project owner day-to-day control over their own workspace:
// member roles (viewer ↔ editor), removal, ownership transfer, visibility
// (private/public) and workspace invite codes. Every mutation writes an
// audit event with `by: 'project_owner'` so it stays distinguishable from
// enterprise-admin governance actions in the event stream.

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';
import { getWorkspaceAccess, requireWorkspaceAccess, type WorkspaceAccess } from './access.js';

function generateWorkspaceInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `WS-${block()}-${block()}`;
}

/**
 * Owner gate for management endpoints. Member-but-not-owner gets 403; the
 * rest (non-member / cross-org / disabled) is handled by the shared access
 * helper. Archived workspaces still allow member governance (consistent with
 * H3 enterprise governance) — content writes stay blocked elsewhere.
 */
async function requireOwner(
  reply: FastifyReply,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceAccess | null> {
  const access = await getWorkspaceAccess(workspaceId, userId);
  if (!access) {
    // Same generic 404 as requireWorkspaceAccess: hide existence from
    // non-members (identical response for nonexistent ids).
    reply.code(404).send({ ok: false, code: 'NOT_WORKSPACE_MEMBER', error: 'Workspace not found.' });
    return null;
  }
  if (access.status === 'disabled') {
    reply.code(403).send({ ok: false, code: 'WORKSPACE_DISABLED', error: '该项目已被企业停用。' });
    return null;
  }
  if (access.role !== 'owner') {
    reply.code(403).send({ ok: false, code: 'NOT_WORKSPACE_OWNER', error: '仅项目 owner 可执行此操作。' });
    return null;
  }
  return access;
}

async function writeWorkspaceEvent(
  orgId: string,
  workspaceId: string,
  actorId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await pool.query(
    `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orgId, workspaceId, actorId, eventType, JSON.stringify(payload)],
  );
}

export async function registerWorkspaceManageRoutes(app: FastifyInstance) {
  // ── Member list (any member may view) ───────────────────────────────
  app.get('/api/workspaces/:id/members', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const access = await requireWorkspaceAccess(reply, id, userId, 'read');
    if (!access) return;

    const res = await pool.query<{
      user_id: string;
      display_name: string;
      email: string;
      role: string;
      joined_at: string;
    }>(
      `SELECT wm.user_id, u.display_name, u.email, wm.role, wm.created_at AS joined_at
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1
        ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, wm.created_at`,
      [id],
    );
    return reply.send({
      ok: true,
      myRole: access.role,
      members: res.rows.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name,
        email: m.email,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    });
  });

  // ── Change a member's role: viewer ↔ editor (owner only) ───────────
  app.post('/api/workspaces/:id/members/:userId/role', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id, userId: targetUserId } = request.params as { id: string; userId: string };

    const parsed = z.object({ role: z.enum(['viewer', 'editor']) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;

    const target = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, targetUserId],
    );
    const t = target.rows[0];
    if (!t) return reply.code(404).send({ ok: false, code: 'MEMBER_NOT_FOUND', error: '目标用户不是该项目成员。' });
    if (t.role === 'owner') {
      return reply.code(409).send({ ok: false, code: 'CANNOT_CHANGE_OWNER', error: '不能修改 owner 的角色，请使用转移所有权。' });
    }
    if (t.role === parsed.data.role) {
      return reply.send({ ok: true, role: t.role, changed: false });
    }

    await pool.query(
      `UPDATE workspace_members SET role = $3, updated_at = now()
        WHERE workspace_id = $1 AND user_id = $2`,
      [id, targetUserId, parsed.data.role],
    );
    await writeWorkspaceEvent(access.orgId, id, actorId, 'workspace.member_role_changed', {
      by: 'project_owner',
      targetUserId,
      from: t.role,
      to: parsed.data.role,
    });
    return reply.send({ ok: true, role: parsed.data.role, changed: true });
  });

  // ── Remove a member (owner only; owner must transfer first) ─────────
  app.post('/api/workspaces/:id/members/:userId/remove', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id, userId: targetUserId } = request.params as { id: string; userId: string };

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;

    const target = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, targetUserId],
    );
    const t = target.rows[0];
    if (!t) return reply.code(404).send({ ok: false, code: 'MEMBER_NOT_FOUND', error: '目标用户不是该项目成员。' });
    if (t.role === 'owner') {
      return reply.code(409).send({ ok: false, code: 'OWNER_MUST_TRANSFER', error: '项目 owner 需先转移所有权才能移出。' });
    }

    await pool.query(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, targetUserId],
    );
    await writeWorkspaceEvent(access.orgId, id, actorId, 'workspace.member_removed', {
      by: 'project_owner',
      targetUserId,
      targetRole: t.role,
    });
    return reply.send({ ok: true, removed: true });
  });

  // ── Transfer ownership (owner only; previous owner becomes editor) ──
  app.post('/api/workspaces/:id/transfer-owner', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const parsed = z.object({ newOwnerId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { newOwnerId } = parsed.data;

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;

    const target = await pool.query<{ role: string; org_status: string | null; user_status: string }>(
      `SELECT wm.role, om.status AS org_status, u.status AS user_status
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN org_members om ON om.org_id = $1 AND om.user_id = wm.user_id
        WHERE wm.workspace_id = $2 AND wm.user_id = $3`,
      [access.orgId, id, newOwnerId],
    );
    const t = target.rows[0];
    if (!t) return reply.code(404).send({ ok: false, code: 'MEMBER_NOT_FOUND', error: '目标用户不是该项目成员。' });
    if (t.role === 'owner') return reply.send({ ok: true, changed: false });
    if (t.org_status !== 'active' || t.user_status !== 'active') {
      return reply.code(409).send({ ok: false, code: 'MEMBER_DISABLED', error: '目标成员的企业账号未处于正常状态。' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE workspace_members SET role = 'editor', updated_at = now()
          WHERE workspace_id = $1 AND role = 'owner'`,
        [id],
      );
      await client.query(
        `UPDATE workspace_members SET role = 'owner', updated_at = now()
          WHERE workspace_id = $1 AND user_id = $2`,
        [id, newOwnerId],
      );
      await client.query(
        `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
         VALUES ($1, $2, $3, 'workspace.owner_transferred', $4::jsonb)`,
        [access.orgId, id, actorId, JSON.stringify({ by: 'project_owner', from: actorId, to: newOwnerId })],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, changed: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  // ── Visibility: private ↔ public (owner only, active workspaces) ────
  app.post('/api/workspaces/:id/visibility', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const parsed = z.object({ visibility: z.enum(['private', 'public']) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;
    if (access.status === 'archived') {
      return reply.code(403).send({ ok: false, code: 'WORKSPACE_ARCHIVED', error: '该项目已归档（只读），无法修改可见性。' });
    }

    const cur = await pool.query<{ visibility: string }>(
      `SELECT visibility FROM workspaces WHERE id = $1`,
      [id],
    );
    const from = cur.rows[0]?.visibility;
    if (from === parsed.data.visibility) {
      return reply.send({ ok: true, visibility: from, changed: false });
    }

    await pool.query(
      `UPDATE workspaces SET visibility = $2, updated_at = now() WHERE id = $1`,
      [id, parsed.data.visibility],
    );
    await writeWorkspaceEvent(access.orgId, id, actorId, 'workspace.visibility_changed', {
      by: 'project_owner',
      from,
      to: parsed.data.visibility,
    });
    return reply.send({ ok: true, visibility: parsed.data.visibility, changed: true });
  });

  // ── Invite codes: list (owner only) ─────────────────────────────────
  app.get('/api/workspaces/:id/invites', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;

    const res = await pool.query<{
      id: string;
      code: string;
      max_uses: number;
      used_count: number;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
      created_by_name: string | null;
    }>(
      `SELECT wi.id, wi.code, wi.max_uses, wi.used_count, wi.expires_at, wi.revoked_at, wi.created_at,
              u.display_name AS created_by_name
         FROM workspace_invites wi
         LEFT JOIN users u ON u.id = wi.created_by
        WHERE wi.workspace_id = $1
        ORDER BY wi.created_at DESC`,
      [id],
    );
    const now = Date.now();
    return reply.send({
      ok: true,
      invites: res.rows.map((r) => ({
        id: r.id,
        code: r.code,
        maxUses: r.max_uses,
        usedCount: r.used_count,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        createdAt: r.created_at,
        createdByName: r.created_by_name,
        active:
          r.revoked_at === null &&
          r.used_count < r.max_uses &&
          (r.expires_at === null || new Date(r.expires_at).getTime() > now),
      })),
    });
  });

  // ── Invite codes: create (owner only, active workspaces) ────────────
  app.post('/api/workspaces/:id/invites', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const parsed = z
      .object({
        maxUses: z.number().int().min(1).max(500).default(1),
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;
    if (access.status === 'archived') {
      return reply.code(403).send({ ok: false, code: 'WORKSPACE_ARCHIVED', error: '该项目已归档（只读），无法创建邀请码。' });
    }

    const code = generateWorkspaceInviteCode();
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const res = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO workspace_invites (workspace_id, code, created_by, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [id, code, actorId, parsed.data.maxUses, expiresAt],
    );
    await writeWorkspaceEvent(access.orgId, id, actorId, 'workspace.invite_created', {
      by: 'project_owner',
      inviteId: res.rows[0].id,
      code,
      maxUses: parsed.data.maxUses,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
    return reply.code(201).send({
      ok: true,
      invite: {
        id: res.rows[0].id,
        code,
        maxUses: parsed.data.maxUses,
        usedCount: 0,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        revokedAt: null,
        createdAt: res.rows[0].created_at,
        active: true,
      },
    });
  });

  // ── Invite codes: revoke (owner only) ───────────────────────────────
  app.post('/api/workspaces/:id/invites/:inviteId/revoke', async (request, reply) => {
    const actorId = request.userId;
    if (!actorId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id, inviteId } = request.params as { id: string; inviteId: string };

    const access = await requireOwner(reply, id, actorId);
    if (!access) return;

    const res = await pool.query<{ code: string; revoked_at: string | null }>(
      `SELECT code, revoked_at FROM workspace_invites WHERE id = $1 AND workspace_id = $2`,
      [inviteId, id],
    );
    const invite = res.rows[0];
    if (!invite) return reply.code(404).send({ ok: false, code: 'INVITE_NOT_FOUND', error: '邀请码不存在。' });
    if (invite.revoked_at) return reply.send({ ok: true, revoked: false });

    await pool.query(`UPDATE workspace_invites SET revoked_at = now() WHERE id = $1`, [inviteId]);
    await writeWorkspaceEvent(access.orgId, id, actorId, 'workspace.invite_revoked', {
      by: 'project_owner',
      inviteId,
      code: invite.code,
    });
    return reply.send({ ok: true, revoked: true });
  });

  // ── Project overview for the management hub detail page ─────────────
  // Any member may view; mirrors the org governance detail but scoped to
  // what a project member should see (stats, recent versions, my role).
  app.get('/api/workspaces/:id/overview', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const access = await requireWorkspaceAccess(reply, id, userId, 'read');
    if (!access) return;

    const wsRes = await pool.query<{
      id: string;
      domain: string;
      name: string;
      description: string | null;
      status: string;
      visibility: string;
      created_by: string | null;
      owner_name: string | null;
      current_version_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT w.id, w.domain, w.name, w.description, w.status, w.visibility,
              w.created_by, w.current_version_id, w.created_at, w.updated_at,
              (SELECT u.display_name FROM workspace_members wm JOIN users u ON u.id = wm.user_id
                WHERE wm.workspace_id = w.id AND wm.role = 'owner' LIMIT 1) AS owner_name
         FROM workspaces w WHERE w.id = $1`,
      [id],
    );
    const ws = wsRes.rows[0];
    if (!ws) return reply.code(404).send({ ok: false, error: 'Workspace not found.' });

    const [stats, versions] = await Promise.all([
      ws.current_version_id
        ? pool.query<{ file_count: number; total_bytes: string | null }>(
            `SELECT count(*)::int AS file_count, sum(size_bytes) AS total_bytes
               FROM (SELECT DISTINCT o.id, o.size_bytes
                       FROM version_entries ve
                       JOIN objects o ON o.id = ve.object_id
                      WHERE ve.version_id = $1
                        AND ve.entry_type = 'file'
                        AND ve.status = 'active') t`,
            [ws.current_version_id],
          )
        : Promise.resolve(null),
      pool.query<{
        id: string;
        version_number: number;
        type: string;
        label: string | null;
        message: string;
        author_name: string | null;
        created_at: string;
      }>(
        `SELECT v.id, v.version_number, v.type, v.label, v.message,
                u.display_name AS author_name, v.created_at
           FROM versions v
           LEFT JOIN users u ON u.id = v.author_id
          WHERE v.workspace_id = $1
          ORDER BY v.version_number DESC
          LIMIT 10`,
        [id],
      ),
    ]);

    return reply.send({
      ok: true,
      workspace: {
        id: ws.id,
        domain: ws.domain,
        name: ws.name,
        description: ws.description,
        status: ws.status,
        visibility: ws.visibility,
        ownerName: ws.owner_name,
        createdBy: ws.created_by,
        createdAt: ws.created_at,
        updatedAt: ws.updated_at,
      },
      myRole: access.role,
      stats: {
        fileCount: stats?.rows[0]?.file_count ?? 0,
        totalBytes: stats?.rows[0]?.total_bytes ? Number(stats.rows[0].total_bytes) : 0,
      },
      recentVersions: versions.rows.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        type: v.type,
        label: v.label,
        message: v.message,
        authorName: v.author_name,
        createdAt: v.created_at,
      })),
    });
  });
}
