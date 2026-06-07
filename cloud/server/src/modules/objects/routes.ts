import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';
import { env, ossConfigured } from '../../config/env.js';
import { getSignedPutUrl } from '../../infra/oss/ossClient.js';

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

function buildStorageKey(sha256: string): string {
  const lower = sha256.toLowerCase();
  return `blobs/sha256/${lower.slice(0, 2)}/${lower}.bin`;
}

export async function registerObjectRoutes(app: FastifyInstance) {
  // Which of these hashes already exist and are available in the cloud.
  app.post('/api/objects/check', async (request, reply) => {
    if (!request.userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });

    const parsed = checkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const result = await pool.query<{ sha256: string }>(
      `SELECT sha256 FROM objects WHERE sha256 = ANY($1) AND status = 'available'`,
      [parsed.data.hashes],
    );
    return reply.send({ ok: true, existing: result.rows.map((r) => r.sha256) });
  });

  // Pre-register pending objects and hand back signed PUT URLs.
  app.post('/api/objects/upload-urls', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });

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

    const client = await pool.connect();
    try {
      for (const file of parsed.data.files) {
        const storageKey = buildStorageKey(file.sha256);

        // Upsert the object row. If it already exists (any status) we keep the
        // existing id; we only (re)create the row when missing.
        const upsert = await client.query<{ id: string }>(
          `INSERT INTO objects (sha256, size_bytes, mime_type, bucket, region, storage_key, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
           ON CONFLICT (sha256) DO UPDATE SET last_seen_at = now()
           RETURNING id`,
          [file.sha256, file.sizeBytes, file.mimeType ?? null, bucket, region, storageKey, userId],
        );
        const objectId = upsert.rows[0].id;

        const uploadUrl = getSignedPutUrl(storageKey);
        urls.push({ sha256: file.sha256, objectId, uploadUrl, storageKey });
      }
      return reply.send({ ok: true, urls });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  // Mark uploads as completed.
  app.post('/api/objects/confirm', async (request, reply) => {
    if (!request.userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });

    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }

    const result = await pool.query<{ sha256: string }>(
      `UPDATE objects
         SET status = 'available', last_seen_at = now()
       WHERE sha256 = ANY($1) AND status = 'pending'
       RETURNING sha256`,
      [parsed.data.hashes],
    );
    return reply.send({ ok: true, confirmed: result.rows.map((r) => r.sha256) });
  });
}
