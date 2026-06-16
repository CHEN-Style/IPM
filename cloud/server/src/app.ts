import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { env } from './config/env.js';
import { registerAuth } from './middleware/auth.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerWorkspaceRoutes } from './modules/workspaces/routes.js';
import { registerWorkspaceManageRoutes } from './modules/workspaces/manage.js';
import { registerObjectRoutes } from './modules/objects/routes.js';
import { registerVersionRoutes } from './modules/versions/routes.js';
import { registerSkillRoutes } from './modules/skills/routes.js';
import { registerOrgConfigRoutes } from './modules/org-configs/routes.js';
import { registerPlatformRoutes } from './modules/platform/routes.js';
import { registerOrgRoutes } from './modules/org/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  // H7: keep script-src strict ('self' — the real XSS vector; the platform
  // console ships scripts as external same-origin modules), but allow inline
  // styles so the console can set dynamic colors via the CSSOM. API responses
  // are JSON, so CSP is effectively only meaningful for the console shell.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        // Direct-IP deployments may run over plain HTTP before a domain and
        // reverse proxy are configured. Helmet's default upgrade directive
        // would make browsers request the console JS over HTTPS and leave the
        // page stuck at "加载中...".
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((item) => item.trim()),
    credentials: true,
  });
  // H1 (audit A7, partial): opt-in rate limiting. Only auth entry points set a
  // per-route `config.rateLimit`; everything else is unlimited for now.
  await app.register(rateLimit, { global: false });

  // H7: serve the platform web console (pure static HTML/CSS/JS). External
  // (same-origin) assets only, so helmet's default CSP (`*-src 'self'`) is
  // enough — no inline scripts/styles to whitelist. The shell loads
  // unauthenticated (see middleware/auth PUBLIC_PREFIXES); all data comes from
  // the platform-admin-gated `/api/platform/**` endpoints.
  // `app.ts` lives at `src/` (dev) or `dist/` (prod), both one level under the
  // server root, so `../public` resolves correctly in either case.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, {
    root: path.join(moduleDir, '..', 'public', 'platform-console'),
    prefix: '/platform-console/',
  });
  app.get('/platform-console', async (_req, reply) => reply.redirect('/platform-console/'));

  app.get('/', async () => {
    return {
      ok: true,
      service: 'ipm-cloud',
      version: '0.1.0',
    };
  });

  // C3.5: auth decorates request.userId/orgId from Bearer JWT (dev header
  // fallback in non-production). Public paths are excluded.
  registerAuth(app);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerWorkspaceManageRoutes(app);
  await registerObjectRoutes(app);
  await registerVersionRoutes(app);
  await registerSkillRoutes(app);
  await registerOrgConfigRoutes(app);
  await registerPlatformRoutes(app);
  await registerOrgRoutes(app);

  return app;
}
