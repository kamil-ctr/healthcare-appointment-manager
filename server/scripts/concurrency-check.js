/**
 * Proves the double-booking guarantee two ways.
 *
 *   node --env-file=.env scripts/concurrency-check.js
 *
 * Scenario 1 (direct SQL): fires N simultaneous INSERTs for the SAME
 * doctor + slot from N separate pool connections - the lowest-level proof
 * that the partial unique index is what stops the race, not application code.
 *
 * Scenario 2 (real HTTP): registers N real patients, logs each in, and
 * fires N simultaneous POST /api/appointments/hold requests at the running
 * server for the SAME doctor + slot - proves the guarantee holds through
 * the actual route/service layer a browser would hit, not just the raw SQL.
 *
 * Both expect exactly one success and N-1 conflicts. Cleans up after itself.
 * Requires the server to be running (scenario 2 only).
 */
import { randomUUID } from 'node:crypto';
import { pool, closePool } from '../src/db/pool.js';
import { config } from '../src/config.js';

const CONCURRENCY = 20;
const BASE_URL = `http://localhost:${config.port}`;

// ---------------------------------------------------------------------
// Scenario 1: direct SQL, bypassing the API entirely
// ---------------------------------------------------------------------
async function runDirectSqlScenario() {
  const marker = `concurrency-sql-${randomUUID().slice(0, 8)}`;

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

  console.log('\n=== Scenario 1: direct SQL, 20 concurrent INSERTs ===');
  const { doctorId, patients } = await seed();

  const startsAt = new Date(Date.now() + 86400000);
  startsAt.setMinutes(0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 30 * 60000);

  console.log(`[sql] firing ${CONCURRENCY} simultaneous holds for one slot...`);
  const results = await Promise.all(
    patients.map((patientId) => attemptHold(doctorId, patientId, startsAt, endsAt))
  );

  const won = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  const uniqueViolations = rejected.filter((r) => r.sqlState === '23505');
  const other = rejected.filter((r) => r.sqlState !== '23505');

  console.log(`[sql] succeeded        : ${won.length}   (expected 1)`);
  console.log(`[sql] 23505 conflicts  : ${uniqueViolations.length}   (expected ${CONCURRENCY - 1})`);
  console.log(`[sql] unexpected errors: ${other.length}   (expected 0)`);

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM appointments
      WHERE doctor_id = $1 AND starts_at = $2 AND status IN ('held','confirmed')`,
    [doctorId, startsAt]
  );
  console.log(`[sql] rows in DB       : ${rows[0].n}   (expected 1)`);

  const passed =
    won.length === 1 && uniqueViolations.length === CONCURRENCY - 1 && other.length === 0 && rows[0].n === 1;

  await cleanup();
  console.log(passed ? '[sql] PASS - no double booking possible.' : '[sql] FAIL');
  return passed;
}

// ---------------------------------------------------------------------
// Scenario 2: real HTTP, through the actual route/service layer
// ---------------------------------------------------------------------
async function runHttpScenario() {
  const marker = `concurrency-http-${randomUUID().slice(0, 8)}`;

  // A doctor in UTC keeps the grid-alignment maths trivial for this script -
  // the timezone-correctness itself is proven separately (slots.js tests).
  async function seedDoctor() {
    const doctorUser = await pool.query(
      `INSERT INTO users (role, email, full_name, password_hash)
       VALUES ('doctor', $1, 'Concurrency HTTP Doctor', 'x')
       RETURNING id`,
      [`${marker}-doctor@test.local`]
    );
    const doctorId = doctorUser.rows[0].id;

    await pool.query(
      `INSERT INTO doctors (user_id, specialisation, slot_minutes, timezone)
       VALUES ($1, 'General Medicine', 30, 'UTC')`,
      [doctorId]
    );

    const startsAt = new Date(Date.now() + 3 * 86400000);
    startsAt.setUTCHours(10, 0, 0, 0);
    const weekday = startsAt.getUTCDay();

    await pool.query(
      `INSERT INTO doctor_availability (doctor_id, weekday, start_time, end_time)
       VALUES ($1, $2, '10:00', '10:30')`,
      [doctorId, weekday]
    );

    return { doctorId, startsAt: startsAt.toISOString() };
  }

  async function registerPatient(index) {
    const email = `${marker}-patient-${index}@test.local`;
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'concurrency-test-1', fullName: `Patient ${index}` }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(data)}`);
    return data.token;
  }

  async function attemptHoldHttp(token, doctorId, startsAt) {
    const res = await fetch(`${BASE_URL}/api/appointments/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ doctorId, startsAt }),
    });
    const data = await res.json();
    return { status: res.status, code: data?.error?.code };
  }

  async function cleanup() {
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${marker}-%`]);
  }

  console.log('\n=== Scenario 2: real HTTP, 20 concurrent POST /api/appointments/hold ===');
  const { doctorId, startsAt } = await seedDoctor();

  console.log(`[http] registering ${CONCURRENCY} patients...`);
  const tokens = [];
  for (let i = 0; i < CONCURRENCY; i += 1) tokens.push(await registerPatient(i));

  console.log(`[http] firing ${CONCURRENCY} simultaneous holds for one slot...`);
  const results = await Promise.all(tokens.map((token) => attemptHoldHttp(token, doctorId, startsAt)));

  const won = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409 && r.code === 'SLOT_TAKEN');
  const other = results.filter((r) => r.status !== 201 && !(r.status === 409 && r.code === 'SLOT_TAKEN'));

  console.log(`[http] 201 succeeded      : ${won.length}   (expected 1)`);
  console.log(`[http] 409 SLOT_TAKEN     : ${conflicts.length}   (expected ${CONCURRENCY - 1})`);
  console.log(`[http] unexpected results : ${other.length}   (expected 0)`);
  if (other.length > 0) console.log('[http] unexpected:', JSON.stringify(other));

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM appointments
      WHERE doctor_id = $1 AND starts_at = $2 AND status IN ('held','confirmed')`,
    [doctorId, startsAt]
  );
  console.log(`[http] rows in DB         : ${rows[0].n}   (expected 1)`);

  const passed =
    won.length === 1 && conflicts.length === CONCURRENCY - 1 && other.length === 0 && rows[0].n === 1;

  await cleanup();
  console.log(passed ? '[http] PASS - no double booking possible.' : '[http] FAIL');
  return passed;
}

async function main() {
  const sqlPassed = await runDirectSqlScenario();
  const httpPassed = await runHttpScenario();

  const passed = sqlPassed && httpPassed;
  console.log(passed ? '\nPASS - no double booking possible (both scenarios).' : '\nFAIL');
  if (!passed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[test] error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
