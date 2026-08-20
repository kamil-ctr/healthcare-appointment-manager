/**
 * Scans due reminders and hands each one to the outbox as an email row.
 * `reminders` is the schedule (what is due, when); `outbox` is the
 * transport (how it gets delivered, with retries) - this job is the only
 * place that boundary is crossed. Runs before the outbox worker in the
 * same tick (see jobs/runner.js) so a reminder that just came due can be
 * delivered in the same tick it's queued in.
 */
import { withTransaction } from '../db/pool.js';
import { FREQUENCY_TIMES } from '../services/reminders.js';

const BATCH_SIZE = 20;

/** Local HH:MM (24h) of `date` in `timezone` - used to recover "dose N of M" from due_at alone. */
function localTimeOfDay(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    date
  );
}

async function queueAppointmentReminders(client) {
  const { rows } = await client.query(
    `SELECT r.id, r.appointment_id AS "appointmentId", r.recipient_id AS "recipientId",
            a.starts_at AS "startsAt", a.ends_at AS "endsAt",
            pu.full_name AS "patientName", du.full_name AS "doctorName"
       FROM reminders r
       JOIN appointments a ON a.id = r.appointment_id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       JOIN users du ON du.id = d.user_id
      WHERE r.kind = 'appointment_reminder' AND r.status = 'scheduled' AND r.due_at <= now()
      ORDER BY r.due_at
      LIMIT $1
      FOR UPDATE OF r SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const r of rows) {
    await client.query(
      `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
       VALUES ('email', 'appointment_reminder', $1, $2, $3::jsonb)`,
      [
        r.appointmentId,
        r.recipientId,
        JSON.stringify({ patientName: r.patientName, doctorName: r.doctorName, startsAt: r.startsAt, endsAt: r.endsAt }),
      ]
    );
    await client.query(`UPDATE reminders SET status = 'queued', queued_at = now() WHERE id = $1`, [r.id]);
  }
  return rows.length;
}

async function queueMedicationReminders(client) {
  const { rows } = await client.query(
    `SELECT r.id, r.appointment_id AS "appointmentId", r.recipient_id AS "recipientId", r.due_at AS "dueAt",
            pu.full_name AS "patientName", du.full_name AS "doctorName",
            p.medication_name AS "medicationName", p.dosage,
            p.frequency_per_day AS "frequencyPerDay", p.instructions,
            d.timezone AS "doctorTimezone"
       FROM reminders r
       JOIN appointments a ON a.id = r.appointment_id
       JOIN prescriptions p ON p.id = r.prescription_id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       JOIN users du ON du.id = d.user_id
      WHERE r.kind = 'medication_reminder' AND r.status = 'scheduled' AND r.due_at <= now()
      ORDER BY r.due_at
      LIMIT $1
      FOR UPDATE OF r SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const r of rows) {
    // "dose N of M today" is recovered from due_at itself rather than
    // stored separately: the local time-of-day always matches one of
    // FREQUENCY_TIMES[frequencyPerDay] exactly, since that is the same
    // table services/reminders.js used to generate it.
    const times = FREQUENCY_TIMES[r.frequencyPerDay] ?? [];
    const hhmm = localTimeOfDay(new Date(r.dueAt), r.doctorTimezone);
    const doseIndex = times.indexOf(hhmm) + 1 || 1;

    await client.query(
      `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
       VALUES ('email', 'medication_reminder', $1, $2, $3::jsonb)`,
      [
        r.appointmentId,
        r.recipientId,
        JSON.stringify({
          patientName: r.patientName,
          doctorName: r.doctorName,
          medicationName: r.medicationName,
          dosage: r.dosage,
          instructions: r.instructions,
          doseIndex,
          doseCount: r.frequencyPerDay,
        }),
      ]
    );
    await client.query(`UPDATE reminders SET status = 'queued', queued_at = now() WHERE id = $1`, [r.id]);
  }
  return rows.length;
}

async function queueFollowUpReminders(client) {
  const { rows } = await client.query(
    `SELECT r.id, r.appointment_id AS "appointmentId", r.recipient_id AS "recipientId",
            pu.full_name AS "patientName", du.full_name AS "doctorName", vn.follow_up_date AS "followUpDate"
       FROM reminders r
       JOIN appointments a ON a.id = r.appointment_id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       JOIN users du ON du.id = d.user_id
       JOIN visit_notes vn ON vn.appointment_id = a.id
      WHERE r.kind = 'follow_up' AND r.status = 'scheduled' AND r.due_at <= now()
      ORDER BY r.due_at
      LIMIT $1
      FOR UPDATE OF r SKIP LOCKED`,
    [BATCH_SIZE]
  );

  for (const r of rows) {
    await client.query(
      `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
       VALUES ('email', 'follow_up_reminder', $1, $2, $3::jsonb)`,
      [r.appointmentId, r.recipientId, JSON.stringify({ patientName: r.patientName, doctorName: r.doctorName, followUpDate: r.followUpDate })]
    );
    await client.query(`UPDATE reminders SET status = 'queued', queued_at = now() WHERE id = $1`, [r.id]);
  }
  return rows.length;
}

export async function queueDueReminders() {
  return withTransaction(async (client) => {
    const appointmentCount = await queueAppointmentReminders(client);
    const medicationCount = await queueMedicationReminders(client);
    const followUpCount = await queueFollowUpReminders(client);
    return { queued: appointmentCount + medicationCount + followUpCount };
  });
}
