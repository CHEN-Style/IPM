import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';

const createWorkspaceSchema = z.object({
  orgId: z.string().uuid().optional(),
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

interface VersionEntryRow {
  path: string;
  name: string;
  entry_type: string;
  sha256: string | null;
  size_bytes: string | null;
  mime_type: string | null;
  mtime: string | null;
  status: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_at: string | null;
  metadata: Record<string, unknown>;
}

const foldersSchema = z.object({
  folders: z.array(z.string().min(1)).max(50000),
});

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  // ── List workspaces in the caller's org (C4 browse) ────────────────
  // Returns every workspace in the org with the caller's role (or null when
  // they have not joined) and the member count, so the desktop can show a
  // "join / pull / open" affordance per project.
  app.get('/api/workspaces', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const result = await pool.query(
      `SELECT w.id, w.domain, w.name, w.description, w.status,
              w.current_version_id, w.created_by, w.created_at, w.updated_at,
              (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
              (SELECT role FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = $2) AS my_role,
              (SELECT version_number FROM versions v WHERE v.id = w.current_version_id) AS current_version_number
         FROM workspaces w
        WHERE w.org_id = $1 AND w.status = 'active'
        ORDER BY w.updated_at DESC`,
      [orgId, userId],
    );

    return reply.send({
      ok: true,
      workspaces: result.rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        name: r.name,
        description: r.description,
        memberCount: r.member_count,
        myRole: r.my_role,
        currentVersionId: r.current_version_id,
        currentVersionNumber: r.current_version_number,
        createdBy: r.created_by,
        updatedAt: r.updated_at,
      })),
    });
  });

  // ── Join a workspace in the caller's org (C4) ──────────────────────
  // Any org member may join an org workspace as an editor (invite codes are
  // the trust boundary; org members are already trusted). Idempotent.
  app.post('/api/workspaces/:id/join', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const wsRes = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM workspaces WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (wsRes.rowCount === 0) {
      return reply.code(404).send({ ok: false, error: 'Workspace not found.' });
    }
    if (wsRes.rows[0].org_id !== orgId) {
      return reply.code(403).send({ ok: false, error: 'Workspace belongs to another org.' });
    }

    const existing = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return reply.send({ ok: true, role: existing.rows[0].role, alreadyMember: true });
    }

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'editor')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [id, userId],
    );
    await pool.query(
      `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
       VALUES ($1, $2, $3, 'workspace.joined', '{}'::jsonb)`,
      [orgId, id, userId],
    );

    return reply.send({ ok: true, role: 'editor', alreadyMember: false });
  });

  // ── Latest version manifest (C4 pull) ──────────────────────────────
  app.get('/api/workspaces/:id/versions/latest', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const member = await pool.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (member.rowCount === 0) {
      return reply.code(403).send({ ok: false, error: 'Not a member of this workspace.' });
    }

    const wsRes = await pool.query<WorkspaceRow>(
      `SELECT * FROM workspaces WHERE id = $1`,
      [id],
    );
    const workspace = wsRes.rows[0];
    if (!workspace) return reply.code(404).send({ ok: false, error: 'Workspace not found.' });
    if (!workspace.current_version_id) {
      return reply.send({ ok: true, workspace: { id: workspace.id, name: workspace.name, domain: workspace.domain }, version: null, entries: [] });
    }

    const versionRes = await pool.query<{
      id: string;
      version_number: number;
      message: string;
      created_at: string;
      type: string;
      label: string | null;
    }>(
      `SELECT id, version_number, message, created_at, type, label FROM versions WHERE id = $1`,
      [workspace.current_version_id],
    );
    const version = versionRes.rows[0];

    const entriesRes = await pool.query<VersionEntryRow>(
      `SELECT ve.path, ve.name, ve.entry_type, ve.size_bytes, ve.mime_type, ve.mtime,
              ve.status, ve.deleted_by, ve.deleted_at, ve.metadata, o.sha256,
              du.display_name AS deleted_by_name
         FROM version_entries ve
         LEFT JOIN objects o ON o.id = ve.object_id
         LEFT JOIN users du ON du.id = ve.deleted_by
        WHERE ve.version_id = $1
        ORDER BY ve.path`,
      [workspace.current_version_id],
    );

    return reply.send({
      ok: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        domain: workspace.domain,
        description: workspace.description,
      },
      version: {
        id: version.id,
        versionNumber: version.version_number,
        message: version.message,
        createdAt: version.created_at,
        type: version.type,
        label: version.label,
      },
      entries: entriesRes.rows.map((r) => ({
        path: r.path,
        name: r.name,
        entryType: r.entry_type,
        sha256: r.sha256,
        sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
        mimeType: r.mime_type,
        mtime: r.mtime,
        status: r.status,
        deletedBy: r.deleted_by,
        deletedByName: r.deleted_by_name,
        deletedAt: r.deleted_at,
        metadata: r.metadata,
      })),
    });
  });

  // ── Lightweight sync-status check (C5) ──────────────────────────────
  // The client compares its local lastSyncedVersionId against the returned
  // currentVersionId to know if the cloud has moved ahead. No entries fetched.
  app.get('/api/workspaces/:id/sync-status', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const member = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (member.rowCount === 0) {
      return reply.code(403).send({ ok: false, error: 'Not a member of this workspace.' });
    }

    const res = await pool.query<{
      current_version_id: string | null;
      updated_at: string;
      current_version_number: number | null;
    }>(
      `SELECT w.current_version_id, w.updated_at,
              (SELECT version_number FROM versions v WHERE v.id = w.current_version_id) AS current_version_number
         FROM workspaces w WHERE w.id = $1`,
      [id],
    );
    if (res.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Workspace not found.' });

    return reply.send({
      ok: true,
      currentVersionId: res.rows[0].current_version_id,
      currentVersionNumber: res.rows[0].current_version_number,
      updatedAt: res.rows[0].updated_at,
      myRole: member.rows[0].role,
    });
  });

  // ── Canonical folder structure (C5) ─────────────────────────────────
  // GET: any member reads the protected folder set (used to validate that a
  //      locally-added file lands under an existing folder before pushing).
  app.get('/api/workspaces/:id/folders', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const member = await pool.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (member.rowCount === 0) {
      return reply.code(403).send({ ok: false, error: 'Not a member of this workspace.' });
    }

    const rows = await pool.query<{ path: string }>(
      `SELECT path FROM workspace_folders WHERE workspace_id = $1 ORDER BY path`,
      [id],
    );
    return reply.send({ ok: true, folders: rows.rows.map((r) => r.path) });
  });

  // POST: only owners may change the canonical folder set. Full replace; the
  //       client computes the desired set (existing + intended new folders).
  app.post('/api/workspaces/:id/folders', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const parsed = foldersSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const member = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (member.rowCount === 0) {
      return reply.code(403).send({ ok: false, error: 'Not a member of this workspace.' });
    }
    if (member.rows[0].role !== 'owner') {
      return reply.code(403).send({ ok: false, error: 'Only the owner can change folder structure.' });
    }

    const folders = [...new Set(parsed.data.folders.map((f) => f.trim()).filter(Boolean))];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM workspace_folders WHERE workspace_id = $1`, [id]);
      for (const folderPath of folders) {
        await client.query(
          `INSERT INTO workspace_folders (workspace_id, path, created_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, path) DO NOTHING`,
          [id, folderPath, userId],
        );
      }
      await client.query('COMMIT');
      return reply.send({ ok: true, count: folders.length });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  app.post('/api/workspaces', async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    }

    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { name, domain, description } = parsed.data;
    // Prefer the orgId from JWT over the body — ensures the workspace is
    // created under the caller's real org even if the body omits it.
    const orgId = request.orgId || parsed.data.orgId;
    if (!orgId) {
      return reply.code(400).send({ ok: false, error: 'Missing orgId (not in token or body).' });
    }

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
