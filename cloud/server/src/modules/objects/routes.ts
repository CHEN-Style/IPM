// Object (blob) endpoints, org-scoped since H1 (audit A5/A11).
//
// Security model:
//   * The org is the trust boundary. All four endpoints resolve the caller's
//     org from the JWT (`request.orgId`) and never see other orgs' rows.
//   * Dedup is per org: `UNIQUE(org_id, sha256)`. Cross-org dedup was dropped
//     deliberately — knowing a sha256 must not grant access to content.
//   * PUT URLs are only issued for rows in `pending` state (A11). Once an
//     object is `available` its blob can never be overwritten via the API.
//   * New uploads use org-scoped storage keys; legacy rows keep their
//     original `storage_key` (the column is authoritative for reads).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';
import { env, ossConfigured } from '../../config/env.js';
import { getSignedPutUrl, getSignedGetUrl } from '../../infra/oss/ossClient.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'sha256 must be 64 hex chars');

const checkSchema = z.object({
  hashes: z.array(sha256Schema).min(1).max(2000),
});

const uploadUrlsSchema = z.object({
  files: z
    .array(
      z.object({
        sha256: sha256Schema,
        sizeBytes: z.number().int().nonnegative(),
        mimeType: z.string().max(255).optional(),
      }),
    )
    .min(1)
    .max(2000),
});

const confirmSchema = z.object({
  hashes: z.array(sha256Schema).min(1).max(2000),
});

const downloadUrlsSchema = z.object({
  hashes: z.array(sha256Schema).min(1).max(2000),
});

function buildStorageKey(orgId: string, sha256: string): string {
  const lower = sha256.toLowerCase();
  return `blobs/${orgId}/sha256/${lower.slice(0, 2)}/${lower}.bin`;
}

function requireOrg(request: FastifyRequest, reply: FastifyReply): string | null {
  if (!request.userId) {
    reply.code(401).send({ ok: false, code: 'UNAUTHENTICATED', error: 'Unauthenticated.' });
    return null;
  }
  if (!request.orgId) {
    reply.code(403).send({ ok: false, code: 'NO_ORG', error: '账号未关联任何组织。' });
    return null;
  }
  return request.orgId;
}

export async function registerObjectRoutes(app: FastifyInstance) {
  // Which of these hashes already exist and are available in this org.
  app.post('/api/objects/check', async (request, reply) => {
    const orgId = requireOrg(request, reply);
    if (!orgId) return;

    const parsed = checkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const result = await pool.query<{ sha256: string }>(
      `SELECT sha256 FROM objects WHERE org_id = $1 AND sha256 = ANY($2) AND status = 'available'`,
      [orgId, parsed.data.hashes],
    );
    return reply.send({ ok: true, existing: result.rows.map((r) => r.sha256) });
  });

  // Pre-register pending objects and hand back signed PUT URLs.
  app.post('/api/objects/upload-urls', async (request, reply) => {
    const orgId = requireOrg(request, reply);
    if (!orgId) return;
    const userId = request.userId as string;

    if (!ossConfigured) {
      return reply.code(503).send({ ok: false, error: 'OSS is not configured on the server.' });
    }

    const parsed = uploadUrlsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const bucket = env.OSS_BUCKET as string;
    const region = env.OSS_REGION as string;

    const urls: Array<{
      sha256: string;
      objectId: string;
      uploadUrl: string;
      storageKey: string;
    }> = [];
    const alreadyAvailable: string[] = [];

    const client = await pool.connect();
    try {
      for (const file of parsed.data.files) {
        const storageKey = buildStorageKey(orgId, file.sha256);

        // Upsert the org-scoped object row. Existing rows keep their id and
        // storage_key; a previously soft-deleted row becomes pending again so
        // it can be re-uploaded.
        const upsert = await client.query<{ id: string; status: string; storage_key: string }>(
          `INSERT INTO objects (org_id, sha256, size_bytes, mime_type, bucket, region, storage_key, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
           ON CONFLICT (org_id, sha256) DO UPDATE SET
             last_seen_at = now(),
             status = CASE WHEN objects.status = 'deleted' THEN 'pending' ELSE objects.status END
           RETURNING id, status, storage_key`,
          [orgId, file.sha256, file.sizeBytes, file.mimeType ?? null, bucket, region, storageKey, userId],
        );
        const row = upsert.rows[0];

        // A11: never sign a PUT URL for a blob that is already available —
        // that would allow overwriting committed content.
        if (row.status === 'available') {
          alreadyAvailable.push(file.sha256);
          continue;
        }

        const uploadUrl = getSignedPutUrl(row.storage_key);
        urls.push({ sha256: file.sha256, objectId: row.id, uploadUrl, storageKey: row.storage_key });
      }
      return reply.send({ ok: true, urls, alreadyAvailable });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  // Mark uploads as completed (org-scoped).
  app.post('/api/objects/confirm', async (request, reply) => {
    const orgId = requireOrg(request, reply);
    if (!orgId) return;

    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const result = await pool.query<{ sha256: string }>(
      `UPDATE objects
         SET status = 'available', last_seen_at = now()
       WHERE org_id = $1 AND sha256 = ANY($2) AND status = 'pending'
       RETURNING sha256`,
      [orgId, parsed.data.hashes],
    );
    return reply.send({ ok: true, confirmed: result.rows.map((r) => r.sha256) });
  });

  // C4: signed GET URLs for downloading blobs during pull (org-scoped).
  app.post('/api/objects/download-urls', async (request, reply) => {
    const orgId = requireOrg(request, reply);
    if (!orgId) return;

    if (!ossConfigured) {
      return reply.code(503).send({ ok: false, error: 'OSS is not configured on the server.' });
    }

    const parsed = downloadUrlsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const objs = await pool.query<{ sha256: string; storage_key: string }>(
      `SELECT sha256, storage_key FROM objects
        WHERE org_id = $1 AND sha256 = ANY($2) AND status = 'available'`,
      [orgId, parsed.data.hashes],
    );

    const urls = objs.rows.map((row) => ({
      sha256: row.sha256,
      downloadUrl: getSignedGetUrl(row.storage_key),
    }));
    const found = new Set(objs.rows.map((r) => r.sha256.toLowerCase()));
    const missing = parsed.data.hashes.filter((h) => !found.has(h.toLowerCase()));

    return reply.send({ ok: true, urls, missing });
  });
}
