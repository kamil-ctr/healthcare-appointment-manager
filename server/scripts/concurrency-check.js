/**
 * Proves the double-booking guarantee at the database level.
 *
 *   node --env-file=.env scripts/concurrency-check.js
 *
 * Fires N simultaneous INSERTs for the SAME doctor + slot from N separate
 * pool connections. Exactly one must succeed; the rest must fail with
 * SQLSTATE 23505 (unique_violation), which the API maps to HTTP 409.
 *
 * Cleans up after itself. Safe to run against a dev database.
 */
import { randomUUID } from 'node:crypto';
import { pool, closePool } from '../src/db/pool.js';

const CONCURRENCY = 20;
const marker = `concurrency-check-${randomUUID().slice(0, 8)}`;

async function seed() {
  const doctorUser = await pool.query(
    `INSERT INTO users (role, email, full_name, password_hash)
     VALUES ('doctor', $1, 'Concurrency Test Doctor', 'x')
     RETURNING id`,
    [`${marker}-doctor@test.local`]
  );
  const doctorId = doctorUser.rows[0].id;

  await pool.query(
    `INSERT INTO doctors (user_id, specialisation, slot_minutes)
     VALUES ($1, 'General Medicine', 30)`,
    [doctorId]
  );

  const patients = [];
  for (let i = 0; i < CONCURRENCY; i += 1) {
    const row = await pool.query(
      `INSERT INTO users (role, email, full_name, password_hash)
       VALUES ('patient', $1, $2, 'x') RETURNING id`,
      [`${marker}-patient-${i}@test.local`, `Patient ${i}`]
    );
    patients.push(row.rows[0].id);
  }
  return { doctorId, patients };
}

/** Mirrors exactly what the real POST /appointments/hold will do. */
async function attemptHold(doctorId, patientId, startsAt, endsAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO appointments
         (doctor_id, patient_id, starts_at, ends_at, status, hold_expires_at)
       VALUES ($1, $2, $3, $4, 'held', now() + interval '10 minutes')
       RETURNING id`,
      [doctorId, patientId, startsAt, endsAt]
    );
    await client.query('COMMIT');
    return { ok: true, id: rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, sqlState: err.code, message: err.message };
  } finally {
    client.release();
  }
}

async function cleanup() {
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${marker}-%`]);
}

async function main() {
  const { doctorId, patients } = await seed();

  const startsAt = new Date(Date.now() + 86400000);
  startsAt.setMinutes(0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 30 * 60000);

  console.log(`[test] firing ${CONCURRENCY} simultaneous holds for one slot...`);
  const results = await Promise.all(
    patients.map((patientId) => attemptHold(doctorId, patientId, startsAt, endsAt))
  );

  const won = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  const uniqueViolations = rejected.filter((r) => r.sqlState === '23505');
  const other = rejected.filter((r) => r.sqlState !== '23505');

  console.log(`[test] succeeded        : ${won.length}   (expected 1)`);
  console.log(`[test] 23505 conflicts  : ${uniqueViolations.length}   (expected ${CONCURRENCY - 1})`);
  console.log(`[test] unexpected errors: ${other.length}   (expected 0)`);

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM appointments
      WHERE doctor_id = $1 AND starts_at = $2 AND status IN ('held','confirmed')`,
    [doctorId, startsAt]
  );
  console.log(`[test] rows in DB       : ${rows[0].n}   (expected 1)`);

  const passed =
    won.length === 1 &&
    uniqueViolations.length === CONCURRENCY - 1 &&
    other.length === 0 &&
    rows[0].n === 1;

  await cleanup();
  console.log(passed ? '\nPASS - no double booking possible.' : '\nFAIL');
  if (!passed) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error('[test] error:', err.message);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => closePool());
