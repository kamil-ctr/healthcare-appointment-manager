/**
 * Slot generation. All date/time maths happens in SQL, in the doctor's own
 * timezone - never UTC. The grouping key for each slot is the doctor's own
 * calendar date (the `day` value the expansion started from), never
 * re-derived from the resulting UTC instant, so a slot's local date can
 * never drift across a UTC day boundary the way Day 3's leave-date bug did.
 */
import { many, one } from '../db/pool.js';
import { badRequest, notFound } from '../lib/errors.js';

const MAX_HORIZON_DAYS = 30;

function parseDateOnly(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${field} must be an ISO date string (YYYY-MM-DD).`, { fields: [field] });
  }
  const asDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(asDate.getTime())) {
    throw badRequest(`${field} is not a valid date.`, { fields: [field] });
  }
  return asDate;
}

export async function generateSlots(doctorId, fromDate, toDate) {
  const doctor = await one(
    `SELECT u.is_active AS "isActive"
       FROM doctors d JOIN users u ON u.id = d.user_id
      WHERE d.user_id = $1`,
    [doctorId]
  );
  if (!doctor || !doctor.isActive) throw notFound('Doctor not found.');

  const from = parseDateOnly(fromDate, 'from');
  const to = parseDateOnly(toDate, 'to');
  if (to < from) throw badRequest('to must not be before from.', { fields: ['from', 'to'] });
  const spanDays = Math.round((to - from) / 86400000) + 1;
  if (spanDays > MAX_HORIZON_DAYS) {
    throw badRequest(`from/to cannot span more than ${MAX_HORIZON_DAYS} days.`, {
      fields: ['from', 'to'],
    });
  }

  const rows = await many(
    `WITH doctor AS (
       SELECT timezone, slot_minutes FROM doctors WHERE user_id = $1
     ),
     days AS (
       SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
     ),
     active_days AS (
       SELECT day FROM days d
        WHERE NOT EXISTS (
          SELECT 1 FROM doctor_leave l WHERE l.doctor_id = $1 AND l.leave_date = d.day
        )
     ),
     blocks AS (
       SELECT ad.day, av.start_time, av.end_time
         FROM active_days ad
         JOIN doctor_availability av
           ON av.doctor_id = $1 AND av.weekday = EXTRACT(DOW FROM ad.day)::smallint
     ),
     slot_indices AS (
       SELECT b.day, b.start_time, gs.idx, doc.slot_minutes, doc.timezone
         FROM blocks b
         CROSS JOIN doctor doc
         CROSS JOIN LATERAL generate_series(
           0,
           (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60 / doc.slot_minutes)::int - 1
         ) AS gs(idx)
     ),
     computed AS (
       SELECT
         si.day AS local_date,
         (si.day + si.start_time + (si.idx * si.slot_minutes || ' minutes')::interval)
           AT TIME ZONE si.timezone AS starts_at,
         (si.day + si.start_time + ((si.idx + 1) * si.slot_minutes || ' minutes')::interval)
           AT TIME ZONE si.timezone AS ends_at
       FROM slot_indices si
     )
     SELECT
       computed.local_date AS "date",
       computed.starts_at AS "startsAt",
       computed.ends_at AS "endsAt",
       (apt.id IS NOT NULL) AS "taken"
     FROM computed
     LEFT JOIN appointments apt
       ON apt.doctor_id = $1
      AND apt.starts_at = computed.starts_at
      AND apt.status IN ('held', 'confirmed')
     WHERE computed.starts_at >= now()
     ORDER BY computed.starts_at`,
    [doctorId, fromDate, toDate]
  );

  const byDay = {};
  for (const row of rows) {
    if (!byDay[row.date]) byDay[row.date] = [];
    byDay[row.date].push({
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      available: !row.taken,
      reason: row.taken ? 'taken' : null,
    });
  }
  return byDay;
}
