// H3 (audit A4): workspace status semantics, enforced on every route.
//
//   * active   — normal collaboration.
//   * archived — read-only: members may pull, list versions and download
//                history, but every mutating action is rejected.
//   * disabled — fully blocked: every workspace endpoint rejects, and the
//                workspace disappears from member-facing lists.
//
// One query resolves membership + workspace status together; route handlers
// call `requireWorkspaceAccess` with the action kind and bail out when it
// returns null (the error response has already been sent).

import type { FastifyReply } from 'fastify';
import { pool } from '../../infra/db/postgres.js';

/** Minimal interface satisfied by both `pool` and a checked-out client. */
interface Queryable {
  query: typeof pool.query;
}

export interface WorkspaceAccess {
  role: string;
  orgId: string;
  status: string;
}

export async function getWorkspaceAccess(
  workspaceId: string,
  userId: string,
  db: Queryable = pool,
): Promise<WorkspaceAccess | null> {
  const res = await db.query<{ role: string; org_id: string; status: string }>(
    `SELECT wm.role, w.org_id, w.status
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
    [workspaceId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { role: row.role, orgId: row.org_id, status: row.status };
}

/**
 * Resolve membership and gate on workspace status. `mode: 'read'` allows
 * active+archived; `mode: 'write'` allows active only. Returns null after
 * sending the error response when access is denied.
 */
export async function requireWorkspaceAccess(
  reply: FastifyReply,
  workspaceId: string,
  userId: string,
  mode: 'read' | 'write',
  db: Queryable = pool,
): Promise<WorkspaceAccess | null> {
  const access = await getWorkspaceAccess(workspaceId, userId, db);
  if (!access) {
    // H4 (privacy-first): non-members get a plain 404 so a private
    // workspace's existence cannot be probed by id.
    reply.code(404).send({ ok: false, code: 'NOT_WORKSPACE_MEMBER', error: 'Workspace not found.' });
    return null;
  }
  if (access.status === 'disabled') {
    reply.code(403).send({ ok: false, code: 'WORKSPACE_DISABLED', error: '该项目已被企业停用。' });
    return null;
  }
  if (mode === 'write' && access.status === 'archived') {
    reply.code(403).send({ ok: false, code: 'WORKSPACE_ARCHIVED', error: '该项目已归档（只读），无法推送变更。' });
    return null;
  }
  return access;
}
