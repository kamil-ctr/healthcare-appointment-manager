/**
 * Scans due reminders and hands each one to the outbox as an email row.
 * `reminders` is the schedule (what is due, when); `outbox` is the
 * transport (how it gets delivered, with retries) - this job is the only
 * place that boundary is crossed. Runs before the outbox worker in the
 * same tick (see jobs/runner.js) so a reminder that just came due can be
 * delivered in the same tick it's queued in.
 */
import { withTransaction } from '../db/pool.js';

const BATCH_SIZE = 20;

export async function queueDueReminders() {
  return withTransaction(async (client) => {
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
          JSON.stringify({
            patientName: r.patientName,
            doctorName: r.doctorName,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
          }),
        ]
      );
      await client.query(`UPDATE reminders SET status = 'queued', queued_at = now() WHERE id = $1`, [
        r.id,
      ]);
    }

    return { queued: rows.length };
  });
}
