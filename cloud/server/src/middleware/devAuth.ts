// C3: Development-only authentication.
//
// Instead of a real login, the desktop client sends the acting user's id in
// the `X-Dev-User-Id` header. This middleware reads it and decorates the
// request with `request.userId`. Real JWT-based auth replaces this between
// C3 and C4.
//
// Routes that should stay public (health, root, auth status) are matched by
// an allowlist of path prefixes.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

const PUBLIC_PREFIXES = ['/health', '/auth'];

function isPublicPath(url: string): boolean {
  // Strip query string before matching.
  const path = url.split('?')[0] ?? url;
  if (path === '/') return true;
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function registerDevAuth(app: FastifyInstance) {
  app.decorateRequest('userId', null);

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url)) return;

    // In production this middleware must not be the line of defense.
    if (env.NODE_ENV === 'production') {
      reply.code(501).send({
        ok: false,
        error: 'Dev auth is disabled in production; real auth not yet implemented.',
      });
      return;
    }

    const header = request.headers['x-dev-user-id'];
    const userId = Array.isArray(header) ? header[0] : header;
    if (!userId || typeof userId !== 'string') {
      reply.code(401).send({
        ok: false,
        error: 'Missing X-Dev-User-Id header.',
      });
      return;
    }

    request.userId = userId;
  });
}
