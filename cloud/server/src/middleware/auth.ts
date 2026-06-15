// C3.5 Auth middleware, hardened in H1.
//
// Resolves the acting user for each request and decorates:
//   * `request.userId` / `request.orgId` — identity from the JWT.
//   * `request.orgRole` — the user's role inside `request.orgId` (H2+ relies
//     on this being authoritative and fresh).
//   * `request.isPlatformAdmin` — per-request lookup against
//     `platform_admins` (no JWT claim, so revocation is instant).
//
// H1 enforcement (audit A1/A2/A6): every authenticated request re-validates
// `users.status`, `org_members.status` and `orgs.status` in a single query.
// Disabling a user, a member or a whole org therefore takes effect
// immediately, without a token blacklist.
//
// Resolution order:
//   1. `Authorization: Bearer <jwt>` — the real auth path (all environments).
//   2. `X-Dev-User-Id` — development-only fallback kept for local tooling.
//
// Public paths (health, auth entry points) bypass the check entirely.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { pool } from '../infra/db/postgres.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    orgId: string | null;
    orgRole: string | null;
    isPlatformAdmin: boolean;
  }
}

// Exact public paths or prefixes that never require authentication.
const PUBLIC_EXACT = new Set([
  '/',
  '/health',
  '/auth/status',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
]);

// `/platform-console` serves the static console shell (HTML/CSS/JS). The shell
// loads unauthenticated; the data it shows comes from `/api/platform/**`, which
// stays behind the platform-admin gate below.
const PUBLIC_PREFIXES = ['/health/', '/platform-console'];

const PLATFORM_PREFIX = '/api/platform/';

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isPlatformPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return path.startsWith(PLATFORM_PREFIX);
}

interface StatusRow {
  user_status: string;
  is_platform_admin: boolean;
  member_role: string | null;
  member_status: string | null;
  org_status: string | null;
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('userId', null);
  app.decorateRequest('orgId', null);
  app.decorateRequest('orgRole', null);
  app.decorateRequest('isPlatformAdmin', false);

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url)) return;

    // ── 1. Resolve identity ─────────────────────────────────────────
    const authHeader = request.headers['authorization'];
    const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (bearer && bearer.startsWith('Bearer ')) {
      const token = bearer.slice('Bearer '.length).trim();
      try {
        const payload = verifyAccessToken(token);
        request.userId = payload.sub;
        request.orgId = payload.orgId ?? null;
      } catch {
        return reply.code(401).send({ ok: false, code: 'TOKEN_EXPIRED', error: '登录已过期，请重新登录。' });
      }
    } else if (env.NODE_ENV !== 'production') {
      // Dev fallback (development only).
      const header = request.headers['x-dev-user-id'];
      const devUserId = Array.isArray(header) ? header[0] : header;
      if (devUserId && typeof devUserId === 'string') {
        request.userId = devUserId;
        const orgRes = await pool.query<{ org_id: string }>(
          `SELECT org_id FROM org_members WHERE user_id = $1 AND status = 'active' LIMIT 1`,
          [devUserId],
        );
        request.orgId = orgRes.rows[0]?.org_id ?? null;
      }
    }

    if (!request.userId) {
      return reply.code(401).send({ ok: false, code: 'UNAUTHENTICATED', error: '未认证，请先登录。' });
    }

    // ── 2. Re-validate user / member / org status in one query ──────
    const statusRes = await pool.query<StatusRow>(
      `SELECT u.status AS user_status,
              (pa.id IS NOT NULL) AS is_platform_admin,
              m.role AS member_role,
              m.status AS member_status,
              o.status AS org_status
         FROM users u
         LEFT JOIN platform_admins pa ON pa.user_id = u.id
         LEFT JOIN org_members m ON m.user_id = u.id AND m.org_id = $2
         LEFT JOIN orgs o ON o.id = m.org_id
        WHERE u.id = $1`,
      [request.userId, request.orgId],
    );
    const row = statusRes.rows[0];
    if (!row) {
      return reply.code(401).send({ ok: false, code: 'USER_NOT_FOUND', error: '账号不存在，请重新登录。' });
    }
    if (row.user_status !== 'active') {
      return reply.code(403).send({ ok: false, code: 'USER_DISABLED', error: '账号已被禁用，请联系管理员。' });
    }
    request.isPlatformAdmin = row.is_platform_admin;

    // ── 3. Platform routes: platform admins only ────────────────────
    if (isPlatformPath(request.url)) {
      if (!row.is_platform_admin) {
        return reply.code(403).send({ ok: false, code: 'PLATFORM_FORBIDDEN', error: '无平台管理权限。' });
      }
      return;
    }

    // ── 4. Org-scoped requests: enforce member + org status ─────────
    if (request.orgId) {
      if (!row.member_role || !row.member_status) {
        return reply.code(403).send({ ok: false, code: 'MEMBER_NOT_FOUND', error: '账号不属于该组织。' });
      }
      if (row.org_status !== 'active') {
        return reply.code(403).send({ ok: false, code: 'ORG_DISABLED', error: '企业已被停用，请联系平台管理员。' });
      }
      if (row.member_status !== 'active') {
        return reply.code(403).send({ ok: false, code: 'MEMBER_DISABLED', error: '账号已被企业停用，请联系企业管理员。' });
      }
      request.orgRole = row.member_role;
    }
  });
}
