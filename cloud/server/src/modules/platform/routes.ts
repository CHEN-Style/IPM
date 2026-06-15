// H1 Platform Super Admin API.
//
// All routes live under `/api/platform/**`. The auth middleware already
// rejects every caller who is not in `platform_admins` (per-request lookup),
// so handlers here only do input validation and business logic.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PlatformError,
  listOrgs,
  getOrgDetail,
  createOrg,
  setOrgStatus,
  assignOwner,
  createInvite,
  listPlatformAdmins,
  listPlatformEvents,
  getPlatformStats,
} from './service.js';

const eventsQuerySchema = z.object({
  type: z.string().min(1).max(100).optional(),
  orgId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
  before: z.string().datetime().optional(),
});

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  plan: z.string().min(1).max(40).optional(),
  ownerEmail: z.string().email().max(255).optional(),
  createOwnerInvite: z.boolean().optional(),
});

const ownerSchema = z.object({
  email: z.string().email().max(255),
});

const inviteSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']).optional(),
  maxUses: z.number().int().positive().max(10000).optional(),
  expiresDays: z.number().int().positive().max(3650).optional(),
});

function sendPlatformError(reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof PlatformError) {
    return reply.code(err.statusCode).send({ ok: false, code: err.code, error: err.message });
  }
  throw err;
}

export async function registerPlatformRoutes(app: FastifyInstance) {
  app.get('/api/platform/orgs', async () => {
    return { ok: true, orgs: await listOrgs() };
  });

  app.post('/api/platform/orgs', async (request, reply) => {
    const parsed = createOrgSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const org = await createOrg({
        name: parsed.data.name,
        slug: parsed.data.slug,
        plan: parsed.data.plan,
        actorId: request.userId,
      });

      let owner = null;
      if (parsed.data.ownerEmail) {
        owner = await assignOwner({ orgId: org.orgId, email: parsed.data.ownerEmail, actorId: request.userId });
      }
      let ownerInvite = null;
      if (parsed.data.createOwnerInvite) {
        ownerInvite = await createInvite({
          orgId: org.orgId,
          role: 'owner',
          maxUses: 1,
          expiresDays: 30,
          actorId: request.userId,
        });
      }
      return reply.code(201).send({ ok: true, org, owner, ownerInvite });
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.get('/api/platform/orgs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { ok: true, org: await getOrgDetail(id) };
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.post('/api/platform/orgs/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const org = await setOrgStatus({ orgId: id, status: 'disabled', actorId: request.userId });
      return { ok: true, org };
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.post('/api/platform/orgs/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const org = await setOrgStatus({ orgId: id, status: 'active', actorId: request.userId });
      return { ok: true, org };
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.post('/api/platform/orgs/:id/owner', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ownerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const owner = await assignOwner({ orgId: id, email: parsed.data.email, actorId: request.userId });
      return { ok: true, owner };
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.post('/api/platform/orgs/:id/invites', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = inviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    try {
      const invite = await createInvite({
        orgId: id,
        role: parsed.data.role,
        maxUses: parsed.data.maxUses,
        expiresDays: parsed.data.expiresDays ?? null,
        actorId: request.userId,
      });
      return reply.code(201).send({ ok: true, invite });
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  // Read-only: grant/revoke is deliberately CLI-only (server shell access
  // required) so the API surface cannot be used for privilege escalation.
  app.get('/api/platform/admins', async () => {
    return { ok: true, admins: await listPlatformAdmins() };
  });

  // ── H7: platform stats & audit ─────────────────────────────────────
  app.get('/api/platform/stats', async () => {
    return { ok: true, stats: await getPlatformStats() };
  });

  app.get('/api/platform/events', async (request, reply) => {
    const parsed = eventsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid query', details: parsed.error.flatten() });
    }
    const result = await listPlatformEvents({
      type: parsed.data.type,
      orgId: parsed.data.orgId,
      limit: parsed.data.limit,
      before: parsed.data.before,
    });
    return { ok: true, ...result };
  });
}
