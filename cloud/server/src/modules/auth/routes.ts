import type { FastifyInstance } from 'fastify';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/auth/status', async () => {
    return {
      ok: true,
      module: 'auth',
      status: 'placeholder',
      message: 'Auth routes will be implemented in the next cloud phase.',
    };
  });
}
