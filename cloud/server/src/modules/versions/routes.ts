import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';

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
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const commitSchema = z.object({
  message: z.string().max(2000).optional(),
  entries: z.array(entrySchema).max(50000),
});

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

    const client = await pool.connect();
    try {
      // Workspace must exist and caller must be an editor/owner.
      const member = await client.query<{ role: string; org_id: string }>(
        `SELECT wm.role, w.org_id
           FROM workspace_members wm
           JOIN workspaces w ON w.id = wm.workspace_id
          WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [workspaceId, userId],
      );
      if (member.rowCount === 0) {
        return reply.code(403).send({ ok: false, error: 'Not a member of this workspace.' });
      }
      const { role, org_id: orgId } = member.rows[0];
      if (role === 'viewer') {
        return reply.code(403).send({ ok: false, error: 'Viewers cannot commit versions.' });
      }

      // Validate every file entry references an available object.
      const fileEntries = entries.filter(
        (e): e is Extract<typeof e, { entryType: 'file' }> => e.entryType === 'file',
      );
      const hashes = [...new Set(fileEntries.map((e) => e.sha256.toLowerCase()))];

      const objectMap = new Map<string, string>();
      if (hashes.length > 0) {
        const objs = await client.query<{ id: string; sha256: string }>(
          `SELECT id, sha256 FROM objects WHERE sha256 = ANY($1) AND status = 'available'`,
          [hashes],
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

      // Next version number (linear history).
      const maxRes = await client.query<{ max: number | null }>(
        `SELECT max(version_number) AS max FROM versions WHERE workspace_id = $1`,
        [workspaceId],
      );
      const nextNumber = (maxRes.rows[0].max ?? 0) + 1;

      // Parent = current version (if any).
      const wsRes = await client.query<{ current_version_id: string | null }>(
        `SELECT current_version_id FROM workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId],
      );
      const parentVersionId = wsRes.rows[0]?.current_version_id ?? null;

      const versionRes = await client.query<{ id: string }>(
        `INSERT INTO versions (workspace_id, parent_version_id, version_number, author_id, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [workspaceId, parentVersionId, nextNumber, userId, message ?? ''],
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
          await client.query(
            `INSERT INTO version_entries
               (version_id, workspace_id, path, name, entry_type, object_id, size_bytes, mime_type, mtime, metadata)
             VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8, $9::jsonb)`,
            [
              versionId,
              workspaceId,
              entry.path,
              entry.name,
              objectId,
              entry.sizeBytes ?? null,
              entry.mimeType ?? null,
              entry.mtime ?? null,
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
         VALUES ($1, $2, $3, 'version.committed', $4::jsonb)`,
        [
          orgId,
          workspaceId,
          userId,
          JSON.stringify({ versionId, versionNumber: nextNumber, entryCount: entries.length }),
        ],
      );

      await client.query('COMMIT');

      return reply.code(201).send({ ok: true, versionId, versionNumber: nextNumber });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });
}
