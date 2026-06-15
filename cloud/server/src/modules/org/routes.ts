// H2 Enterprise Admin API: org info, member management, invite management.
//
// The auth middleware (H1) already re-validates user/member/org status per
// request and decorates `request.orgRole`, so handlers only need role gating
// and input validation. Actor-vs-target rules live in service.ts.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  OrgError,
  getOrgInfo,
  listMembers,
  setMemberRole,
  setMemberStatus,
  listInvites,
  createInvite,
  revokeInvite,
  listOrgWorkspaces,
  getOrgWorkspaceDetail,
  setWorkspaceStatus,
  transferWorkspaceOwner,
  removeWorkspaceMember,
  getOrgStats,
  listOrgEvents,
} from './service.js';

const eventsQuerySchema = z.object({
  type: z.string().min(1).max(100).optional(),
  actor: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  skillId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
  before: z.string().datetime().optional(),
});

const roleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const inviteSchema = z.object({
  role: z.enum(['admin', 'member']).default('member'),
  maxUses: z.number().int().positive().max(10000).default(10),
  expiresDays: z.number().int().positive().max(3650).nullable().optional(),
});

type OrgRole = 'owner' | 'admin' | 'member';

interface OrgContext {
  orgId: string;
  userId: string;
  orgRole: OrgRole;
}

/** Resolve the caller's org context; `minRole` gates admin-only endpoints. */
function requireOrgContext(
  request: FastifyRequest,
  reply: FastifyReply,
  minRole: 'member' | 'admin',
): OrgContext | null {
  if (!request.userId) {
    reply.code(401).send({ ok: false, code: 'UNAUTHENTICATED', error: 'Unauthenticated.' });
    return null;
  }
  if (!request.orgId || !request.orgRole) {
    reply.code(403).send({ ok: false, code: 'NO_ORG', error: '账号未关联任何组织。' });
    return null;
  }
  const role = request.orgRole as OrgRole;
  if (minRole === 'admin' && role !== 'owner' && role !== 'admin') {
    reply.code(403).send({ ok: false, code: 'ORG_FORBIDDEN', error: '需要企业管理员权限。' });
    return null;
  }
  return { orgId: request.orgId, userId: request.userId, orgRole: role };
}

function sendOrgError(reply: FastifyReply, err: unknown) {
  if (err instanceof OrgError) {
    return reply.code(err.statusCode).send({ ok: false, code: err.code, error: err.message });
  }
  throw err;
}

export async function registerOrgRoutes(app: FastifyInstance) {
  // ── Org info (any member; feeds the console header) ────────────────
  app.get('/api/org', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'member');
    if (!ctx) return;
    try {
      const org = await getOrgInfo(ctx.orgId);
      return { ok: true, org, myRole: ctx.orgRole };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  // ── H7: Enterprise stats & audit (owner/admin) ─────────────────────
  app.get('/api/org/stats', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    try {
      const stats = await getOrgStats(ctx.orgId);
      return { ok: true, stats };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  app.get('/api/org/events', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const parsed = eventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid query', details: parsed.error.flatten() });
    }
    try {
      const result = await listOrgEvents(ctx.orgId, {
        type: parsed.data.type,
        actorId: parsed.data.actor,
        workspaceId: parsed.data.workspaceId,
        skillId: parsed.data.skillId,
        templateId: parsed.data.templateId,
        limit: parsed.data.limit,
        before: parsed.data.before,
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  // ── Members ─────────────────────────────────────────────────────────
  app.get('/api/org/members', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    return { ok: true, members: await listMembers(ctx.orgId) };
  });

  app.post('/api/org/members/:userId/role', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { userId: targetUserId } = request.params as { userId: string };
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const result = await setMemberRole({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorRole: ctx.orgRole,
        targetUserId,
        role: parsed.data.role,
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  app.post('/api/org/members/:userId/disable', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { userId: targetUserId } = request.params as { userId: string };
    try {
      const result = await setMemberStatus({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorRole: ctx.orgRole,
        targetUserId,
        status: 'disabled',
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  app.post('/api/org/members/:userId/restore', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { userId: targetUserId } = request.params as { userId: string };
    try {
      const result = await setMemberStatus({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorRole: ctx.orgRole,
        targetUserId,
        status: 'active',
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  // ── Invites ─────────────────────────────────────────────────────────
  app.get('/api/org/invites', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    return { ok: true, invites: await listInvites(ctx.orgId) };
  });

  app.post('/api/org/invites', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const parsed = inviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const invite = await createInvite({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorRole: ctx.orgRole,
        role: parsed.data.role,
        maxUses: parsed.data.maxUses,
        expiresDays: parsed.data.expiresDays ?? null,
      });
      return reply.code(201).send({ ok: true, invite });
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  app.post('/api/org/invites/:id/revoke', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { id: inviteId } = request.params as { id: string };
    try {
      const result = await revokeInvite({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorRole: ctx.orgRole,
        inviteId,
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  // ── Workspace governance (H3, admin+) ───────────────────────────────
  app.get('/api/org/workspaces', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    return { ok: true, workspaces: await listOrgWorkspaces(ctx.orgId) };
  });

  app.get('/api/org/workspaces/:id', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { id } = request.params as { id: string };
    try {
      const detail = await getOrgWorkspaceDetail(ctx.orgId, id);
      return { ok: true, ...detail };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  for (const [action, status] of [
    ['archive', 'archived'],
    ['restore', 'active'],
    ['disable', 'disabled'],
  ] as const) {
    app.post(`/api/org/workspaces/:id/${action}`, async (request, reply) => {
      const ctx = requireOrgContext(request, reply, 'admin');
      if (!ctx) return;
      const { id } = request.params as { id: string };
      try {
        const result = await setWorkspaceStatus({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          workspaceId: id,
          status,
        });
        return { ok: true, ...result };
      } catch (err) {
        return sendOrgError(reply, err);
      }
    });
  }

  app.post('/api/org/workspaces/:id/transfer-owner', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { id } = request.params as { id: string };
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const result = await transferWorkspaceOwner({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        workspaceId: id,
        newOwnerId: parsed.data.userId,
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });

  app.post('/api/org/workspaces/:id/members/:userId/remove', async (request, reply) => {
    const ctx = requireOrgContext(request, reply, 'admin');
    if (!ctx) return;
    const { id, userId: targetUserId } = request.params as { id: string; userId: string };
    try {
      const result = await removeWorkspaceMember({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        workspaceId: id,
        targetUserId,
      });
      return { ok: true, ...result };
    } catch (err) {
      return sendOrgError(reply, err);
    }
  });
}
