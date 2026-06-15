// H2 Enterprise Admin: org member & invite management business logic.
//
// Permission model (H2 decisions):
//   * Owners are immutable through this module — role changes and disabling
//     of owners go through the platform API only.
//   * Admins manage members only (invite member, disable/restore member).
//     Admin-level changes (invite admin, promote/demote/disable admin) are
//     owner-only.
//   * Nobody can disable themselves (prevents lock-out).
//
// Role/permission checks that depend on the *actor* are done here; routes
// pass the actor's fresh `request.orgRole` from the auth middleware.

import crypto from 'node:crypto';
import { pool } from '../../infra/db/postgres.js';

export class OrgError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

type OrgRole = 'owner' | 'admin' | 'member';

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `IPM-${block()}-${block()}`;
}

async function writeEvent(
  orgId: string,
  actorId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await pool.query(
    `INSERT INTO events (org_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [orgId, actorId, eventType, JSON.stringify(payload)],
  );
}

// ── Org info ────────────────────────────────────────────────────────────

export async function getOrgInfo(orgId: string) {
  const res = await pool.query<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    created_at: string;
    member_count: string;
    active_member_count: string;
    admin_count: string;
    workspace_count: string;
  }>(
    `SELECT o.id, o.name, o.slug, o.plan, o.status, o.created_at,
            (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS member_count,
            (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id AND m.status = 'active') AS active_member_count,
            (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id AND m.role IN ('owner','admin') AND m.status = 'active') AS admin_count,
            (SELECT COUNT(*) FROM workspaces w WHERE w.org_id = o.id) AS workspace_count
       FROM orgs o
      WHERE o.id = $1`,
    [orgId],
  );
  const org = res.rows[0];
  if (!org) throw new OrgError(404, 'ORG_NOT_FOUND', '企业不存在。');
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    status: org.status,
    createdAt: org.created_at,
    memberCount: Number(org.member_count),
    activeMemberCount: Number(org.active_member_count),
    adminCount: Number(org.admin_count),
    workspaceCount: Number(org.workspace_count),
  };
}

// ── Members ─────────────────────────────────────────────────────────────

export async function listMembers(orgId: string) {
  const res = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    status: string;
    joined_at: string | null;
    last_login_at: string | null;
    last_active_at: string | null;
    last_event_type: string | null;
  }>(
    `SELECT m.user_id, u.email, u.display_name, m.role, m.status, m.joined_at,
            u.last_login_at, ev.created_at AS last_active_at, ev.event_type AS last_event_type
       FROM org_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN LATERAL (
         SELECT e.created_at, e.event_type
           FROM events e
          WHERE e.org_id = m.org_id AND e.actor_id = m.user_id
          ORDER BY e.created_at DESC
          LIMIT 1
       ) ev ON true
      WHERE m.org_id = $1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
               m.joined_at NULLS LAST`,
    [orgId],
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    status: r.status,
    joinedAt: r.joined_at,
    lastLoginAt: r.last_login_at,
    lastActiveAt: r.last_active_at,
    lastEventType: r.last_event_type,
  }));
}

async function getMember(orgId: string, userId: string) {
  const res = await pool.query<{ role: string; status: string; display_name: string }>(
    `SELECT m.role, m.status, u.display_name
       FROM org_members m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.user_id = $2`,
    [orgId, userId],
  );
  return res.rows[0] ?? null;
}

export async function setMemberRole(params: {
  orgId: string;
  actorId: string;
  actorRole: OrgRole;
  targetUserId: string;
  role: 'admin' | 'member';
}) {
  if (params.actorRole !== 'owner') {
    throw new OrgError(403, 'ORG_FORBIDDEN', '只有企业 owner 可以调整成员角色。');
  }
  const target = await getMember(params.orgId, params.targetUserId);
  if (!target) throw new OrgError(404, 'MEMBER_NOT_FOUND', '成员不存在。');
  if (target.role === 'owner') {
    throw new OrgError(403, 'OWNER_IMMUTABLE', 'owner 由平台管理，企业内无法调整。');
  }
  if (target.role === params.role) {
    return { role: params.role, changed: false };
  }
  await pool.query(
    `UPDATE org_members SET role = $3, updated_at = now()
      WHERE org_id = $1 AND user_id = $2`,
    [params.orgId, params.targetUserId, params.role],
  );
  await writeEvent(params.orgId, params.actorId, 'org.member_role_changed', {
    targetUserId: params.targetUserId,
    from: target.role,
    to: params.role,
  });
  return { role: params.role, changed: true };
}

export async function setMemberStatus(params: {
  orgId: string;
  actorId: string;
  actorRole: OrgRole;
  targetUserId: string;
  status: 'active' | 'disabled';
}) {
  if (params.actorRole !== 'owner' && params.actorRole !== 'admin') {
    throw new OrgError(403, 'ORG_FORBIDDEN', '需要企业管理员权限。');
  }
  if (params.targetUserId === params.actorId && params.status === 'disabled') {
    throw new OrgError(403, 'CANNOT_DISABLE_SELF', '不能停用自己的账号。');
  }
  const target = await getMember(params.orgId, params.targetUserId);
  if (!target) throw new OrgError(404, 'MEMBER_NOT_FOUND', '成员不存在。');
  if (target.role === 'owner') {
    throw new OrgError(403, 'OWNER_IMMUTABLE', 'owner 由平台管理，企业内无法停用。');
  }
  if (target.role === 'admin' && params.actorRole !== 'owner') {
    throw new OrgError(403, 'ORG_FORBIDDEN', '只有企业 owner 可以停用/恢复管理员。');
  }
  await pool.query(
    `UPDATE org_members SET status = $3, updated_at = now()
      WHERE org_id = $1 AND user_id = $2`,
    [params.orgId, params.targetUserId, params.status],
  );
  await writeEvent(
    params.orgId,
    params.actorId,
    params.status === 'disabled' ? 'org.member_disabled' : 'org.member_restored',
    { targetUserId: params.targetUserId, targetRole: target.role },
  );
  return { status: params.status };
}

// ── Invites ─────────────────────────────────────────────────────────────

export async function listInvites(orgId: string) {
  const res = await pool.query<{
    id: string;
    code: string;
    role: string;
    max_uses: number;
    used_count: number;
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string;
    created_by_name: string | null;
  }>(
    `SELECT ic.id, ic.code, ic.role, ic.max_uses, ic.used_count,
            ic.expires_at, ic.revoked_at, ic.created_at,
            u.display_name AS created_by_name
       FROM invite_codes ic
       LEFT JOIN users u ON u.id = ic.created_by
      WHERE ic.org_id = $1
      ORDER BY ic.created_at DESC`,
    [orgId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    role: r.role,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
  }));
}

export async function createInvite(params: {
  orgId: string;
  actorId: string;
  actorRole: OrgRole;
  role: 'admin' | 'member';
  maxUses: number;
  expiresDays: number | null;
}) {
  if (params.actorRole !== 'owner' && params.actorRole !== 'admin') {
    throw new OrgError(403, 'ORG_FORBIDDEN', '需要企业管理员权限。');
  }
  if (params.role === 'admin' && params.actorRole !== 'owner') {
    throw new OrgError(403, 'ORG_FORBIDDEN', '只有企业 owner 可以创建管理员邀请码。');
  }
  const code = generateInviteCode();
  const expiresAt = params.expiresDays
    ? new Date(Date.now() + params.expiresDays * 86400_000).toISOString()
    : null;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO invite_codes (org_id, code, role, max_uses, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [params.orgId, code, params.role, params.maxUses, expiresAt, params.actorId],
  );
  await writeEvent(params.orgId, params.actorId, 'org.invite_created', {
    inviteId: res.rows[0].id,
    role: params.role,
    maxUses: params.maxUses,
    expiresAt,
  });
  return { id: res.rows[0].id, code, role: params.role, maxUses: params.maxUses, expiresAt };
}

// ── Workspace governance (H3) ───────────────────────────────────────────
// Enterprise admins see and govern every workspace in the org regardless of
// their own workspace membership. Governance never touches local files.

const INACTIVE_DAYS = 30;

interface OrgWorkspaceRow {
  id: string;
  domain: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  current_version_number: number | null;
  member_count: number;
  version_count: number;
  last_version_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_org_status: string | null;
  owner_user_status: string | null;
}

function computeRisks(r: OrgWorkspaceRow): string[] {
  const risks: string[] = [];
  if (!r.owner_id) {
    risks.push('NO_OWNER');
  } else if (r.owner_org_status !== 'active' || r.owner_user_status !== 'active') {
    risks.push('OWNER_DISABLED');
  }
  if (!r.current_version_id) {
    risks.push('NO_VERSION');
  } else if (r.status === 'active') {
    const last = new Date(r.last_version_at ?? r.updated_at).getTime();
    if (Number.isFinite(last) && Date.now() - last > INACTIVE_DAYS * 86400_000) {
      risks.push('INACTIVE');
    }
  }
  return risks;
}

function mapOrgWorkspace(r: OrgWorkspaceRow) {
  return {
    id: r.id,
    domain: r.domain,
    name: r.name,
    description: r.description,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    currentVersionNumber: r.current_version_number,
    memberCount: r.member_count,
    versionCount: r.version_count,
    lastVersionAt: r.last_version_at,
    owner: r.owner_id
      ? {
          userId: r.owner_id,
          displayName: r.owner_name,
          email: r.owner_email,
          orgStatus: r.owner_org_status,
          userStatus: r.owner_user_status,
        }
      : null,
    risks: computeRisks(r),
  };
}

const ORG_WORKSPACE_SELECT = `
  SELECT w.id, w.domain, w.name, w.description, w.status, w.created_at, w.updated_at,
         w.current_version_id,
         (SELECT v.version_number FROM versions v WHERE v.id = w.current_version_id) AS current_version_number,
         (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
         (SELECT count(*)::int FROM versions v WHERE v.workspace_id = w.id) AS version_count,
         (SELECT max(v.created_at) FROM versions v WHERE v.workspace_id = w.id) AS last_version_at,
         ow.user_id AS owner_id, ou.display_name AS owner_name, ou.email AS owner_email,
         oom.status AS owner_org_status, ou.status AS owner_user_status
    FROM workspaces w
    LEFT JOIN LATERAL (
      SELECT wm.user_id FROM workspace_members wm
       WHERE wm.workspace_id = w.id AND wm.role = 'owner'
       ORDER BY wm.created_at LIMIT 1
    ) ow ON true
    LEFT JOIN users ou ON ou.id = ow.user_id
    LEFT JOIN org_members oom ON oom.org_id = w.org_id AND oom.user_id = ow.user_id`;

export async function listOrgWorkspaces(orgId: string) {
  const res = await pool.query<OrgWorkspaceRow>(
    `${ORG_WORKSPACE_SELECT}
      WHERE w.org_id = $1
      ORDER BY w.updated_at DESC`,
    [orgId],
  );
  return res.rows.map(mapOrgWorkspace);
}

export async function getOrgWorkspaceDetail(orgId: string, workspaceId: string) {
  const wsRes = await pool.query<OrgWorkspaceRow>(
    `${ORG_WORKSPACE_SELECT}
      WHERE w.org_id = $1 AND w.id = $2`,
    [orgId, workspaceId],
  );
  const row = wsRes.rows[0];
  if (!row) throw new OrgError(404, 'WORKSPACE_NOT_FOUND', '项目不存在。');

  const [members, versions, stats, events] = await Promise.all([
    pool.query<{
      user_id: string;
      display_name: string;
      email: string;
      role: string;
      joined_at: string;
      org_status: string | null;
      user_status: string;
    }>(
      `SELECT wm.user_id, u.display_name, u.email, wm.role, wm.created_at AS joined_at,
              om.status AS org_status, u.status AS user_status
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN org_members om ON om.org_id = $1 AND om.user_id = wm.user_id
        WHERE wm.workspace_id = $2
        ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, wm.created_at`,
      [orgId, workspaceId],
    ),
    pool.query<{
      id: string;
      version_number: number;
      type: string;
      label: string | null;
      message: string;
      author_name: string | null;
      created_at: string;
    }>(
      `SELECT v.id, v.version_number, v.type, v.label, v.message,
              u.display_name AS author_name, v.created_at
         FROM versions v
         LEFT JOIN users u ON u.id = v.author_id
        WHERE v.workspace_id = $1
        ORDER BY v.version_number DESC
        LIMIT 10`,
      [workspaceId],
    ),
    row.current_version_id
      ? pool.query<{ file_count: number; total_bytes: string | null }>(
          `SELECT count(*)::int AS file_count, sum(size_bytes) AS total_bytes
             FROM (SELECT DISTINCT o.id, o.size_bytes
                     FROM version_entries ve
                     JOIN objects o ON o.id = ve.object_id
                    WHERE ve.version_id = $1
                      AND ve.entry_type = 'file'
                      AND ve.status = 'active') t`,
          [row.current_version_id],
        )
      : Promise.resolve(null),
    pool.query<{
      id: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: string;
      actor_name: string | null;
    }>(
      `SELECT e.id, e.event_type, e.payload, e.created_at, u.display_name AS actor_name
         FROM events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.workspace_id = $1
        ORDER BY e.created_at DESC
        LIMIT 20`,
      [workspaceId],
    ),
  ]);

  return {
    workspace: mapOrgWorkspace(row),
    stats: {
      fileCount: stats?.rows[0]?.file_count ?? 0,
      totalBytes: stats?.rows[0]?.total_bytes ? Number(stats.rows[0].total_bytes) : 0,
    },
    members: members.rows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
      role: m.role,
      joinedAt: m.joined_at,
      orgStatus: m.org_status,
      userStatus: m.user_status,
    })),
    recentVersions: versions.rows.map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      type: v.type,
      label: v.label,
      message: v.message,
      authorName: v.author_name,
      createdAt: v.created_at,
    })),
    recentEvents: events.rows.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      payload: e.payload,
      createdAt: e.created_at,
      actorName: e.actor_name,
    })),
  };
}

async function getOrgWorkspace(orgId: string, workspaceId: string) {
  const res = await pool.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM workspaces WHERE id = $1 AND org_id = $2`,
    [workspaceId, orgId],
  );
  return res.rows[0] ?? null;
}

export async function setWorkspaceStatus(params: {
  orgId: string;
  actorId: string;
  workspaceId: string;
  status: 'active' | 'archived' | 'disabled';
}) {
  const ws = await getOrgWorkspace(params.orgId, params.workspaceId);
  if (!ws) throw new OrgError(404, 'WORKSPACE_NOT_FOUND', '项目不存在。');
  if (ws.status === params.status) {
    return { status: params.status, changed: false };
  }
  await pool.query(
    `UPDATE workspaces SET status = $3, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [params.workspaceId, params.orgId, params.status],
  );
  const eventType =
    params.status === 'archived'
      ? 'workspace.archived'
      : params.status === 'disabled'
        ? 'workspace.disabled'
        : 'workspace.restored';
  await pool.query(
    `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [params.orgId, params.workspaceId, params.actorId, eventType, JSON.stringify({ from: ws.status, to: params.status })],
  );
  return { status: params.status, changed: true };
}

export async function transferWorkspaceOwner(params: {
  orgId: string;
  actorId: string;
  workspaceId: string;
  newOwnerId: string;
}) {
  const ws = await getOrgWorkspace(params.orgId, params.workspaceId);
  if (!ws) throw new OrgError(404, 'WORKSPACE_NOT_FOUND', '项目不存在。');

  // The new owner must already be a workspace member with an active org account.
  const target = await pool.query<{ role: string; org_status: string | null; user_status: string }>(
    `SELECT wm.role, om.status AS org_status, u.status AS user_status
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN org_members om ON om.org_id = $1 AND om.user_id = wm.user_id
      WHERE wm.workspace_id = $2 AND wm.user_id = $3`,
    [params.orgId, params.workspaceId, params.newOwnerId],
  );
  const t = target.rows[0];
  if (!t) throw new OrgError(404, 'MEMBER_NOT_FOUND', '目标用户不是该项目成员。');
  if (t.role === 'owner') {
    return { changed: false };
  }
  if (t.org_status !== 'active' || t.user_status !== 'active') {
    throw new OrgError(409, 'MEMBER_DISABLED', '目标成员的企业账号未处于正常状态。');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prev = await client.query<{ user_id: string }>(
      `UPDATE workspace_members SET role = 'editor', updated_at = now()
        WHERE workspace_id = $1 AND role = 'owner'
        RETURNING user_id`,
      [params.workspaceId],
    );
    await client.query(
      `UPDATE workspace_members SET role = 'owner', updated_at = now()
        WHERE workspace_id = $1 AND user_id = $2`,
      [params.workspaceId, params.newOwnerId],
    );
    await client.query(
      `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
       VALUES ($1, $2, $3, 'workspace.owner_transferred', $4::jsonb)`,
      [
        params.orgId,
        params.workspaceId,
        params.actorId,
        JSON.stringify({ from: prev.rows[0]?.user_id ?? null, to: params.newOwnerId }),
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { changed: true };
}

export async function removeWorkspaceMember(params: {
  orgId: string;
  actorId: string;
  workspaceId: string;
  targetUserId: string;
}) {
  const ws = await getOrgWorkspace(params.orgId, params.workspaceId);
  if (!ws) throw new OrgError(404, 'WORKSPACE_NOT_FOUND', '项目不存在。');

  const target = await pool.query<{ role: string }>(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [params.workspaceId, params.targetUserId],
  );
  const t = target.rows[0];
  if (!t) throw new OrgError(404, 'MEMBER_NOT_FOUND', '目标用户不是该项目成员。');
  if (t.role === 'owner') {
    throw new OrgError(409, 'OWNER_MUST_TRANSFER', '项目 owner 需先转移所有权才能移出。');
  }

  await pool.query(
    `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [params.workspaceId, params.targetUserId],
  );
  await pool.query(
    `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, 'workspace.member_removed', $4::jsonb)`,
    [params.orgId, params.workspaceId, params.actorId, JSON.stringify({ targetUserId: params.targetUserId, targetRole: t.role })],
  );
  return { removed: true };
}

export async function revokeInvite(params: { orgId: string; actorId: string; actorRole: OrgRole; inviteId: string }) {
  if (params.actorRole !== 'owner' && params.actorRole !== 'admin') {
    throw new OrgError(403, 'ORG_FORBIDDEN', '需要企业管理员权限。');
  }
  const res = await pool.query<{ code: string; revoked_at: string | null }>(
    `SELECT code, revoked_at FROM invite_codes WHERE id = $1 AND org_id = $2`,
    [params.inviteId, params.orgId],
  );
  const invite = res.rows[0];
  if (!invite) throw new OrgError(404, 'INVITE_NOT_FOUND', '邀请码不存在。');
  if (invite.revoked_at) {
    return { revoked: false };
  }
  await pool.query(`UPDATE invite_codes SET revoked_at = now() WHERE id = $1`, [params.inviteId]);
  await writeEvent(params.orgId, params.actorId, 'org.invite_revoked', {
    inviteId: params.inviteId,
    code: invite.code,
  });
  return { revoked: true };
}

// ── H7: Enterprise stats & audit ─────────────────────────────────────────

/**
 * Aggregate enterprise-wide metrics for the owner/admin dashboard. Each block
 * is a small grouped count so the whole thing stays a handful of cheap queries
 * against already-indexed columns.
 */
export async function getOrgStats(orgId: string) {
  const [members, workspaces, versions, skills, installs, templates] = await Promise.all([
    pool.query<{ role: string; status: string; n: string }>(
      `SELECT role, status, COUNT(*) AS n FROM org_members WHERE org_id = $1 GROUP BY role, status`,
      [orgId],
    ),
    pool.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*) AS n FROM workspaces WHERE org_id = $1 GROUP BY status`,
      [orgId],
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM versions v
         JOIN workspaces w ON w.id = v.workspace_id
        WHERE w.org_id = $1`,
      [orgId],
    ),
    pool.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*) AS n FROM skills WHERE org_id = $1 GROUP BY status`,
      [orgId],
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM skill_installs WHERE org_id = $1`,
      [orgId],
    ),
    pool.query<{ status: string; n: string; used: string }>(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(used_count), 0) AS used
         FROM org_config_templates WHERE org_id = $1 GROUP BY status`,
      [orgId],
    ),
  ]);

  const memberByRole = { owner: 0, admin: 0, member: 0 };
  let memberTotal = 0;
  let memberActive = 0;
  let memberDisabled = 0;
  for (const r of members.rows) {
    const n = Number(r.n);
    memberTotal += n;
    if (r.status === 'active') {
      memberActive += n;
      if (r.role in memberByRole) memberByRole[r.role as keyof typeof memberByRole] += n;
    } else {
      memberDisabled += n;
    }
  }

  const wsByStatus = { active: 0, archived: 0, disabled: 0 };
  let wsTotal = 0;
  for (const r of workspaces.rows) {
    const n = Number(r.n);
    wsTotal += n;
    if (r.status in wsByStatus) wsByStatus[r.status as keyof typeof wsByStatus] += n;
  }

  const skillByStatus = { pending_review: 0, approved: 0, rejected: 0, archived: 0 };
  let skillTotal = 0;
  for (const r of skills.rows) {
    const n = Number(r.n);
    skillTotal += n;
    if (r.status in skillByStatus) skillByStatus[r.status as keyof typeof skillByStatus] += n;
  }

  let tplTotal = 0;
  let tplActive = 0;
  let tplImports = 0;
  for (const r of templates.rows) {
    const n = Number(r.n);
    tplTotal += n;
    if (r.status === 'active') tplActive += n;
    tplImports += Number(r.used);
  }

  return {
    members: {
      total: memberTotal,
      active: memberActive,
      disabled: memberDisabled,
      byRole: memberByRole,
    },
    workspaces: {
      total: wsTotal,
      ...wsByStatus,
    },
    versions: { total: Number(versions.rows[0]?.n ?? 0) },
    skills: {
      total: skillTotal,
      ...skillByStatus,
      installs: Number(installs.rows[0]?.n ?? 0),
    },
    configTemplates: {
      total: tplTotal,
      active: tplActive,
      imports: tplImports,
    },
  };
}

/**
 * Paginated, filterable audit feed scoped to one org. Cursor pagination uses
 * `created_at` descending; `before` is an ISO timestamp from the previous page.
 */
export async function listOrgEvents(
  orgId: string,
  filter: {
    type?: string;
    actorId?: string;
    workspaceId?: string;
    skillId?: string;
    templateId?: string;
    limit: number;
    before?: string;
  },
) {
  const conds: string[] = ['e.org_id = $1'];
  const args: unknown[] = [orgId];
  const add = (sql: string, val: unknown) => {
    args.push(val);
    conds.push(sql.replace('$$', `$${args.length}`));
  };
  if (filter.type) add('e.event_type = $$', filter.type);
  if (filter.actorId) add('e.actor_id = $$', filter.actorId);
  if (filter.workspaceId) add('e.workspace_id = $$', filter.workspaceId);
  if (filter.skillId) add("e.payload->>'skillId' = $$", filter.skillId);
  if (filter.templateId) add("e.payload->>'templateId' = $$", filter.templateId);
  if (filter.before) add('e.created_at < $$', filter.before);

  args.push(filter.limit + 1);
  const limitIdx = args.length;

  const res = await pool.query<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
    workspace_id: string | null;
    workspace_name: string | null;
  }>(
    `SELECT e.id, e.event_type, e.payload, e.created_at, e.actor_id,
            u.display_name AS actor_name, u.email AS actor_email,
            e.workspace_id, w.name AS workspace_name
       FROM events e
       LEFT JOIN users u ON u.id = e.actor_id
       LEFT JOIN workspaces w ON w.id = e.workspace_id
      WHERE ${conds.join(' AND ')}
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
      actorName: e.actor_name,
      actorEmail: e.actor_email,
      workspaceId: e.workspace_id,
      workspaceName: e.workspace_name,
    })),
    hasMore,
    nextBefore: hasMore ? rows[rows.length - 1]?.created_at ?? null : null,
  };
}
