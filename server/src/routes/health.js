import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../lib/errors.js';
import { config } from '../config.js';

export const healthRouter = Router();

const startedAt = Date.now();

/**
 * Liveness. Answers even if the database is down - used by the host's
 * health check so a DB blip does not trigger a redeploy loop.
 */
healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'healthcare-appointment-manager',
    env: config.env,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  });
});

/**
 * Readiness. Actually touches Postgres and reports round-trip latency.
 * Returns 503 when the DB is unreachable.
 */
healthRouter.get(
  '/health/db',
  asyncHandler(async (req, res) => {
    const startedQueryAt = process.hrtime.bigint();
    try {
      const { rows } = await pool.query('SELECT now() AS db_time');
      const latencyMs = Number(process.hrtime.bigint() - startedQueryAt) / 1e6;
      res.json({
        status: 'ok',
        dbTime: rows[0].db_time,
        latencyMs: Number(latencyMs.toFixed(1)),
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
      });
    } catch (err) {
      res.status(503).json({
        status: 'unavailable',
        error: { code: 'DB_UNREACHABLE', message: err.message },
      });
    }
  })
);
