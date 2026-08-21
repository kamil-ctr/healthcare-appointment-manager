/**
 * End-to-end smoke test against a running instance - local or deployed.
 * Runs against BASE_URL (default http://localhost:4000), so the exact
 * same script proves a production deploy works:
 *
 *   node scripts/smoke-test.js
 *   BASE_URL=https://<render-app>.onrender.com node scripts/smoke-test.js
 *
 * Every step is asserted; the run ends with a clear PASS/FAIL summary and
 * a non-zero exit code on any failure. This is HTTP-only (no direct DB
 * access), so it can be pointed at any deployment with nothing but its
 * URL. It registers one throwaway patient and books, then cancels, one
 * appointment - the appointment is cleaned up (cancelled, so the slot is
 * free again), but the user row itself is NOT deleted, since this API has
 * no self-delete-account endpoint. A `smoke-<timestamp>@smoke.local` user
 * accumulating per run is harmless test debris, not a bug - this is the
 * script to re-run after any production change.
 */
const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const marker = `smoke-${Date.now()}`;

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

async function main() {
  console.log(`[smoke-test] target: ${BASE}`);
  const startedAt = Date.now();

  const health = await call('/api/health');
  record('GET /api/health', health.status === 200 && health.data?.status === 'ok', `status=${health.status}`);

  const healthDb = await call('/api/health/db');
  record('GET /api/health/db', healthDb.status === 200 && healthDb.data?.status === 'ok', `latencyMs=${healthDb.data?.latencyMs}`);

  const email = `${marker}@smoke.local`;
  const register = await call('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'smoke-test-pw-1', fullName: 'Smoke Test Patient' },
  });
  record('POST /api/auth/register', register.status === 201 && Boolean(register.data?.token), `status=${register.status}`);
  const patientToken = register.data?.token;

  const login = await call('/api/auth/login', { method: 'POST', body: { email, password: 'smoke-test-pw-1' } });
  record('POST /api/auth/login', login.status === 200 && Boolean(login.data?.token), `status=${login.status}`);

  const doctors = await call('/api/doctors', { token: patientToken });
  const hasDoctors = doctors.status === 200 && Array.isArray(doctors.data?.doctors) && doctors.data.doctors.length > 0;
  record('GET /api/doctors', hasDoctors, `count=${doctors.data?.doctors?.length ?? 0}`);
  if (!hasDoctors) {
    return finish(startedAt, 'no doctors returned - cannot continue (did seeding run?)');
  }
  const doctor = doctors.data.doctors[0];

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 13 * 86400000).toISOString().slice(0, 10);
  const slotsRes = await call(`/api/doctors/${doctor.id}/slots?from=${from}&to=${to}`, { token: patientToken });
  const firstAvailable = Object.values(slotsRes.data?.slots ?? {})
    .flat()
    .find((s) => s.available);
  record(
    'GET /api/doctors/:id/slots',
    slotsRes.status === 200 && Boolean(firstAvailable),
    firstAvailable ? `first available: ${firstAvailable.startsAt}` : 'no available slot found in the next 14 days'
  );
  if (!firstAvailable) {
    return finish(startedAt, 'no available slot to book - cannot continue');
  }

  const hold = await call('/api/appointments/hold', {
    method: 'POST',
    token: patientToken,
    body: { doctorId: doctor.id, startsAt: firstAvailable.startsAt },
  });
  record('POST /api/appointments/hold', hold.status === 201 && Boolean(hold.data?.appointmentId), `status=${hold.status}`);
  const appointmentId = hold.data?.appointmentId;
  if (!appointmentId) return finish(startedAt, 'hold failed - cannot continue');

  const dup = await call('/api/appointments/hold', {
    method: 'POST',
    token: patientToken,
    body: { doctorId: doctor.id, startsAt: firstAvailable.startsAt },
  });
  record(
    'POST /api/appointments/hold (duplicate) -> 409 SLOT_TAKEN',
    dup.status === 409 && dup.data?.error?.code === 'SLOT_TAKEN',
    `status=${dup.status} code=${dup.data?.error?.code}`
  );

  const symptoms = await call(`/api/appointments/${appointmentId}/symptoms`, {
    method: 'POST',
    token: patientToken,
    body: { symptoms: 'Smoke test symptom entry.', severity: 3 },
  });
  record('POST /api/appointments/:id/symptoms', symptoms.status === 201, `status=${symptoms.status}`);

  const confirm = await call(`/api/appointments/${appointmentId}/confirm`, { method: 'POST', token: patientToken });
  record('POST /api/appointments/:id/confirm', confirm.status === 200 && confirm.data?.status === 'confirmed', `status=${confirm.status}`);

  const list = await call('/api/appointments', { token: patientToken });
  const found = list.data?.appointments?.some((a) => a.id === appointmentId);
  record('GET /api/appointments (fetch the appointment)', list.status === 200 && found, `found=${found}`);

  const events = await call(`/api/appointments/${appointmentId}/events`, { token: patientToken });
  const hasHeldAndConfirmed =
    events.status === 200 && ['held', 'confirmed'].every((e) => events.data?.events?.some((ev) => ev.event === e));
  record(
    'GET /api/appointments/:id/events',
    hasHeldAndConfirmed,
    `events=${(events.data?.events || []).map((e) => e.event).join(',')}`
  );

  const cancel = await call(`/api/appointments/${appointmentId}/cancel`, {
    method: 'POST',
    token: patientToken,
    body: { reason: 'smoke-test cleanup' },
  });
  record(
    'POST /api/appointments/:id/cancel',
    cancel.status === 200 && cancel.data?.status === 'cancelled_by_patient',
    `status=${cancel.status}`
  );

  const slotsAfter = await call(`/api/doctors/${doctor.id}/slots?from=${from}&to=${to}`, { token: patientToken });
  const sameSlot = Object.values(slotsAfter.data?.slots ?? {})
    .flat()
    .find((s) => s.startsAt === firstAvailable.startsAt);
  record('slot is free again after cancel', sameSlot?.available === true, `available=${sameSlot?.available}`);

  await finish(startedAt);
}

async function finish(startedAt, abortReason) {
  const ms = Date.now() - startedAt;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);

  console.log(`\n[smoke-test] ${passed}/${results.length} passed in ${ms}ms`);
  if (abortReason) console.log(`[smoke-test] aborted early: ${abortReason}`);
  if (failed.length > 0) {
    console.log('[smoke-test] failures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
  console.log(failed.length === 0 && !abortReason ? '\nPASS - smoke test clean.' : '\nFAIL - see above.');
}

main().catch((err) => {
  console.error('[smoke-test] FATAL:', err);
  process.exitCode = 1;
});
