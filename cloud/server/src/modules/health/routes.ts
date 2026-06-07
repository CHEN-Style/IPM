import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../../infra/db/postgres.js';
import { checkOssConfig } from '../../infra/oss/ossClient.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const [database, oss] = await Promise.allSettled([
      checkDatabase(),
      checkOssConfig(),
    ]);

    const dbResult =
      database.status === 'fulfilled'
        ? database.value
        : {
            ok: false,
            error: database.reason instanceof Error ? database.reason.message : String(database.reason),
          };

    const ossResult =
      oss.status === 'fulfilled'
        ? oss.value
        : {
            configured: false,
            ok: false,
            error: oss.reason instanceof Error ? oss.reason.message : String(oss.reason),
          };

    return {
      ok: dbResult.ok === true,
      service: 'ipm-cloud',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbResult,
        oss: ossResult,
      },
    };
  });
}
