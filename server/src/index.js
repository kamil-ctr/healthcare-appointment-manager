import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { startJobRunner, stopJobRunner } from './jobs/runner.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} (${config.env})`);
  console.log(`[server] health:    http://localhost:${config.port}/api/health`);
  console.log(`[server] readiness: http://localhost:${config.port}/api/health/db`);
});

startJobRunner();

/**
 * Graceful shutdown: stop accepting connections, then close the pool.
 * Matters on free hosting tiers, which restart containers often - an
 * in-flight transaction should finish rather than be severed.
 */
async function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  stopJobRunner();
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason);
});
