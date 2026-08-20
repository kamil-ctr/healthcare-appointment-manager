/**
 * The doctor's landing page: today's confirmed appointments, sorted by
 * urgency then time. Date matching happens in the doctor's own timezone,
 * same convention as slots.js and leave.js - never a bare UTC comparison.
 */
import { many } from '../db/pool.js';
import { isDateString } from '../lib/validate.js';

export async function getDoctorQueue(doctorId, date) {
  isDateString(date, 'date');

  return many(
    `SELECT a.id AS "appointmentId", a.starts_at AS "startsAt", a.ends_at AS "endsAt",
            pu.full_name AS "patientName",
            s.status AS "summaryStatus", s.urgency
       FROM appointments a
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       LEFT JOIN ai_summaries s ON s.appointment_id = a.id AND s.kind = 'pre_visit'
      WHERE a.doctor_id = $1
        AND a.status = 'confirmed'
        AND (a.starts_at AT TIME ZONE d.timezone)::date = $2::date
      ORDER BY
        CASE s.urgency WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Low' THEN 2 ELSE 3 END,
        a.starts_at`,
    [doctorId, date]
  );
}
