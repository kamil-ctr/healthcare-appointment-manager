import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.url,
  max: config.db.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // An idle client blew up (network drop, DB restart). Log and keep serving:
  // the pool will hand out a fresh connection on the next query.
  console.error('[db] idle client error:', err.message);
});

/** Run a single query. Returns the pg Result. */
export function query(text, params) {
  return pool.query(text, params);
}

/** Convenience: first row or null. */
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

/** Convenience: all rows. */
export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/**
 * Run `fn` inside a transaction on a dedicated client.
 * Commits on success, rolls back on any throw, always releases the client.
 *
 * This is the backbone of booking, leave cancellation, and every write that
 * also enqueues an outbox row - the business change and the notification
 * must commit together or not at all.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
