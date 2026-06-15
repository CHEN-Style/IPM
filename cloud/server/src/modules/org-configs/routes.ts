import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../infra/db/postgres.js';
import { encryptConfig, decryptConfig } from '../../infra/crypto.js';

const configSchema = z.object({
  ai: z.record(z.string(), z.unknown()).optional(),
  searchApi: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => Boolean(v.ai || v.searchApi), 'config must include ai or searchApi');

const createTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  config: configSchema,
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).refine(
  (v) => v.name !== undefined || v.description !== undefined || v.maxUses !== undefined || v.expiresAt !== undefined,
  'no fields to update',
);

const codeSchema = z.object({
  code: z.string().min(1).max(64),
  clientInfo: z.record(z.string(), z.unknown()).optional(),
});

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `IPM-AI-${block()}-${block()}`;
}

function normalizeCode(code: string) {
  return String(code || '').trim().toUpperCase();
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

function summarizeConfig(config: any) {
  const ai = config?.ai && typeof config.ai === 'object' ? config.ai : {};
  const providers = Array.isArray(ai.providers) ? ai.providers : [];
  const roleAssignments = ai.roleAssignments && typeof ai.roleAssignments === 'object' ? ai.roleAssignments : {};
  const searchApi = config?.searchApi && typeof config.searchApi === 'object' ? config.searchApi : null;
  return {
    providerCount: providers.length,
    providerNames: providers.map((p: any) => p?.name || p?.id).filter(Boolean).slice(0, 8),
    roles: {
      knowclaw: Array.isArray(roleAssignments.knowclaw) ? roleAssignments.knowclaw.length : 0,
      classification: Boolean(roleAssignments.classification),
      summary: Boolean(roleAssignments.summary),
      preferenceParsing: Boolean(roleAssignments.preferenceParsing),
    },
    hasSearchApi: Boolean(searchApi?.apiKey),
    containsSecrets: providers.some((p: any) => Boolean(p?.apiKey)) || Boolean(searchApi?.apiKey),
  };
}

function mapTemplate(row: any, includeCode = true, includeConfig = false) {
  // config_json is sealed at rest (H6); legacy plaintext rows pass through.
  const config = decryptConfig<any>(row.config_json) || {};
  return {
    id: row.id,
    templateType: row.template_type,
    name: row.name,
    description: row.description,
    status: row.status,
    ...(includeCode ? { code: row.code } : {}),
    maxUses: row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses),
    usedCount: Number(row.used_count || 0),
    expiresAt: row.expires_at || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rotatedAt: row.rotated_at || null,
    summary: summarizeConfig(config),
    ...(includeConfig ? { config } : {}),
  };
}

async function uniqueCode(client = pool) {
  for (let i = 0; i < 8; i += 1) {
    const code = generateCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await client.query(`SELECT 1 FROM org_config_templates WHERE code = $1`, [code]);
    if (exists.rowCount === 0) return code;
  }
  throw new Error('Failed to generate unique config code.');
}

export async function registerOrgConfigRoutes(app: FastifyInstance) {
  app.post('/api/org-configs/templates', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });

    const parsed = createTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const data = parsed.data;
    const code = await uniqueCode();

    const res = await pool.query(
      `INSERT INTO org_config_templates
         (org_id, template_type, name, description, config_json, code, max_uses, expires_at, created_by)
       VALUES ($1, 'ai_settings', $2, $3, $4::jsonb, $5, $6, $7, $8)
       RETURNING *`,
      [
        orgId,
        data.name.trim(),
        data.description?.trim() || '',
        JSON.stringify(encryptConfig(data.config)),
        code,
        data.maxUses ?? null,
        data.expiresAt ?? null,
        userId,
      ],
    );
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'org_config_template.created', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ templateId: res.rows[0].id, templateType: 'ai_settings' })],
    );
    return reply.code(201).send({ ok: true, template: mapTemplate(res.rows[0], true, false) });
  });

  app.get('/api/org-configs/templates', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });

    const rows = await pool.query(
      `SELECT t.*, u.display_name AS created_by_name
         FROM org_config_templates t
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.org_id = $1 AND t.template_type = 'ai_settings' AND t.status <> 'archived'
        ORDER BY t.updated_at DESC`,
      [orgId],
    );
    return reply.send({ ok: true, templates: rows.rows.map((r) => mapTemplate(r, true, false)) });
  });

  app.post('/api/org-configs/templates/:id/rotate-code', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const code = await uniqueCode();
    const res = await pool.query(
      `UPDATE org_config_templates
          SET code = $1, rotated_at = now(), updated_at = now()
        WHERE id = $2 AND org_id = $3 AND status <> 'archived'
        RETURNING *`,
      [code, id, orgId],
    );
    if (res.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Template not found.' });
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'org_config_template.code_rotated', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ templateId: id })],
    );
    return reply.send({ ok: true, template: mapTemplate(res.rows[0], true, false) });
  });

  app.post('/api/org-configs/templates/:id/disable', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const res = await pool.query(
      `UPDATE org_config_templates
          SET status = 'disabled', updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status <> 'archived'
        RETURNING *`,
      [id, orgId],
    );
    if (res.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Template not found.' });
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'org_config_template.disabled', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ templateId: id })],
    );
    return reply.send({ ok: true, template: mapTemplate(res.rows[0], true, false) });
  });

  app.post('/api/org-configs/templates/:id/enable', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    // Re-enabling is the inverse of disable; archived templates stay archived.
    const res = await pool.query(
      `UPDATE org_config_templates
          SET status = 'active', updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'disabled'
        RETURNING *`,
      [id, orgId],
    );
    if (res.rowCount === 0) {
      const exists = await pool.query(
        `SELECT status FROM org_config_templates WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      if (exists.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Template not found.' });
      return reply.code(409).send({ ok: false, error: '仅停用状态的模板可以重新启用。' });
    }
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'org_config_template.enabled', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ templateId: id })],
    );
    return reply.send({ ok: true, template: mapTemplate(res.rows[0], true, false) });
  });

  app.patch('/api/org-configs/templates/:id', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };

    const parsed = updateTemplateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const data = parsed.data;

    // Only metadata is editable; the config payload itself is immutable (rotate
    // the source and create a new template to change distributed secrets).
    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { values.push(data.name.trim()); sets.push(`name = $${values.length}`); }
    if (data.description !== undefined) { values.push(data.description.trim()); sets.push(`description = $${values.length}`); }
    if (data.maxUses !== undefined) { values.push(data.maxUses); sets.push(`max_uses = $${values.length}`); }
    if (data.expiresAt !== undefined) { values.push(data.expiresAt); sets.push(`expires_at = $${values.length}`); }
    sets.push('updated_at = now()');

    values.push(id);
    const idParam = values.length;
    values.push(orgId);
    const orgParam = values.length;
    const res = await pool.query(
      `UPDATE org_config_templates
          SET ${sets.join(', ')}
        WHERE id = $${idParam} AND org_id = $${orgParam} AND status <> 'archived'
        RETURNING *`,
      values,
    );
    if (res.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Template not found.' });
    await pool.query(
      `INSERT INTO events (org_id, actor_id, event_type, payload)
       VALUES ($1, $2, 'org_config_template.updated', $3::jsonb)`,
      [orgId, userId, JSON.stringify({ templateId: id, fields: Object.keys(data) })],
    );
    return reply.send({ ok: true, template: mapTemplate(res.rows[0], true, false) });
  });

  app.get('/api/org-configs/templates/:id/uses', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgAdmin(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'Org admin required.' });
    const { id } = request.params as { id: string };
    const exists = await pool.query(
      `SELECT 1 FROM org_config_templates WHERE id = $1 AND org_id = $2`,
      [id, orgId],
    );
    if (exists.rowCount === 0) return reply.code(404).send({ ok: false, error: 'Template not found.' });
    const rows = await pool.query(
      `SELECT tu.id, tu.used_at, tu.client_info, u.email, u.display_name, u.id AS user_id
         FROM org_config_template_uses tu
         JOIN users u ON u.id = tu.user_id
        WHERE tu.template_id = $1
        ORDER BY tu.used_at DESC
        LIMIT 200`,
      [id],
    );
    return reply.send({
      ok: true,
      uses: rows.rows.map((r) => ({
        id: r.id,
        usedAt: r.used_at,
        clientInfo: r.client_info || {},
        userId: r.user_id,
        email: r.email,
        displayName: r.display_name,
      })),
    });
  });

  app.post('/api/org-configs/preview', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const parsed = codeSchema.pick({ code: true }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const code = normalizeCode(parsed.data.code);

    const rows = await pool.query(
      `SELECT t.*, u.display_name AS created_by_name
         FROM org_config_templates t
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.org_id = $1 AND t.code = $2 AND t.template_type = 'ai_settings'`,
      [orgId, code],
    );
    const tpl = rows.rows[0];
    if (!tpl) return reply.code(404).send({ ok: false, error: '配置码不存在或不属于当前组织。' });
    if (tpl.status !== 'active') return reply.code(409).send({ ok: false, error: '该配置模板已停用。' });
    if (tpl.expires_at && new Date(tpl.expires_at).getTime() < Date.now()) {
      return reply.code(409).send({ ok: false, error: '该配置码已过期。' });
    }
    if (tpl.max_uses !== null && Number(tpl.used_count) >= Number(tpl.max_uses)) {
      return reply.code(409).send({ ok: false, error: '该配置码使用次数已达上限。' });
    }
    return reply.send({ ok: true, template: mapTemplate(tpl, false, false) });
  });

  app.post('/api/org-configs/import', async (request, reply) => {
    const userId = request.userId;
    const orgId = request.orgId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });
    const member = await requireOrgMember(userId, orgId);
    if (!member || !orgId) return reply.code(403).send({ ok: false, error: 'No org context.' });
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    const code = normalizeCode(parsed.data.code);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query(
        `SELECT t.*, u.display_name AS created_by_name
           FROM org_config_templates t
           LEFT JOIN users u ON u.id = t.created_by
          WHERE t.org_id = $1 AND t.code = $2 AND t.template_type = 'ai_settings'
          FOR UPDATE OF t`,
        [orgId, code],
      );
      const tpl = rows.rows[0];
      if (!tpl) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ ok: false, error: '配置码不存在或不属于当前组织。' });
      }
      if (tpl.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ ok: false, error: '该配置模板已停用。' });
      }
      if (tpl.expires_at && new Date(tpl.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ ok: false, error: '该配置码已过期。' });
      }
      if (tpl.max_uses !== null && Number(tpl.used_count) >= Number(tpl.max_uses)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ ok: false, error: '该配置码使用次数已达上限。' });
      }

      await client.query(
        `UPDATE org_config_templates
            SET used_count = used_count + 1, updated_at = now()
          WHERE id = $1`,
        [tpl.id],
      );
      await client.query(
        `INSERT INTO org_config_template_uses (template_id, org_id, user_id, client_info)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [tpl.id, orgId, userId, JSON.stringify(parsed.data.clientInfo ?? {})],
      );
      await client.query(
        `INSERT INTO events (org_id, actor_id, event_type, payload)
         VALUES ($1, $2, 'org_config_template.imported', $3::jsonb)`,
        [orgId, userId, JSON.stringify({ templateId: tpl.id })],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, template: mapTemplate(tpl, false, true) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });
}
