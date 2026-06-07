import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';

const createWorkspaceSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(200),
  domain: z.enum(['projects', 'cases', 'study']),
  description: z.string().max(2000).optional(),
});

interface WorkspaceRow {
  id: string;
  org_id: string;
  domain: string;
  name: string;
  description: string | null;
  status: string;
  created_by: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.post('/api/workspaces', async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    }

    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { orgId, name, domain, description } = parsed.data;

    const client = await pool.connect();
    try {
      // Caller must belong to the org.
      const membership = await client.query(
        `SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
        [orgId, userId],
      );
      if (membership.rowCount === 0) {
        return reply.code(403).send({ ok: false, error: 'Not a member of this org.' });
      }

      await client.query('BEGIN');

      const ws = await client.query<WorkspaceRow>(
        `INSERT INTO workspaces (org_id, domain, name, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [orgId, domain, name, description ?? null, userId],
      );
      const workspace = ws.rows[0];

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspace.id, userId],
      );

      await client.query(
        `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
         VALUES ($1, $2, $3, 'workspace.created', $4::jsonb)`,
        [orgId, workspace.id, userId, JSON.stringify({ name, domain })],
      );

      await client.query('COMMIT');

      return reply.code(201).send({ ok: true, workspace });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  app.get('/api/workspaces/:id', async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    }
    const { id } = request.params as { id: string };

    const result = await pool.query<WorkspaceRow>(
      `SELECT * FROM workspaces WHERE id = $1`,
      [id],
    );
    const workspace = result.rows[0];
    if (!workspace) {
      return reply.code(404).send({ ok: false, error: 'Workspace not found.' });
    }

    // Membership check.
    const member = await pool.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (member.rowCount === 0) {
      return reply.code(403).send({ ok: false, error: 'Not a member of this workspace.' });
    }

    return reply.send({ ok: true, workspace });
  });
}
