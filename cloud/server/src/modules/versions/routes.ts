import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';
import { ossConfigured } from '../../config/env.js';
import { getSignedGetUrl } from '../../infra/oss/ossClient.js';
import { requireWorkspaceAccess } from '../workspaces/access.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'sha256 must be 64 hex chars');

const entrySchema = z.discriminatedUnion('entryType', [
  z.object({
    entryType: z.literal('folder'),
    path: z.string().min(1),
    name: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    entryType: z.literal('file'),
    path: z.string().min(1),
    name: z.string().min(1),
    sha256: sha256Schema,
    sizeBytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().max(255).nullable().optional(),
    mtime: z.string().optional(),
    // C5 soft-delete: a file entry can carry a deletion mark. The blob/object
    // is still referenced (kept in OSS); only the entry is flagged removed.
    status: z.enum(['active', 'soft_deleted']).optional(),
    deletedAt: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const commitSchema = z.object({
  message: z.string().max(2000).optional(),
  // C5: daily syncs default to 'sync'; managers create 'milestone' snapshots.
  type: z.enum(['sync', 'milestone']).optional(),
  label: z.string().max(200).optional(),
  // C5 optimistic concurrency: the client tells us which version it diffed
  // against. If the workspace has moved on, we reject so the client pulls first.
  baseVersionId: z.string().uuid().nullable().optional(),
  entries: z.array(entrySchema).max(50000),
});

const promoteSchema = z.object({
  label: z.string().min(1).max(200),
});

const filePathQuerySchema = z.object({
  path: z.string().min(1),
});

const fileDownloadSchema = z.object({
  path: z.string().min(1),
});

const conflictEventSchema = z.object({
  versionId: z.string().uuid().nullable().optional(),
  versionNumber: z.number().int().positive().nullable().optional(),
  conflicts: z.array(z.object({
    path: z.string().min(1),
    conflictPath: z.string().min(1).optional(),
    kind: z.string().max(80).optional(),
    localSha: sha256Schema.nullable().optional(),
    cloudSha: sha256Schema.nullable().optional(),
    resolution: z.string().max(80).optional(),
  })).min(1).max(200),
});

function normalizeManifestPath(input: string): string {
  const trimmed = String(input || '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  return `/${trimmed.replace(/^\/+/, '')}`;
}

export async function registerVersionRoutes(app: FastifyInstance) {
  app.post('/api/workspaces/:id/versions', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });

    const { id: workspaceId } = request.params as { id: string };
    const parsed = commitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { message, entries } = parsed.data;
    const versionType = parsed.data.type ?? 'sync';
    const baseVersionId = parsed.data.baseVersionId;

    const client = await pool.connect();
    try {
      // Workspace must exist, caller must be an editor/owner, and the
      // workspace must be active (H3/A4: commits are write actions).
      const access = await requireWorkspaceAccess(reply, workspaceId, userId, 'write', client);
      if (!access) return;
      const { role, orgId } = access;
      if (role === 'viewer') {
        return reply.code(403).send({ ok: false, error: 'Viewers cannot commit versions.' });
      }
      // Only owners may create milestone snapshots directly.
      if (versionType === 'milestone' && role !== 'owner') {
        return reply.code(403).send({ ok: false, error: 'Only the owner can create milestone versions.' });
      }

      // Validate every *active* file entry references an available object.
      // Soft-deleted entries still reference an object, so include them too.
      const fileEntries = entries.filter(
        (e): e is Extract<typeof e, { entryType: 'file' }> => e.entryType === 'file',
      );
      const hashes = [...new Set(fileEntries.map((e) => e.sha256.toLowerCase()))];

      const objectMap = new Map<string, string>();
      if (hashes.length > 0) {
        // H1 (audit A5): objects are org-scoped — a manifest may only
        // reference blobs that belong to this workspace's org.
        const objs = await client.query<{ id: string; sha256: string }>(
          `SELECT id, sha256 FROM objects WHERE org_id = $2 AND sha256 = ANY($1) AND status = 'available'`,
          [hashes, orgId],
        );
        for (const row of objs.rows) {
          objectMap.set(row.sha256.toLowerCase(), row.id);
        }
      }

      const missing = hashes.filter((h) => !objectMap.has(h));
      if (missing.length > 0) {
        return reply.code(409).send({
          ok: false,
          error: 'Some files are not uploaded yet.',
          missing,
        });
      }

      await client.query('BEGIN');

      // Lock the workspace row so concurrent commits serialize and the base
      // version check is race-free.
      const wsRes = await client.query<{ current_version_id: string | null }>(
        `SELECT current_version_id FROM workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId],
      );
      const parentVersionId = wsRes.rows[0]?.current_version_id ?? null;

      // C5 optimistic concurrency: reject when the client diffed against a stale
      // version. `baseVersionId === undefined` opts out (legacy publish flow).
      if (baseVersionId !== undefined && baseVersionId !== parentVersionId) {
        await client.query('ROLLBACK').catch(() => undefined);
        return reply.code(409).send({
          ok: false,
          error: 'Workspace has newer changes. Pull before committing.',
          code: 'REMOTE_AHEAD',
          currentVersionId: parentVersionId,
        });
      }

      // Next version number (linear history).
      const maxRes = await client.query<{ max: number | null }>(
        `SELECT max(version_number) AS max FROM versions WHERE workspace_id = $1`,
        [workspaceId],
      );
      const nextNumber = (maxRes.rows[0].max ?? 0) + 1;

      const versionRes = await client.query<{ id: string }>(
        `INSERT INTO versions (workspace_id, parent_version_id, version_number, author_id, message, type, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          workspaceId,
          parentVersionId,
          nextNumber,
          userId,
          message ?? '',
          versionType,
          parsed.data.label ?? null,
        ],
      );
      const versionId = versionRes.rows[0].id;

      // Insert entries.
      for (const entry of entries) {
        if (entry.entryType === 'folder') {
          await client.query(
            `INSERT INTO version_entries
               (version_id, workspace_id, path, name, entry_type, metadata)
             VALUES ($1, $2, $3, $4, 'folder', $5::jsonb)`,
            [versionId, workspaceId, entry.path, entry.name, JSON.stringify(entry.metadata ?? {})],
          );
        } else {
          const objectId = objectMap.get(entry.sha256.toLowerCase())!;
          const status = entry.status ?? 'active';
          const isDeleted = status === 'soft_deleted';
          await client.query(
            `INSERT INTO version_entries
               (version_id, workspace_id, path, name, entry_type, object_id, size_bytes,
                mime_type, mtime, status, deleted_by, deleted_at, metadata)
             VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
            [
              versionId,
              workspaceId,
              entry.path,
              entry.name,
              objectId,
              entry.sizeBytes ?? null,
              entry.mimeType ?? null,
              entry.mtime ?? null,
              status,
              isDeleted ? userId : null,
              isDeleted ? (entry.deletedAt ?? new Date().toISOString()) : null,
              JSON.stringify(entry.metadata ?? {}),
            ],
          );
        }
      }

      await client.query(
        `UPDATE workspaces SET current_version_id = $1, updated_at = now() WHERE id = $2`,
        [versionId, workspaceId],
      );

      await client.query(
        `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          orgId,
          workspaceId,
          userId,
          versionType === 'milestone' ? 'version.milestone' : 'version.committed',
          JSON.stringify({
            versionId,
            versionNumber: nextNumber,
            entryCount: entries.length,
            type: versionType,
            label: parsed.data.label ?? null,
          }),
        ],
      );

      await client.query('COMMIT');

      return reply.code(201).send({
        ok: true,
        versionId,
        versionNumber: nextNumber,
        type: versionType,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  // ── List versions (C5) ─────────────────────────────────────────────
  // `?type=milestone` filters to named snapshots. Returns newest first.
  app.get('/api/workspaces/:id/versions', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id: workspaceId } = request.params as { id: string };
    const { type } = request.query as { type?: string };

    // H3 (A4): read action — version history stays readable when archived.
    const access = await requireWorkspaceAccess(reply, workspaceId, userId, 'read');
    if (!access) return;

    const filterMilestone = type === 'milestone';
    const rows = await pool.query<{
      id: string;
      version_number: number;
      type: string;
      label: string | null;
      message: string;
      author_id: string | null;
      author_name: string | null;
      created_at: string;
      entry_count: number;
    }>(
      `SELECT v.id, v.version_number, v.type, v.label, v.message,
              v.author_id, u.display_name AS author_name, v.created_at,
              (SELECT count(*)::int FROM version_entries ve WHERE ve.version_id = v.id) AS entry_count
         FROM versions v
         LEFT JOIN users u ON u.id = v.author_id
        WHERE v.workspace_id = $1 ${filterMilestone ? `AND v.type = 'milestone'` : ''}
        ORDER BY v.version_number DESC`,
      [workspaceId],
    );

    return reply.send({
      ok: true,
      versions: rows.rows.map((r) => ({
        id: r.id,
        versionNumber: r.version_number,
        type: r.type,
        label: r.label,
        message: r.message,
        authorId: r.author_id,
        authorName: r.author_name,
        createdAt: r.created_at,
        entryCount: r.entry_count,
      })),
    });
  });

  // ── File history for single-file restore (C6) ─────────────────────
  app.get('/api/workspaces/:id/file-history', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id: workspaceId } = request.params as { id: string };
    const parsed = filePathQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid query', details: parsed.error.flatten() });
    }

    const access = await requireWorkspaceAccess(reply, workspaceId, userId, 'read');
    if (!access) return;

    const filePath = normalizeManifestPath(parsed.data.path);
    const rows = await pool.query<{
      version_id: string;
      version_number: number;
      type: string;
      label: string | null;
      message: string;
      author_id: string | null;
      author_name: string | null;
      created_at: string;
      status: string;
      deleted_at: string | null;
      sha256: string | null;
      size_bytes: string | number | null;
      mime_type: string | null;
      mtime: string | null;
    }>(
      `SELECT v.id AS version_id, v.version_number, v.type, v.label, v.message,
              v.author_id, u.display_name AS author_name, v.created_at,
              ve.status, ve.deleted_at, o.sha256, ve.size_bytes, ve.mime_type, ve.mtime
         FROM version_entries ve
         JOIN versions v ON v.id = ve.version_id
         LEFT JOIN objects o ON o.id = ve.object_id
         LEFT JOIN users u ON u.id = v.author_id
        WHERE ve.workspace_id = $1
          AND ve.path = $2
          AND ve.entry_type = 'file'
        ORDER BY v.version_number DESC`,
      [workspaceId, filePath],
    );

    return reply.send({
      ok: true,
      path: filePath,
      history: rows.rows.map((r) => ({
        versionId: r.version_id,
        versionNumber: r.version_number,
        type: r.type,
        label: r.label,
        message: r.message,
        authorId: r.author_id,
        authorName: r.author_name,
        createdAt: r.created_at,
        status: r.status,
        deletedAt: r.deleted_at,
        sha256: r.sha256,
        sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
        mimeType: r.mime_type,
        mtime: r.mtime,
        restorable: r.status !== 'soft_deleted' && Boolean(r.sha256),
      })),
    });
  });

  // ── Signed download URL for one file in one version (C6) ──────────
  app.post('/api/workspaces/:id/versions/:vid/file-download', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!ossConfigured) return reply.code(503).send({ ok: false, error: 'OSS is not configured on the server.' });

    const { id: workspaceId, vid: versionId } = request.params as { id: string; vid: string };
    const parsed = fileDownloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const access = await requireWorkspaceAccess(reply, workspaceId, userId, 'read');
    if (!access) return;

    const filePath = normalizeManifestPath(parsed.data.path);
    const row = await pool.query<{
      path: string;
      name: string;
      status: string;
      sha256: string;
      size_bytes: string | number | null;
      mime_type: string | null;
      storage_key: string | null;
    }>(
      `SELECT ve.path, ve.name, ve.status, o.sha256, ve.size_bytes, ve.mime_type, o.storage_key
         FROM version_entries ve
         JOIN versions v ON v.id = ve.version_id AND v.workspace_id = ve.workspace_id
         LEFT JOIN objects o ON o.id = ve.object_id
        WHERE ve.workspace_id = $1
          AND ve.version_id = $2
          AND ve.path = $3
          AND ve.entry_type = 'file'`,
      [workspaceId, versionId, filePath],
    );
    if (row.rowCount === 0) return reply.code(404).send({ ok: false, error: 'File not found in this version.' });

    const file = row.rows[0];
    if (file.status === 'soft_deleted') {
      return reply.code(409).send({ ok: false, error: 'This file is marked as deleted in the selected version.' });
    }
    if (!file.storage_key) return reply.code(409).send({ ok: false, error: 'File object is unavailable.' });

    return reply.send({
      ok: true,
      path: file.path,
      name: file.name,
      sha256: file.sha256,
      sizeBytes: file.size_bytes === null ? null : Number(file.size_bytes),
      mimeType: file.mime_type,
      downloadUrl: getSignedGetUrl(file.storage_key),
    });
  });

  // ── Conflict audit event (C6) ─────────────────────────────────────
  app.post('/api/workspaces/:id/conflict-events', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id: workspaceId } = request.params as { id: string };
    const parsed = conflictEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    // H3 (A4): conflicts only arise from active sync flows — write action.
    const access = await requireWorkspaceAccess(reply, workspaceId, userId, 'write');
    if (!access) return;

    await pool.query(
      `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
       VALUES ($1, $2, $3, 'version.conflict_auto_kept_both', $4::jsonb)`,
      [
        access.orgId,
        workspaceId,
        userId,
        JSON.stringify({
          versionId: parsed.data.versionId ?? null,
          versionNumber: parsed.data.versionNumber ?? null,
          conflicts: parsed.data.conflicts,
        }),
      ],
    );

    return reply.send({ ok: true, count: parsed.data.conflicts.length });
  });

  // ── Promote a sync version to a milestone (C5, owner only) ──────────
  app.post('/api/workspaces/:id/versions/:vid/promote', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const { id: workspaceId, vid: versionId } = request.params as { id: string; vid: string };

    const parsed = promoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    // H3 (A4): promoting is a write action — active workspaces only.
    const access = await requireWorkspaceAccess(reply, workspaceId, userId, 'write');
    if (!access) return;
    if (access.role !== 'owner') {
      return reply.code(403).send({ ok: false, error: 'Only the owner can create milestone versions.' });
    }

    const upd = await pool.query<{ id: string; version_number: number }>(
      `UPDATE versions SET type = 'milestone', label = $3
        WHERE id = $1 AND workspace_id = $2
        RETURNING id, version_number`,
      [versionId, workspaceId, parsed.data.label],
    );
    if (upd.rowCount === 0) {
      return reply.code(404).send({ ok: false, error: 'Version not found.' });
    }

    await pool.query(
      `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
       VALUES ($1, $2, $3, 'version.milestone', $4::jsonb)`,
      [
        access.orgId,
        workspaceId,
        userId,
        JSON.stringify({ versionId, versionNumber: upd.rows[0].version_number, label: parsed.data.label }),
      ],
    );

    return reply.send({ ok: true, versionId, versionNumber: upd.rows[0].version_number });
  });
}
