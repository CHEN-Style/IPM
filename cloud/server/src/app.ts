import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import { registerDevAuth } from './middleware/devAuth.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerWorkspaceRoutes } from './modules/workspaces/routes.js';
import { registerObjectRoutes } from './modules/objects/routes.js';
import { registerVersionRoutes } from './modules/versions/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((item) => item.trim()),
    credentials: true,
  });

  app.get('/', async () => {
    return {
      ok: true,
      service: 'ipm-cloud',
      version: '0.1.0',
    };
  });

  // C3: dev auth decorates request.userId from X-Dev-User-Id (public paths excluded).
  registerDevAuth(app);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerObjectRoutes(app);
  await registerVersionRoutes(app);

  return app;
}
