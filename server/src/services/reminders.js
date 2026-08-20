/**
 * Medication and follow-up reminder expansion: prescriptions/follow-up date
 * -> individual `reminders` rows. Called from services/notes.js inside the
 * SAME transaction as the visit-notes write, never on its own.
 */

/**
 * frequencyPerDay -> local times of day, in the DOCTOR'S timezone. One
 * exported constant, not scattered literals. 5 and 6 are evenly spaced
 * across 08:00-22:00 inclusive (840 minutes / (n-1) intervals).
 */
export const FREQUENCY_TIMES = {
  1: ['09:00'],
  2: ['09:00', '21:00'],
  3: ['08:00', '14:00', '20:00'],
  4: ['08:00', '12:00', '16:00', '20:00'],
  5: ['08:00', '11:30', '15:00', '18:30', '22:00'],
  6: ['08:00', '10:48', '13:36', '16:24', '19:12', '22:00'],
};

const MAX_REMINDERS_PER_APPOINTMENT = 400;

/**
 * Expands every prescription into individual medication_reminder rows,
 * starting the day after the visit and running for each prescription's own
 * durationDays. Due times are computed in Postgres (`AT TIME ZONE`), not in
 * JS, so DST transitions in the doctor's timezone are handled correctly -
 * the same idiom services/appointments.js already uses for the reverse
 * direction. Any due_at that has already passed is skipped (relevant when
 * durationDays is short and notes are entered late in the day).
 *
 * The 400-row cap is shared across ALL prescriptions passed in one call, in
 * the order given - once the budget is spent, later prescriptions (or the
 * tail of one that would overflow it) are recorded as clamped rather than
 * silently dropped, so the caller can surface why in the API response.
 */
export async function scheduleMedicationReminders(client, { appointmentId, patientId }, prescriptions) {
  if (!prescriptions || prescriptions.length === 0) {
    return { totalScheduled: 0, cap: MAX_REMINDERS_PER_APPOINTMENT, clampedPrescriptions: [] };
  }

  const { rows: visitRows } = await client.query(
    `SELECT (a.starts_at AT TIME ZONE d.timezone)::date AS "visitLocalDate", d.timezone
       FROM appointments a JOIN doctors d ON d.user_id = a.doctor_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  const { visitLocalDate, timezone } = visitRows[0];

  let remaining = MAX_REMINDERS_PER_APPOINTMENT;
  let totalScheduled = 0;
  const clampedPrescriptions = [];

  for (const p of prescriptions) {
    const times = FREQUENCY_TIMES[p.frequencyPerDay];

    if (remaining <= 0) {
      clampedPrescriptions.push({
        prescriptionId: p.id,
        medicationName: p.medicationName,
        requested: times.length * p.durationDays,
        scheduled: 0,
      });
      continue;
    }

    const { rows: candidates } = await client.query(
      `WITH days AS (SELECT generate_series(1, $1::int) AS day_offset),
            slots AS (
              SELECT t.time_of_day, t.ord
                FROM unnest($2::time[]) WITH ORDINALITY AS t(time_of_day, ord)
            )
       SELECT ((($3::date + d.day_offset) + s.time_of_day)::timestamp AT TIME ZONE $4) AS "dueAt"
         FROM days d, slots s
        WHERE ((($3::date + d.day_offset) + s.time_of_day)::timestamp AT TIME ZONE $4) > now()
        ORDER BY d.day_offset, s.ord`,
      [p.durationDays, times, visitLocalDate, timezone]
    );

    const toInsert = candidates.slice(0, remaining);
    for (const c of toInsert) {
      await client.query(
        `INSERT INTO reminders (appointment_id, prescription_id, recipient_id, kind, due_at, status)
         VALUES ($1, $2, $3, 'medication_reminder', $4, 'scheduled')`,
        [appointmentId, p.id, patientId, c.dueAt]
      );
    }
    totalScheduled += toInsert.length;
    remaining -= toInsert.length;

    if (toInsert.length < candidates.length) {
      clampedPrescriptions.push({
        prescriptionId: p.id,
        medicationName: p.medicationName,
        requested: candidates.length,
        scheduled: toInsert.length,
      });
    }
  }

  return { totalScheduled, cap: MAX_REMINDERS_PER_APPOINTMENT, clampedPrescriptions };
}

/** One follow_up reminder at 09:00 local (doctor's timezone) on followUpDate. Skips if already past. */
export async function scheduleFollowUpReminder(client, { appointmentId, patientId }, followUpDate) {
  const { rows } = await client.query(
    `SELECT d.timezone FROM appointments a JOIN doctors d ON d.user_id = a.doctor_id WHERE a.id = $1`,
    [appointmentId]
  );
  const { timezone } = rows[0];

  const { rows: dueRows } = await client.query(
    `SELECT (($1::date + time '09:00')::timestamp AT TIME ZONE $2) AS "dueAt"`,
    [followUpDate, timezone]
  );
  const dueAt = dueRows[0].dueAt;
  if (new Date(dueAt) <= new Date()) return { scheduled: false };

  await client.query(
    `INSERT INTO reminders (appointment_id, recipient_id, kind, due_at, status)
     VALUES ($1, $2, 'follow_up', $3, 'scheduled')`,
    [appointmentId, patientId, dueAt]
  );
  return { scheduled: true, dueAt };
}
