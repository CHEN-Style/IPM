import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, ossConfigured } from '../../config/env.js';
import { pool } from '../../infra/db/postgres.js';
import { getSignedGetUrl, getSignedPutUrl } from '../../infra/oss/ossClient.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'sha256 must be 64 hex chars');
const slugSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const versionSchema = z.string().min(1).max(40).regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/);

const uploadUrlSchema = z.object({
  slug: slugSchema,
  version: versionSchema,
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});

const publishSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(1024).optional(),
  version: versionSchema,
  packageSha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(500),
  manifest: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const versionPublishSchema = publishSchema.omit({ slug: true, name: true }).extend({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1024).optional(),
});

const installSchema = z.object({
  versionId: z.string().uuid().optional(),
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
  grants: z.array(z.object({
    grantType: z.enum(['org', 'user']),
    userId: z.string().uuid().optional(),
  })).optional(),
});

const accessSchema = z.object({
  grants: z.array(z.object({
    grantType: z.enum(['org', 'user']),
    userId: z.string().uuid().optional(),
  })).default([]),
});

function skillStorageKey(orgId: string, slug: string, version: string, sha256: string): string {
  const cleanVersion = version.replace(/[^0-9A-Za-z._-]/g, '_');
  return `skills/${orgId}/${slug}/${cleanVersion}/${sha256.toLowerCase()}.ipmskill`;
}

async function requireOrgMember(userId: string, orgId: string | null) {
  if (!orgId) return null;
  const res = await pool.query<{ role: string }>(
    `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
    [orgId, userId],
  );
  return res.rows[0] ?? null;
}

function isOrgAdmin(role?: string | null) {
  return role === 'owner' || role === 'admin';
}

async function requireOrgAdmin(userId: string, orgId: string | null) {
  const member = await requireOrgMember(userId, orgId);
  if (!member || !isOrgAdmin(member.role)) return null;
  return member;
}

async function canAccessSkill(skillId: string, userId: string, orgId: string, opts: { allowAdmin?: boolean; role?: string } = {}) {
  if (opts.allowAdmin && isOrgAdmin(opts.role)) return true;
  const res = await pool.query(
    `SELECT 1
       FROM skills s
      WHERE s.id = $1
        AND s.org_id = $2
        AND s.status = 'approved'
        AND EXISTS (
          SELECT 1 FROM skill_access_grants g
           WHERE g.skill_id = s.id
             AND (
               g.grant_type = 'org'
               OR (g.grant_type = 'user' AND g.user_id = $3)
             )
        )`,
    [skillId, orgId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

async function replaceAccessGrants(skillId: string, grants: Array<{ grantType: 'org' | 'user'; userId?: string }>, actorId: string) {
  await pool.query('DELETE FROM skill_access_grants WHERE skill_id = $1', [skillId]);
  for (const grant of grants) {
    if (grant.grantType === 'org') {
      await pool.query(
        `INSERT INTO skill_access_grants (skill_id, grant_type, created_by)
         VALUES ($1, 'org', $2)
         ON CONFLICT DO NOTHING`,
        [skillId, actorId],
      );
    } else if (grant.userId) {
      await pool.query(
        `INSERT INTO skill_access_grants (skill_id, grant_type, user_id, created_by)
         VALUES ($1, 'user', $2, $3)
         ON CONFLICT DO NOTHING`,
        [skillId, grant.userId, actorId],
      );
    }
  }
}

function mapSkillRow(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    publisherId: row.publisher_id,
    publisherName: row.publisher_name,
    reviewerId: row.reviewed_by || null,
    reviewerName: row.reviewer_name || null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    metadata: row.metadata || {},
    latestVersionId: row.latest_version_id,
    latestVersion: row.latest_version,
    latestManifest: row.latest_manifest || null,
    latestVersionCreatedAt: row.latest_version_created_at,
    installedVersionId: row.installed_version_id || null,
    installedVersion: row.installed_version || null,
    installedAt: row.installed_at || null,
    updateAvailable: Boolean(row.installed_version_id && row.latest_version_id && row.installed_version_id !== row.latest_version_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function registerSkillRoutes(app: FastifyInstance) {
  app.post('/api/skills/upload-url', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!ossConfigured) return reply.code(503).send({ ok: false, error: 'OSS is not configured on the server.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const parsed = uploadUrlSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });

    const storageKey = skillStorageKey(orgId, parsed.data.slug, parsed.data.version, parsed.data.sha256);
    return reply.send({
      ok: true,
      storageKey,
      uploadUrl: getSignedPutUrl(storageKey),
      bucket: env.OSS_BUCKET,
      region: env.OSS_REGION,
    });
  });

  app.get('/api/skills/installed', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const rows = await pool.query(
      `SELECT s.id, s.slug, s.name, s.description, s.status, s.publisher_id,
              u.display_name AS publisher_name,
              s.reviewed_by, reviewer.display_name AS reviewer_name, s.reviewed_at, s.review_note,
              s.metadata, s.latest_version_id,
              latest.version AS latest_version, latest.manifest AS latest_manifest, latest.created_at AS latest_version_created_at,
              i.version_id AS installed_version_id, installed.version AS installed_version, i.installed_at,
              s.created_at, s.updated_at
         FROM skill_installs i
         JOIN skills s ON s.id = i.skill_id
         LEFT JOIN users u ON u.id = s.publisher_id
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         LEFT JOIN skill_versions latest ON latest.id = s.latest_version_id
         LEFT JOIN skill_versions installed ON installed.id = i.version_id
        WHERE i.org_id = $1 AND i.user_id = $2
          AND s.status = 'approved'
          AND EXISTS (
            SELECT 1 FROM skill_access_grants g
             WHERE g.skill_id = s.id
               AND (
                 g.grant_type = 'org'
                 OR (g.grant_type = 'user' AND g.user_id = $2)
               )
          )
        ORDER BY i.installed_at DESC`,
      [orgId, userId],
    );
    return reply.send({ ok: true, skills: rows.rows.map(mapSkillRow) });
  });

  app.get('/api/skills', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const { q } = request.query as { q?: string };
    const query = String(q || '').trim();
    const params: any[] = [orgId, userId];
    const searchSql = query ? `AND (s.name ILIKE $3 OR s.description ILIKE $3 OR s.slug ILIKE $3)` : '';
    if (query) params.push(`%${query}%`);

    const rows = await pool.query(
      `SELECT s.id, s.slug, s.name, s.description, s.status, s.publisher_id,
              u.display_name AS publisher_name,
              s.reviewed_by, reviewer.display_name AS reviewer_name, s.reviewed_at, s.review_note,
              s.metadata, s.latest_version_id,
              latest.version AS latest_version, latest.manifest AS latest_manifest, latest.created_at AS latest_version_created_at,
              i.version_id AS installed_version_id, installed.version AS installed_version, i.installed_at,
              s.created_at, s.updated_at
         FROM skills s
         LEFT JOIN users u ON u.id = s.publisher_id
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         LEFT JOIN skill_versions latest ON latest.id = s.latest_version_id
         LEFT JOIN skill_installs i ON i.skill_id = s.id AND i.user_id = $2
         LEFT JOIN skill_versions installed ON installed.id = i.version_id
        WHERE s.org_id = $1
          AND s.status = 'approved'
          AND EXISTS (
            SELECT 1 FROM skill_access_grants g
             WHERE g.skill_id = s.id
               AND (
                 g.grant_type = 'org'
                 OR (g.grant_type = 'user' AND g.user_id = $2)
               )
          )
          ${searchSql}
        ORDER BY s.updated_at DESC`,
      params,
    );
    return reply.send({ ok: true, skills: rows.rows.map(mapSkillRow) });
  });

  // ── H5: my submissions ─────────────────────────────────────────────
  // Every skill the caller has published, regardless of review status, so a
  // member can track pending/approved/rejected (with the review note) without
  // admin rights.
  app.get('/api/skills/mine', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const rows = await pool.query(
      `SELECT s.id, s.slug, s.name, s.description, s.status, s.publisher_id,
              u.display_name AS publisher_name,
              s.reviewed_by, reviewer.display_name AS reviewer_name, s.reviewed_at, s.review_note,
              s.metadata, s.latest_version_id,
              latest.version AS latest_version, latest.manifest AS latest_manifest, latest.created_at AS latest_version_created_at,
              i.version_id AS installed_version_id, installed.version AS installed_version, i.installed_at,
              s.created_at, s.updated_at,
              (SELECT count(*)::int FROM skill_installs si WHERE si.skill_id = s.id) AS install_count
         FROM skills s
         LEFT JOIN users u ON u.id = s.publisher_id
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         LEFT JOIN skill_versions latest ON latest.id = s.latest_version_id
         LEFT JOIN skill_installs i ON i.skill_id = s.id AND i.user_id = $2
         LEFT JOIN skill_versions installed ON installed.id = i.version_id
        WHERE s.org_id = $1 AND s.publisher_id = $2
        ORDER BY
          CASE s.status
            WHEN 'pending_review' THEN 0
            WHEN 'rejected' THEN 1
            WHEN 'approved' THEN 2
            ELSE 3
          END,
          s.updated_at DESC`,
      [orgId, userId],
    );
    return reply.send({
      ok: true,
      skills: rows.rows.map((r) => ({ ...mapSkillRow(r), installCount: r.install_count ?? 0 })),
    });
  });

  app.get('/api/skills/admin/org-users', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });

    const rows = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, m.role, m.status, m.joined_at
         FROM org_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1 AND m.status = 'active'
        ORDER BY m.role, u.display_name, u.email`,
      [orgId],
    );
    return reply.send({
      ok: true,
      users: rows.rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        role: r.role,
        joinedAt: r.joined_at,
      })),
    });
  });

  app.get('/api/skills/admin/review-queue', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { status } = request.query as { status?: string };
    const allowed = new Set(['pending_review', 'approved', 'rejected', 'archived']);
    const filter = status && allowed.has(status) ? status : null;
    const params: any[] = [orgId];
    const statusSql = filter ? 'AND s.status = $2' : '';
    if (filter) params.push(filter);

    const rows = await pool.query(
      `SELECT s.id, s.slug, s.name, s.description, s.status, s.publisher_id,
              u.display_name AS publisher_name,
              s.reviewed_by, reviewer.display_name AS reviewer_name, s.reviewed_at, s.review_note,
              s.metadata, s.latest_version_id,
              latest.version AS latest_version, latest.manifest AS latest_manifest, latest.created_at AS latest_version_created_at,
              NULL::uuid AS installed_version_id, NULL::text AS installed_version, NULL::timestamptz AS installed_at,
              s.created_at, s.updated_at
         FROM skills s
         LEFT JOIN users u ON u.id = s.publisher_id
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         LEFT JOIN skill_versions latest ON latest.id = s.latest_version_id
        WHERE s.org_id = $1 ${statusSql}
        ORDER BY
          CASE s.status
            WHEN 'pending_review' THEN 0
            WHEN 'approved' THEN 1
            WHEN 'rejected' THEN 2
            ELSE 3
          END,
          s.updated_at DESC`,
      params,
    );
    return reply.send({ ok: true, skills: rows.rows.map(mapSkillRow) });
  });

  // ── H5: governance overview ────────────────────────────────────────
  // Admin-side catalogue: every skill in the org (any status) plus install
  // count and an access-grant summary, for the enterprise console list view.
  app.get('/api/skills/admin/overview', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });

    const rows = await pool.query(
      `SELECT s.id, s.slug, s.name, s.description, s.status, s.publisher_id,
              u.display_name AS publisher_name,
              s.reviewed_by, reviewer.display_name AS reviewer_name, s.reviewed_at, s.review_note,
              s.metadata, s.latest_version_id,
              latest.version AS latest_version, latest.manifest AS latest_manifest, latest.created_at AS latest_version_created_at,
              NULL::uuid AS installed_version_id, NULL::text AS installed_version, NULL::timestamptz AS installed_at,
              s.created_at, s.updated_at,
              (SELECT count(*)::int FROM skill_installs si WHERE si.skill_id = s.id) AS install_count,
              (SELECT count(*)::int FROM skill_installs si
                WHERE si.skill_id = s.id AND si.version_id IS DISTINCT FROM s.latest_version_id) AS outdated_install_count,
              EXISTS (SELECT 1 FROM skill_access_grants g WHERE g.skill_id = s.id AND g.grant_type = 'org') AS org_grant,
              (SELECT count(*)::int FROM skill_access_grants g WHERE g.skill_id = s.id AND g.grant_type = 'user') AS user_grant_count,
              (SELECT count(*)::int FROM skill_versions sv WHERE sv.skill_id = s.id) AS version_count
         FROM skills s
         LEFT JOIN users u ON u.id = s.publisher_id
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         LEFT JOIN skill_versions latest ON latest.id = s.latest_version_id
        WHERE s.org_id = $1
        ORDER BY
          CASE s.status
            WHEN 'pending_review' THEN 0
            WHEN 'approved' THEN 1
            WHEN 'rejected' THEN 2
            ELSE 3
          END,
          s.updated_at DESC`,
      [orgId],
    );
    return reply.send({
      ok: true,
      skills: rows.rows.map((r) => ({
        ...mapSkillRow(r),
        installCount: r.install_count ?? 0,
        outdatedInstallCount: r.outdated_install_count ?? 0,
        orgGrant: Boolean(r.org_grant),
        userGrantCount: r.user_grant_count ?? 0,
        versionCount: r.version_count ?? 0,
      })),
    });
  });

  // ── H5: installer list (admin) ─────────────────────────────────────
  // Who has a skill installed, on which version, and whether they lag behind
  // the latest version.
  app.get('/api/skills/:id/installers', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const skill = await pool.query<{ latest_version_id: string | null }>(
      `SELECT latest_version_id FROM skills WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    if (skill.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
    const latestVersionId = skill.rows[0].latest_version_id;

    const rows = await pool.query(
      `SELECT i.user_id, u.email, u.display_name, i.version_id, sv.version, i.installed_at
         FROM skill_installs i
         LEFT JOIN users u ON u.id = i.user_id
         LEFT JOIN skill_versions sv ON sv.id = i.version_id
        WHERE i.skill_id = $1
        ORDER BY i.installed_at DESC`,
      [id],
    );
    return reply.send({
      ok: true,
      installers: rows.rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        displayName: r.display_name,
        versionId: r.version_id,
        version: r.version,
        installedAt: r.installed_at,
        outdated: Boolean(latestVersionId && r.version_id !== latestVersionId),
      })),
    });
  });

  app.get('/api/skills/:id/access', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const skill = await pool.query(`SELECT 1 FROM skills WHERE id = $1 AND org_id = $2`, [id, orgId]);
    if (skill.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
    const rows = await pool.query(
      `SELECT g.id, g.grant_type, g.user_id, u.email, u.display_name, g.created_by, g.created_at
         FROM skill_access_grants g
         LEFT JOIN users u ON u.id = g.user_id
        WHERE g.skill_id = $1
        ORDER BY g.grant_type, u.display_name NULLS LAST`,
      [id],
    );
    return reply.send({
      ok: true,
      grants: rows.rows.map((r) => ({
        id: r.id,
        grantType: r.grant_type,
        userId: r.user_id,
        email: r.email,
        displayName: r.display_name,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
    });
  });

  app.post('/api/skills/:id/access', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const parsed = accessSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const skill = await pool.query(`SELECT 1 FROM skills WHERE id = $1 AND org_id = $2`, [id, orgId]);
    if (skill.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
    const userIds = parsed.data.grants.filter((g) => g.grantType === 'user').map((g) => g.userId).filter(Boolean);
    if (userIds.length > 0) {
      const orgUsers = await pool.query(
        `SELECT user_id FROM org_members WHERE org_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`,
        [orgId, userIds],
      );
      if (orgUsers.rowCount !== new Set(userIds).size) {
        return reply.code(400).send({ ok: false, error: 'Some granted users are not active org members.' });
      }
    }
    await replaceAccessGrants(id, parsed.data.grants, userId);
    // H5: audit trail for grant changes outside the review flow.
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'skill.access_changed', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ skillId: id, grants: parsed.data.grants })],
    );
    return reply.send({ ok: true });
  });

  // ── H5: archive / unarchive (admin governance) ─────────────────────
  // Archiving hides a skill from the market and blocks install/download
  // (both require status='approved') and new version submissions (the
  // versions route filters status <> 'archived'). The previous status is
  // stashed in metadata so unarchive can restore it; a skill archived while
  // pending/rejected goes back to that same review state.
  app.post('/api/skills/:id/archive', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };

    const res = await pool.query<{ id: string; status: string }>(
      `UPDATE skills
          SET metadata = metadata || jsonb_build_object('archive', jsonb_build_object(
                'prevStatus', status,
                'archivedBy', $1::text,
                'archivedAt', now()::text
              )),
              status = 'archived',
              updated_at = now()
        WHERE id = $2 AND org_id = $3 AND status <> 'archived'
        RETURNING id, status`,
      [userId, id, orgId],
    );
    if (res.rowCount === 0) {
      const exists = await pool.query(`SELECT status FROM skills WHERE id = $1 AND org_id = $2`, [id, orgId]);
      if (exists.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
      return reply.code(409).send({ ok: false, error: 'Skill is already archived.', code: 'ALREADY_ARCHIVED' });
    }
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'skill.archived', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ skillId: id })],
    );
    return reply.send({ ok: true, skillId: id, status: 'archived' });
  });

  app.post('/api/skills/:id/unarchive', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };

    const res = await pool.query<{ id: string; status: string }>(
      `UPDATE skills
          SET status = CASE
                WHEN metadata->'archive'->>'prevStatus' IN ('pending_review', 'approved', 'rejected')
                  THEN metadata->'archive'->>'prevStatus'
                ELSE 'pending_review'
              END,
              metadata = metadata - 'archive',
              updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'archived'
        RETURNING id, status`,
      [id, orgId],
    );
    if (res.rowCount === 0) {
      const exists = await pool.query(`SELECT status FROM skills WHERE id = $1 AND org_id = $2`, [id, orgId]);
      if (exists.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
      return reply.code(409).send({ ok: false, error: 'Skill is not archived.', code: 'NOT_ARCHIVED' });
    }
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'skill.unarchived', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ skillId: id, restoredStatus: res.rows[0].status })],
    );
    return reply.send({ ok: true, skillId: id, status: res.rows[0].status });
  });

  app.post('/api/skills/:id/review', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const parsed = reviewSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const grants = parsed.data.decision === 'approved'
      ? (parsed.data.grants && parsed.data.grants.length > 0 ? parsed.data.grants : [{ grantType: 'org' as const }])
      : [];
    const userIds = grants.filter((g) => g.grantType === 'user').map((g) => g.userId).filter(Boolean);
    if (userIds.length > 0) {
      const orgUsers = await pool.query(
        `SELECT user_id FROM org_members WHERE org_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`,
        [orgId, userIds],
      );
      if (orgUsers.rowCount !== new Set(userIds).size) {
        return reply.code(400).send({ ok: false, error: 'Some granted users are not active org members.' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const skill = await client.query(
        `UPDATE skills
            SET status = $1,
                reviewed_by = $2,
                reviewed_at = now(),
                review_note = $3,
                updated_at = now()
          WHERE id = $4 AND org_id = $5
          RETURNING id`,
        [parsed.data.decision, userId, parsed.data.note || null, id, orgId],
      );
      if (skill.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ ok: false, error: 'Skill not found.' });
      }
      await client.query(`DELETE FROM skill_access_grants WHERE skill_id = $1`, [id]);
      for (const grant of grants) {
        if (grant.grantType === 'org') {
          await client.query(
            `INSERT INTO skill_access_grants (skill_id, grant_type, created_by)
             VALUES ($1, 'org', $2)
             ON CONFLICT DO NOTHING`,
            [id, userId],
          );
        } else if (grant.userId) {
          await client.query(
            `INSERT INTO skill_access_grants (skill_id, grant_type, user_id, created_by)
             VALUES ($1, 'user', $2, $3)
             ON CONFLICT DO NOTHING`,
            [id, grant.userId, userId],
          );
        }
      }
      await client.query(
        `INSERT INTO events (org_id, actor_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [orgId, userId, parsed.data.decision === 'approved' ? 'skill.approved' : 'skill.rejected', JSON.stringify({ skillId: id, grants })],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, skillId: id, status: parsed.data.decision });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  app.post('/api/skills', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });

    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const data = parsed.data;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const skill = await client.query<{ id: string }>(
        `INSERT INTO skills (org_id, slug, name, description, publisher_id, status, metadata)
         VALUES ($1, $2, $3, $4, $5, 'pending_review', $6::jsonb)
         ON CONFLICT (org_id, slug)
         DO UPDATE SET name = EXCLUDED.name,
                       description = EXCLUDED.description,
                       metadata = skills.metadata || EXCLUDED.metadata,
                       status = 'pending_review',
                       publisher_id = EXCLUDED.publisher_id,
                       reviewed_by = NULL,
                       reviewed_at = NULL,
                       review_note = NULL,
                       updated_at = now()
         RETURNING id`,
        [orgId, data.slug, data.name, data.description || '', userId, JSON.stringify(data.metadata ?? {})],
      );
      const skillId = skill.rows[0].id;
      const version = await client.query<{ id: string }>(
        `INSERT INTO skill_versions
           (skill_id, version, manifest, package_sha256, package_size_bytes, bucket, region, storage_key, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (skill_id, version)
         DO UPDATE SET manifest = EXCLUDED.manifest,
                       package_sha256 = EXCLUDED.package_sha256,
                       package_size_bytes = EXCLUDED.package_size_bytes,
                       bucket = EXCLUDED.bucket,
                       region = EXCLUDED.region,
                       storage_key = EXCLUDED.storage_key,
                       created_by = EXCLUDED.created_by,
                       created_at = now()
         RETURNING id`,
        [
          skillId,
          data.version,
          JSON.stringify(data.manifest ?? {}),
          data.packageSha256.toLowerCase(),
          data.sizeBytes,
          env.OSS_BUCKET ?? null,
          env.OSS_REGION ?? null,
          data.storageKey,
          userId,
        ],
      );
      await client.query(`UPDATE skills SET latest_version_id = $1, updated_at = now() WHERE id = $2`, [version.rows[0].id, skillId]);
      await client.query(`DELETE FROM skill_access_grants WHERE skill_id = $1`, [skillId]);
      await client.query(
        `INSERT INTO events (org_id, actor_id, event_type, payload)
         VALUES ($1, $2, 'skill.submitted', $3::jsonb)`,
        [orgId, userId, JSON.stringify({ skillId, versionId: version.rows[0].id, slug: data.slug, version: data.version })],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ ok: true, skillId, versionId: version.rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  app.get('/api/skills/:id', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const { id } = request.params as { id: string };
    const rows = await pool.query(
      `SELECT s.id, s.slug, s.name, s.description, s.status, s.publisher_id,
              u.display_name AS publisher_name,
              s.reviewed_by, reviewer.display_name AS reviewer_name, s.reviewed_at, s.review_note,
              s.metadata, s.latest_version_id,
              latest.version AS latest_version, latest.manifest AS latest_manifest, latest.created_at AS latest_version_created_at,
              i.version_id AS installed_version_id, installed.version AS installed_version, i.installed_at,
              s.created_at, s.updated_at
         FROM skills s
         LEFT JOIN users u ON u.id = s.publisher_id
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         LEFT JOIN skill_versions latest ON latest.id = s.latest_version_id
         LEFT JOIN skill_installs i ON i.skill_id = s.id AND i.user_id = $2
         LEFT JOIN skill_versions installed ON installed.id = i.version_id
        WHERE s.org_id = $1 AND s.id = $3`,
      [orgId, userId, id],
    );
    if (rows.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
    const row = rows.rows[0];
    const accessAllowed = await canAccessSkill(id, userId, orgId, { allowAdmin: true, role: member.role });
    if (!accessAllowed && row.publisher_id !== userId) {
      return reply.code(403).send({ ok: false, error: 'No access to this skill.' });
    }
    const versions = await pool.query(
      `SELECT id, version, manifest, package_sha256, package_size_bytes, created_by, created_at
         FROM skill_versions WHERE skill_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return reply.send({
      ok: true,
      skill: mapSkillRow(row),
      versions: versions.rows.map((v) => ({
        id: v.id,
        version: v.version,
        manifest: v.manifest || {},
        packageSha256: v.package_sha256,
        sizeBytes: Number(v.package_size_bytes),
        createdBy: v.created_by,
        createdAt: v.created_at,
      })),
    });
  });

  app.post('/api/skills/:id/versions', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const { id } = request.params as { id: string };
    const parsed = versionPublishSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const data = parsed.data;

    const skill = await pool.query<{ id: string; publisher_id: string | null }>(
      `SELECT id, publisher_id FROM skills WHERE id = $1 AND org_id = $2 AND status <> 'archived'`,
      [id, orgId],
    );
    if (skill.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
    if (!isOrgAdmin(member.role) && skill.rows[0].publisher_id !== userId) {
      return reply.code(403).send({ ok: false, error: 'Only the publisher or org admin can submit a new version.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const version = await client.query<{ id: string }>(
        `INSERT INTO skill_versions
           (skill_id, version, manifest, package_sha256, package_size_bytes, bucket, region, storage_key, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [id, data.version, JSON.stringify(data.manifest ?? {}), data.packageSha256.toLowerCase(), data.sizeBytes, env.OSS_BUCKET ?? null, env.OSS_REGION ?? null, data.storageKey, userId],
      );
      await client.query(
        `UPDATE skills SET latest_version_id = $1,
                           name = COALESCE($2, name),
                           description = COALESCE($3, description),
                           metadata = metadata || $4::jsonb,
                           status = 'pending_review',
                           reviewed_by = NULL,
                           reviewed_at = NULL,
                           review_note = NULL,
                           updated_at = now()
          WHERE id = $5`,
        [version.rows[0].id, data.name ?? null, data.description ?? null, JSON.stringify(data.metadata ?? {}), id],
      );
      await client.query(
        `DELETE FROM skill_access_grants WHERE skill_id = $1`,
        [id],
      );
      await client.query(
        `INSERT INTO events (org_id, actor_id, event_type, payload)
         VALUES ($1, $2, 'skill.version_submitted', $3::jsonb)`,
        [orgId, userId, JSON.stringify({ skillId: id, versionId: version.rows[0].id, version: data.version })],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ ok: true, skillId: id, versionId: version.rows[0].id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  app.post('/api/skills/:id/versions/:versionId/download', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    if (!ossConfigured) return reply.code(503).send({ ok: false, error: 'OSS is not configured on the server.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const { id, versionId } = request.params as { id: string; versionId: string };
    const accessAllowed = await canAccessSkill(id, userId, orgId, { allowAdmin: false, role: member.role });
    if (!accessAllowed) return reply.code(403).send({ ok: false, error: 'No access to this skill.' });
    const rows = await pool.query(
      `SELECT sv.id, sv.version, sv.manifest, sv.package_sha256, sv.package_size_bytes, sv.storage_key
         FROM skill_versions sv
         JOIN skills s ON s.id = sv.skill_id
        WHERE s.org_id = $1 AND s.id = $2 AND s.status = 'approved' AND sv.id = $3`,
      [orgId, id, versionId],
    );
    if (rows.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill version not found.' });
    const v = rows.rows[0];
    return reply.send({
      ok: true,
      versionId: v.id,
      version: v.version,
      manifest: v.manifest || {},
      packageSha256: v.package_sha256,
      sizeBytes: Number(v.package_size_bytes),
      downloadUrl: getSignedGetUrl(v.storage_key),
    });
  });

  app.post('/api/skills/:id/install', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const { id } = request.params as { id: string };
    const parsed = installSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });

    const accessAllowed = await canAccessSkill(id, userId, orgId, { allowAdmin: false, role: member.role });
    if (!accessAllowed) return reply.code(403).send({ ok: false, error: 'No access to this skill.' });

    const rows = await pool.query<{ latest_version_id: string | null }>(
      `SELECT latest_version_id FROM skills WHERE id = $1 AND org_id = $2 AND status = 'approved'`,
      [id, orgId],
    );
    if (rows.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Skill not found.' });
    const versionId = parsed.data.versionId || rows.rows[0].latest_version_id;
    if (!versionId) return reply.code(409).send({ ok: false, error: 'Skill has no version.' });

    await pool.query(
      `INSERT INTO skill_installs (org_id, skill_id, version_id, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (skill_id, user_id)
       DO UPDATE SET version_id = EXCLUDED.version_id,
                     installed_at = now(),
                     source = 'org_registry'`,
      [orgId, id, versionId, userId],
    );
    // H5: install statistics depend on this audit trail.
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'skill.installed', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ skillId: id, versionId })],
    );
    return reply.send({ ok: true, skillId: id, versionId });
  });
}
