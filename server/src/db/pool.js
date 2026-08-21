import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// OID 1082 = DATE. node-postgres's default parser builds a local-time Date
// object, so on any machine whose local timezone isn't UTC a plain calendar
// date silently shifts by a day once serialised to JSON (bit early
// leave-date handling). A DATE has no timezone by definition - keep it exactly as
// the 'YYYY-MM-DD' string Postgres already sent. Do NOT do this for
// timestamptz (OID 1184) - those must stay real Date objects, since they
// represent an absolute instant, not a plain calendar date.
pg.types.setTypeParser(1082, (value) => value);

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
