// C3.5 Auth middleware.
//
// Resolves the acting user for each request and decorates `request.userId` /
// `request.orgId`.
//
// Resolution order:
//   1. `Authorization: Bearer <jwt>` — the real auth path (all environments).
//   2. `X-Dev-User-Id` — development-only fallback kept for local tooling and
//      backwards compatibility with the C3 publish harness.
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

const PUBLIC_PREFIXES = ['/health/'];

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('userId', null);
  app.decorateRequest('orgId', null);

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url)) return;

    // 1. Bearer JWT (real auth).
    const authHeader = request.headers['authorization'];
    const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (bearer && bearer.startsWith('Bearer ')) {
      const token = bearer.slice('Bearer '.length).trim();
      try {
        const payload = verifyAccessToken(token);
        request.userId = payload.sub;
        request.orgId = payload.orgId;
        return;
      } catch {
        return reply.code(401).send({ ok: false, error: '登录已过期，请重新登录。' });
      }
    }

    // 2. Dev fallback (development only).
    if (env.NODE_ENV !== 'production') {
      const header = request.headers['x-dev-user-id'];
      const devUserId = Array.isArray(header) ? header[0] : header;
      if (devUserId && typeof devUserId === 'string') {
        request.userId = devUserId;
        // Resolve org for the dev user so downstream org checks work.
        const orgRes = await pool.query<{ org_id: string }>(
          `SELECT org_id FROM org_members WHERE user_id = $1 AND status = 'active' LIMIT 1`,
          [devUserId],
        );
        request.orgId = orgRes.rows[0]?.org_id ?? null;
        return;
      }
    }

    return reply.code(401).send({ ok: false, error: '未认证，请先登录。' });
  });
}
