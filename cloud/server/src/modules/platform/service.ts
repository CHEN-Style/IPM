// H1 Platform Super Admin: org lifecycle management shared by the HTTP
// routes (`routes.ts`) and the server-side CLI (`platform-cli.ts`).
//
// Authorization is NOT handled here — routes rely on the auth middleware's
// `/api/platform/**` gate, the CLI relies on server shell access.

import crypto from 'node:crypto';
import { pool } from '../../infra/db/postgres.js';

export class PlatformError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `IPM-${block()}-${block()}`;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'org';
}

async function writeEvent(
  eventType: string,
  actorId: string | null,
  orgId: string | null,
  payload: Record<string, unknown>,
) {
  await pool.query(
    `INSERT INTO events (org_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [orgId, actorId, eventType, JSON.stringify(payload)],
  );
}

// ── Orgs ────────────────────────────────────────────────────────────────

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt: string;
  memberCount: number;
  workspaceCount: number;
}

export async function listOrgs(): Promise<OrgSummary[]> {
  const res = await pool.query<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    created_at: string;
    member_count: string;
    workspace_count: string;
  }>(
    `SELECT o.id, o.name, o.slug, o.plan, o.status, o.created_at,
            (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id AND m.status = 'active') AS member_count,
            (SELECT COUNT(*) FROM workspaces w WHERE w.org_id = o.id) AS workspace_count
       FROM orgs o
      ORDER BY o.created_at ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    plan: r.plan,
    status: r.status,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    workspaceCount: Number(r.workspace_count),
  }));
}

export async function getOrgDetail(orgId: string) {
  const orgRes = await pool.query<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    created_at: string;
  }>(`SELECT id, name, slug, plan, status, created_at FROM orgs WHERE id = $1`, [orgId]);
  const org = orgRes.rows[0];
  if (!org) throw new PlatformError(404, 'ORG_NOT_FOUND', '企业不存在。');

  const members = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    status: string;
    joined_at: string | null;
  }>(
    `SELECT m.user_id, u.email, u.display_name, m.role, m.status, m.joined_at
       FROM org_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1
      ORDER BY m.created_at ASC`,
    [orgId],
  );

  const wsRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM workspaces WHERE org_id = $1`,
    [orgId],
  );

  return {
    ...org,
    createdAt: org.created_at,
    workspaceCount: Number(wsRes.rows[0]?.count ?? 0),
    members: members.rows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      displayName: m.display_name,
      role: m.role,
      status: m.status,
      joinedAt: m.joined_at,
    })),
  };
}

export async function createOrg(params: {
  name: string;
  slug?: string;
  plan?: string;
  actorId: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new PlatformError(400, 'INVALID_NAME', '企业名称不能为空。');

  let slug = (params.slug ?? slugify(name)).trim().toLowerCase();
  const slugTaken = await pool.query(`SELECT 1 FROM orgs WHERE slug = $1`, [slug]);
  if ((slugTaken.rowCount ?? 0) > 0) {
    if (params.slug) throw new PlatformError(409, 'SLUG_TAKEN', `slug 已被占用：${slug}`);
    slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
  }

  const res = await pool.query<{ id: string }>(
    `INSERT INTO orgs (name, slug, plan, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [name, slug, params.plan ?? 'standard', params.actorId],
  );
  const orgId = res.rows[0].id;
  await writeEvent('platform.org_created', params.actorId, orgId, { name, slug });
  return { orgId, name, slug };
}

export async function setOrgStatus(params: {
  orgId: string;
  status: 'active' | 'disabled';
  actorId: string | null;
}) {
  const res = await pool.query<{ id: string; status: string }>(
    `UPDATE orgs SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status`,
    [params.orgId, params.status],
  );
  if (res.rowCount === 0) throw new PlatformError(404, 'ORG_NOT_FOUND', '企业不存在。');
  await writeEvent(
    params.status === 'disabled' ? 'platform.org_disabled' : 'platform.org_restored',
    params.actorId,
    params.orgId,
    {},
  );
  return res.rows[0];
}

/**
 * Assign (or promote) a user as org owner by email. Does not demote existing
 * owners — multiple owners are allowed by design (H1 decision).
 */
export async function assignOwner(params: { orgId: string; email: string; actorId: string | null }) {
  const email = params.email.trim().toLowerCase();
  const userRes = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  const user = userRes.rows[0];
  if (!user) throw new PlatformError(404, 'USER_NOT_FOUND', `用户不存在：${email}`);

  const orgRes = await pool.query(`SELECT 1 FROM orgs WHERE id = $1`, [params.orgId]);
  if (orgRes.rowCount === 0) throw new PlatformError(404, 'ORG_NOT_FOUND', '企业不存在。');

  await pool.query(
    `INSERT INTO org_members (org_id, user_id, role, status, joined_at)
     VALUES ($1, $2, 'owner', 'active', now())
     ON CONFLICT (org_id, user_id)
       DO UPDATE SET role = 'owner', status = 'active', updated_at = now()`,
    [params.orgId, user.id],
  );
  await writeEvent('platform.owner_assigned', params.actorId, params.orgId, { email, userId: user.id });
  return { userId: user.id, email };
}

export async function createInvite(params: {
  orgId: string;
  role?: 'owner' | 'admin' | 'member';
  maxUses?: number;
  expiresDays?: number | null;
  actorId: string | null;
}) {
  const role = params.role ?? 'member';
  const maxUses = params.maxUses ?? 50;
  const orgRes = await pool.query<{ name: string }>(`SELECT name FROM orgs WHERE id = $1`, [params.orgId]);
  if (orgRes.rowCount === 0) throw new PlatformError(404, 'ORG_NOT_FOUND', '企业不存在。');

  const code = generateInviteCode();
  const expiresAt = params.expiresDays
    ? new Date(Date.now() + params.expiresDays * 86400_000).toISOString()
    : null;

  await pool.query(
    `INSERT INTO invite_codes (org_id, code, role, max_uses, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.orgId, code, role, maxUses, expiresAt],
  );
  await writeEvent('platform.invite_created', params.actorId, params.orgId, { role, maxUses, expiresAt });
  return { code, orgName: orgRes.rows[0].name, role, maxUses, expiresAt };
}

// ── Platform admins ─────────────────────────────────────────────────────

export async function listPlatformAdmins() {
  const res = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    note: string | null;
    created_at: string;
  }>(
    `SELECT pa.user_id, u.email, u.display_name, pa.note, pa.created_at
       FROM platform_admins pa
       JOIN users u ON u.id = pa.user_id
      ORDER BY pa.created_at ASC`,
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// ── H7: Platform audit & global stats ───────────────────────────────────

/**
 * Platform-level audit feed. Defaults to `platform.*` events across all orgs;
 * `type`/`orgId` narrow it, cursor pagination uses `created_at` descending.
 */
export async function listPlatformEvents(filter: {
  type?: string;
  orgId?: string;
  limit: number;
  before?: string;
}) {
  const conds: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, val: unknown) => {
    args.push(val);
    conds.push(sql.replace('$$', `$${args.length}`));
  };
  if (filter.type) {
    add('e.event_type = $$', filter.type);
  } else {
    conds.push("e.event_type LIKE 'platform.%'");
  }
  if (filter.orgId) add('e.org_id = $$', filter.orgId);
  if (filter.before) add('e.created_at < $$', filter.before);

  args.push(filter.limit + 1);
  const limitIdx = args.length;
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const res = await pool.query<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
    actor_id: string | null;
    actor_email: string | null;
    actor_name: string | null;
    org_id: string | null;
    org_name: string | null;
  }>(
    `SELECT e.id, e.event_type, e.payload, e.created_at, e.actor_id,
            u.email AS actor_email, u.display_name AS actor_name,
            e.org_id, o.name AS org_name
       FROM events e
       LEFT JOIN users u ON u.id = e.actor_id
       LEFT JOIN orgs o ON o.id = e.org_id
       ${where}
      ORDER BY e.created_at DESC
      LIMIT $${limitIdx}`,
    args,
  );

  const rows = res.rows.slice(0, filter.limit);
  const hasMore = res.rows.length > filter.limit;
  return {
    events: rows.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      payload: e.payload,
      createdAt: e.created_at,
      actorId: e.actor_id,
      actorEmail: e.actor_email,
      actorName: e.actor_name,
      orgId: e.org_id,
      orgName: e.org_name,
    })),
    hasMore,
    nextBefore: hasMore ? rows[rows.length - 1]?.created_at ?? null : null,
  };
}

/** Global platform overview for the console home. */
export async function getPlatformStats() {
  const res = await pool.query<{
    org_total: string;
    org_active: string;
    org_disabled: string;
    user_total: string;
    user_active: string;
    workspace_total: string;
    admin_total: string;
  }>(
    `SELECT
        (SELECT COUNT(*) FROM orgs) AS org_total,
        (SELECT COUNT(*) FROM orgs WHERE status = 'active') AS org_active,
        (SELECT COUNT(*) FROM orgs WHERE status = 'disabled') AS org_disabled,
        (SELECT COUNT(*) FROM users) AS user_total,
        (SELECT COUNT(*) FROM users WHERE status = 'active') AS user_active,
        (SELECT COUNT(*) FROM workspaces) AS workspace_total,
        (SELECT COUNT(*) FROM platform_admins) AS admin_total`,
  );
  const r = res.rows[0];
  return {
    orgs: {
      total: Number(r?.org_total ?? 0),
      active: Number(r?.org_active ?? 0),
      disabled: Number(r?.org_disabled ?? 0),
    },
    users: {
      total: Number(r?.user_total ?? 0),
      active: Number(r?.user_active ?? 0),
    },
    workspaces: { total: Number(r?.workspace_total ?? 0) },
    platformAdmins: { total: Number(r?.admin_total ?? 0) },
  };
}

export async function grantPlatformAdmin(params: {
  email: string;
  note?: string;
  grantedBy?: string | null;
}) {
  const email = params.email.trim().toLowerCase();
  const userRes = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  const user = userRes.rows[0];
  if (!user) throw new PlatformError(404, 'USER_NOT_FOUND', `用户不存在：${email}`);

  await pool.query(
    `INSERT INTO platform_admins (user_id, granted_by, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id, params.grantedBy ?? null, params.note ?? null],
  );
  await writeEvent('platform.admin_granted', params.grantedBy ?? null, null, { email, userId: user.id });
  return { userId: user.id, email };
}

export async function revokePlatformAdmin(params: { email: string; actorId?: string | null }) {
  const email = params.email.trim().toLowerCase();
  const res = await pool.query<{ user_id: string }>(
    `DELETE FROM platform_admins pa
      USING users u
      WHERE pa.user_id = u.id AND u.email = $1
      RETURNING pa.user_id`,
    [email],
  );
  if (res.rowCount === 0) throw new PlatformError(404, 'ADMIN_NOT_FOUND', `不是平台管理员：${email}`);
  await writeEvent('platform.admin_revoked', params.actorId ?? null, null, { email });
  return { email };
}
