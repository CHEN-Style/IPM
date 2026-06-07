import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './infra/db/postgres.js';

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down ipm cloud server');
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
