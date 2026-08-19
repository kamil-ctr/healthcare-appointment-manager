/**
 * Doctor leave: recording a day off and cascading it onto that day's
 * appointments. See docs/system-design.md ("Doctor leave conflict
 * handling") for why this is one transaction and why cancellation
 * notifications are outbox rows rather than inline sends.
 */
import { one, withTransaction } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';

/**
 * date must be 'YYYY-MM-DD'. Matched against the doctor's OWN timezone,
 * not UTC - (starts_at AT TIME ZONE doctors.timezone)::date - because a
 * naive comparison against starts_at's raw UTC date silently misclassifies
 * appointments near midnight in any timezone with a non-zero UTC offset.
 */
export async function createLeaveWithCascade(doctorId, { date, reason, createdBy }) {
  return withTransaction(async (client) => {
    try {
      await client.query(
        `INSERT INTO doctor_leave (doctor_id, leave_date, reason, created_by)
         VALUES ($1, $2, $3, $4)`,
        [doctorId, date, reason ?? null, createdBy ?? null]
      );
    } catch (err) {
      if (err.code === '23505') {
        // Thrown before any other statement in this transaction runs, so
        // withTransaction rolls back to a true no-op: no side effects at all.
        throw conflict('Leave already recorded for this doctor on this date.', { date });
      }
      throw err;
    }

    const { rows: appointments } = await client.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.patient_id,
              pu.full_name AS "patientName", pu.email AS "patientEmail",
              d.user_id AS "doctorUserId", du.full_name AS "doctorName"
         FROM appointments a
         JOIN users pu ON pu.id = a.patient_id
         JOIN doctors d ON d.user_id = a.doctor_id
         JOIN users du ON du.id = d.user_id
        WHERE a.doctor_id = $1
          AND (a.starts_at AT TIME ZONE d.timezone)::date = $2::date
          AND a.status IN ('held', 'confirmed')
        FOR UPDATE OF a`,
      [doctorId, date]
    );

    if (appointments.length === 0) {
      return { leaveDate: date, affectedAppointments: 0, notificationsQueued: 0 };
    }

    const appointmentIds = appointments.map((a) => a.id);

    await client.query(
      `UPDATE appointments
          SET status = 'cancelled_by_leave', cancel_reason = $2
        WHERE id = ANY($1::uuid[])`,
      [appointmentIds, reason ?? 'Doctor on leave']
    );

    let notificationsQueued = 0;

    for (const appt of appointments) {
      await client.query(
        `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
         VALUES ('email', 'leave_cancellation', $1, $2, $3::jsonb)`,
        [
          appt.id,
          appt.patient_id,
          JSON.stringify({
            patientName: appt.patientName,
            patientEmail: appt.patientEmail,
            doctorName: appt.doctorName,
            originalSlot: { startsAt: appt.starts_at, endsAt: appt.ends_at },
            reason: reason ?? null,
          }),
        ]
      );
      notificationsQueued += 1;
    }

    // One summary row for the doctor - not tied to a single appointment.
    await client.query(
      `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
       VALUES ('email', 'leave_cancellation_summary', NULL, $1, $2::jsonb)`,
      [
        appointments[0].doctorUserId,
        JSON.stringify({
          leaveDate: date,
          reason: reason ?? null,
          cancelledCount: appointments.length,
          cancelledAppointments: appointments.map((a) => ({
            appointmentId: a.id,
            patientName: a.patientName,
            startsAt: a.starts_at,
          })),
        }),
      ]
    );
    notificationsQueued += 1;

    const { rows: events } = await client.query(
      `SELECT appointment_id, user_id, google_event_id, calendar_id
         FROM calendar_events
        WHERE appointment_id = ANY($1::uuid[]) AND status = 'active'`,
      [appointmentIds]
    );

    for (const event of events) {
      await client.query(
        `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
         VALUES ('calendar', 'event_delete', $1, $2, $3::jsonb)`,
        [
          event.appointment_id,
          event.user_id,
          JSON.stringify({ googleEventId: event.google_event_id, calendarId: event.calendar_id }),
        ]
      );
      notificationsQueued += 1;
    }

    return { leaveDate: date, affectedAppointments: appointments.length, notificationsQueued };
  });
}

/**
 * Removes the leave record. Deliberately does NOT resurrect any
 * appointment it cancelled - patients have already been told their slot is
 * gone, and un-cancelling silently would contradict a notification already
 * queued (or sent). Re-booking is the correct path, not un-cancelling.
 */
export async function deleteLeave(doctorId, date) {
  const removed = await one(
    `DELETE FROM doctor_leave WHERE doctor_id = $1 AND leave_date = $2 RETURNING id`,
    [doctorId, date]
  );
  if (!removed) throw notFound('No leave recorded for this doctor on that date.');
  return { removed: true };
}
