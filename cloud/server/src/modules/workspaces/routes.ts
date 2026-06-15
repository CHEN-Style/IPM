import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';
import { requireWorkspaceAccess } from './access.js';

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
  // ── List my workspaces (H4) ─────────────────────────────────────────
  // Returns only the workspaces the caller is a member of (created or
  // joined). Privacy-first: non-member workspaces never appear here — the
  // discoverable subset lives under /api/workspaces/public.
  app.get('/api/workspaces', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    // H3 (A4): archived workspaces stay visible (read-only, marked by
    // `status`); disabled workspaces are hidden from member-facing lists.
    const result = await pool.query(
      `SELECT w.id, w.domain, w.name, w.description, w.status, w.visibility,
              w.current_version_id, w.created_by, w.created_at, w.updated_at,
              wm.role AS my_role,
              cu.display_name AS owner_name,
              (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
              (SELECT version_number FROM versions v WHERE v.id = w.current_version_id) AS current_version_number
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         LEFT JOIN users cu ON cu.id = w.created_by
        WHERE wm.user_id = $2 AND w.org_id = $1 AND w.status IN ('active', 'archived')
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
        status: r.status,
        visibility: r.visibility,
        memberCount: r.member_count,
        myRole: r.my_role,
        currentVersionId: r.current_version_id,
        currentVersionNumber: r.current_version_number,
        createdBy: r.created_by,
        ownerName: r.owner_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  // ── Discover public workspaces in my org (H4) ───────────────────────
  // Only owner-published (`visibility = 'public'`) active workspaces are
  // discoverable. `isMember` lets the UI swap the join button for "已加入".
  app.get('/api/workspaces/public', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const result = await pool.query(
      `SELECT w.id, w.domain, w.name, w.description, w.updated_at,
              cu.display_name AS owner_name,
              (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
              (SELECT version_number FROM versions v WHERE v.id = w.current_version_id) AS current_version_number,
              (SELECT role FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = $2) AS my_role
         FROM workspaces w
         LEFT JOIN users cu ON cu.id = w.created_by
        WHERE w.org_id = $1 AND w.visibility = 'public' AND w.status = 'active'
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
        ownerName: r.owner_name,
        memberCount: r.member_count,
        currentVersionNumber: r.current_version_number,
        isMember: r.my_role !== null,
        myRole: r.my_role,
        updatedAt: r.updated_at,
      })),
    });
  });

  // ── Self-join a public workspace (H4) ───────────────────────────────
  // Only public+active workspaces accept self-joins, and the granted role is
  // read-only `viewer` — the owner promotes collaborators manually. Private
  // workspaces answer 404 to non-members so their existence stays hidden.
  app.post('/api/workspaces/:id/join', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const wsRes = await pool.query<{ org_id: string; status: string; visibility: string }>(
      `SELECT org_id, status, visibility FROM workspaces WHERE id = $1`,
      [id],
    );
    const ws = wsRes.rows[0];
    // Hide existence from anything the caller is not allowed to discover:
    // missing, cross-org, disabled, or private (non-members only — members
    // hit the idempotent early-return below before visibility matters).
    const hidden = !ws || ws.org_id !== orgId || ws.status === 'disabled';

    const existing = await pool.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (!hidden && existing.rowCount && existing.rowCount > 0) {
      return reply.send({ ok: true, role: existing.rows[0].role, alreadyMember: true });
    }
    if (hidden || ws.visibility !== 'public') {
      return reply.code(404).send({ ok: false, error: 'Workspace not found.' });
    }
    if (ws.status === 'archived') {
      return reply.code(403).send({ ok: false, code: 'WORKSPACE_ARCHIVED', error: '该项目已归档（只读），无法加入。' });
    }

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'viewer')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [id, userId],
    );
    await pool.query(
      `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
       VALUES ($1, $2, $3, 'workspace.joined', $4::jsonb)`,
      [orgId, id, userId, JSON.stringify({ via: 'public', role: 'viewer' })],
    );

    return reply.send({ ok: true, role: 'viewer', alreadyMember: false });
  });

  // ── Join a workspace by invite code (H4) ────────────────────────────
  // The invite code itself is the trust credential, so joining grants
  // `editor` (collaboration) directly. Codes can be revoked, expire, or run
  // out of uses; all three answer the same generic error so a code cannot be
  // probed for the workspace behind it.
  app.post('/api/workspaces/join-by-code', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const parsed = z.object({ code: z.string().min(1).max(64) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const code = parsed.data.code.trim().toUpperCase();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invRes = await client.query<{
        id: string;
        workspace_id: string;
        max_uses: number;
        used_count: number;
        expires_at: string | null;
        revoked_at: string | null;
        org_id: string;
        status: string;
        ws_name: string;
      }>(
        `SELECT wi.id, wi.workspace_id, wi.max_uses, wi.used_count, wi.expires_at, wi.revoked_at,
                w.org_id, w.status, w.name AS ws_name
           FROM workspace_invites wi
           JOIN workspaces w ON w.id = wi.workspace_id
          WHERE wi.code = $1
          FOR UPDATE OF wi`,
        [code],
      );
      const inv = invRes.rows[0];

      const invalid =
        !inv ||
        inv.org_id !== orgId ||
        inv.revoked_at !== null ||
        (inv.expires_at !== null && new Date(inv.expires_at).getTime() <= Date.now()) ||
        inv.used_count >= inv.max_uses;
      if (invalid) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ ok: false, code: 'INVALID_INVITE', error: '邀请码无效或已失效。' });
      }
      if (inv.status === 'disabled') {
        await client.query('ROLLBACK');
        return reply.code(400).send({ ok: false, code: 'INVALID_INVITE', error: '邀请码无效或已失效。' });
      }
      if (inv.status === 'archived') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ ok: false, code: 'WORKSPACE_ARCHIVED', error: '该项目已归档（只读），无法加入。' });
      }

      const existing = await client.query<{ role: string }>(
        `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [inv.workspace_id, userId],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return reply.send({
          ok: true,
          workspaceId: inv.workspace_id,
          workspaceName: inv.ws_name,
          role: existing.rows[0].role,
          alreadyMember: true,
        });
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'editor')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [inv.workspace_id, userId],
      );
      await client.query(
        `UPDATE workspace_invites SET used_count = used_count + 1 WHERE id = $1`,
        [inv.id],
      );
      await client.query(
        `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
         VALUES ($1, $2, $3, 'workspace.joined', $4::jsonb)`,
        [orgId, inv.workspace_id, userId, JSON.stringify({ via: 'invite_code', role: 'editor', inviteId: inv.id })],
      );
      await client.query('COMMIT');

      return reply.send({
        ok: true,
        workspaceId: inv.workspace_id,
        workspaceName: inv.ws_name,
        role: 'editor',
        alreadyMember: false,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  // ── Latest version manifest (C4 pull) ──────────────────────────────
  // H3 (A4): read action — archived workspaces stay pullable.
  app.get('/api/workspaces/:id/versions/latest', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const access = await requireWorkspaceAccess(reply, id, userId, 'read');
    if (!access) return;

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

    // H3 (A4): read action — archived workspaces still report status (the
    // desktop uses it to render the read-only marker).
    const access = await requireWorkspaceAccess(reply, id, userId, 'read');
    if (!access) return;

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
      myRole: access.role,
      workspaceStatus: access.status,
    });
  });

  // ── Canonical folder structure (C5) ─────────────────────────────────
  // GET: any member reads the protected folder set (used to validate that a
  //      locally-added file lands under an existing folder before pushing).
  app.get('/api/workspaces/:id/folders', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id } = request.params as { id: string };

    const access = await requireWorkspaceAccess(reply, id, userId, 'read');
    if (!access) return;

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

    // H3 (A4): write action — archived/disabled workspaces reject changes.
    const access = await requireWorkspaceAccess(reply, id, userId, 'write');
    if (!access) return;
    if (access.role !== 'owner') {
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

    // H3 (A4): read action — membership + status gate in one query.
    const access = await requireWorkspaceAccess(reply, id, userId, 'read');
    if (!access) return;

    const result = await pool.query<WorkspaceRow>(
      `SELECT * FROM workspaces WHERE id = $1`,
      [id],
    );
    const workspace = result.rows[0];
    if (!workspace) {
      return reply.code(404).send({ ok: false, error: 'Workspace not found.' });
    }

    return reply.send({ ok: true, workspace });
  });
}
