/**
 * Booking: hold, confirm, cancel, reschedule, list. Concurrency is always
 * resolved by the database - the two partial unique indexes on
 * `appointments` - never by a SELECT-then-INSERT check in this file.
 */
import { one, many, withTransaction } from '../db/pool.js';
import { AppError, badRequest, notFound, forbidden, conflict, symptomsRequired } from '../lib/errors.js';
import { config } from '../config.js';

const MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

function slotTaken() {
  return new AppError(409, 'SLOT_TAKEN', 'That slot was just taken.');
}
function patientBusy() {
  return new AppError(409, 'PATIENT_BUSY', 'You already have a held or confirmed appointment at that time.');
}
function holdExpired() {
  return new AppError(409, 'HOLD_EXPIRED', 'This hold has expired.');
}

/**
 * Re-derives every fact about the slot from the database - never trusts
 * the client. Throws badRequest if the doctor doesn't exist/is inactive,
 * startsAt doesn't land exactly on the availability grid, the date is on
 * leave, or the slot is in the past or beyond the booking horizon.
 * Returns the doctor's slotMinutes so callers can compute endsAt.
 */
async function validateSlotRequest(doctorId, startsAt) {
  const doctor = await one(
    `SELECT u.is_active AS "isActive", d.slot_minutes AS "slotMinutes"
       FROM doctors d JOIN users u ON u.id = d.user_id
      WHERE d.user_id = $1`,
    [doctorId]
  );
  if (!doctor || !doctor.isActive) {
    throw badRequest('Doctor not found or inactive.', { fields: ['doctorId'] });
  }

  const startsAtDate = new Date(startsAt);
  if (Number.isNaN(startsAtDate.getTime())) {
    throw badRequest('startsAt must be a valid ISO timestamp.', { fields: ['startsAt'] });
  }
  const now = Date.now();
  if (startsAtDate.getTime() <= now) {
    throw badRequest('startsAt must be in the future.', { fields: ['startsAt'] });
  }
  if (startsAtDate.getTime() - now > MAX_HORIZON_MS) {
    throw badRequest('startsAt is beyond the 30-day booking horizon.', { fields: ['startsAt'] });
  }

  const check = await one(
    `SELECT
       EXISTS (
         SELECT 1 FROM doctor_leave l
          WHERE l.doctor_id = $1 AND l.leave_date = ($2::timestamptz AT TIME ZONE d.timezone)::date
       ) AS "onLeave",
       EXISTS (
         SELECT 1 FROM doctor_availability av
          WHERE av.doctor_id = $1
            AND av.weekday = EXTRACT(DOW FROM ($2::timestamptz AT TIME ZONE d.timezone))::smallint
            AND ($2::timestamptz AT TIME ZONE d.timezone)::time >= av.start_time
            AND ($2::timestamptz AT TIME ZONE d.timezone)::time < av.end_time
            AND MOD(
                  EXTRACT(EPOCH FROM (($2::timestamptz AT TIME ZONE d.timezone)::time - av.start_time))::int / 60,
                  d.slot_minutes
                ) = 0
       ) AS "gridAligned"
     FROM doctors d
     WHERE d.user_id = $1`,
    [doctorId, startsAt]
  );

  if (check.onLeave) {
    throw badRequest('Doctor is on leave that date.', { fields: ['startsAt'] });
  }
  if (!check.gridAligned) {
    throw badRequest("startsAt does not align to the doctor's availability grid.", {
      fields: ['startsAt'],
    });
  }

  return doctor;
}

export async function holdAppointment(doctorId, patientId, startsAt) {
  const doctor = await validateSlotRequest(doctorId, startsAt);
  const endsAt = new Date(new Date(startsAt).getTime() + doctor.slotMinutes * 60000).toISOString();

  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO appointments (doctor_id, patient_id, starts_at, ends_at, status, hold_expires_at)
         VALUES ($1, $2, $3, $4, 'held', now() + ($5 || ' minutes')::interval)
         RETURNING id AS "appointmentId", starts_at AS "startsAt", ends_at AS "endsAt",
                   hold_expires_at AS "holdExpiresAt"`,
        [doctorId, patientId, startsAt, endsAt, config.booking.holdMinutes]
      );
      return { ...rows[0], holdSeconds: config.booking.holdMinutes * 60 };
    });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'unique_active_appointment') throw slotTaken();
      if (err.constraint === 'unique_active_patient_slot') throw patientBusy();
    }
    throw err;
  }
}

async function fetchParticipants(client, appointmentId) {
  const { rows } = await client.query(
    `SELECT a.id, a.doctor_id AS "doctorId", a.patient_id AS "patientId",
            a.starts_at AS "startsAt", a.ends_at AS "endsAt",
            pu.full_name AS "patientName", pu.email AS "patientEmail",
            du.full_name AS "doctorName", du.email AS "doctorEmail"
       FROM appointments a
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       JOIN users du ON du.id = d.user_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  return rows[0];
}

export async function confirmAppointment(appointmentId, patientId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, patient_id, status, hold_expires_at FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId]
    );
    const appt = rows[0];
    if (!appt) throw notFound('Appointment not found.');
    if (appt.patient_id !== patientId) throw forbidden('This appointment does not belong to you.');
    if (appt.status !== 'held') {
      throw conflict('Appointment is not in a confirmable state.', { status: appt.status });
    }
    if (!(new Date(appt.hold_expires_at) > new Date())) throw holdExpired();

    // The summary itself is allowed to still be pending/failed - only the
    // symptom form is required. Booking can never depend on the model.
    const form = await client.query(`SELECT 1 FROM symptom_forms WHERE appointment_id = $1`, [
      appointmentId,
    ]);
    if (form.rows.length === 0) {
      throw symptomsRequired();
    }

    await client.query(
      `UPDATE appointments SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1`,
      [appointmentId]
    );

    const p = await fetchParticipants(client, appointmentId);
    const slot = { startsAt: p.startsAt, endsAt: p.endsAt };

    for (const [recipientId, recipientName] of [
      [p.patientId, p.patientName],
      [p.doctorId, p.doctorName],
    ]) {
      await client.query(
        `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
         VALUES ('email', 'booking_confirmation', $1, $2, $3::jsonb)`,
        [
          appointmentId,
          recipientId,
          JSON.stringify({ recipientName, patientName: p.patientName, doctorName: p.doctorName, ...slot }),
        ]
      );
      await client.query(
        `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
         VALUES ('calendar', 'event_create', $1, $2, $3::jsonb)`,
        [
          appointmentId,
          recipientId,
          JSON.stringify({ patientName: p.patientName, doctorName: p.doctorName, ...slot }),
        ]
      );
    }

    return { appointmentId, status: 'confirmed', startsAt: p.startsAt, endsAt: p.endsAt };
  });
}

export async function cancelAppointment(appointmentId, userId, role, reason) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, doctor_id, patient_id, status FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId]
    );
    const appt = rows[0];
    if (!appt) throw notFound('Appointment not found.');

    const isPatient = role === 'patient' && appt.patient_id === userId;
    const isDoctor = role === 'doctor' && appt.doctor_id === userId;
    if (!isPatient && !isDoctor) throw forbidden('This appointment does not belong to you.');
    if (!['held', 'confirmed'].includes(appt.status)) {
      throw conflict('Appointment cannot be cancelled from its current state.', {
        status: appt.status,
      });
    }

    const newStatus = isPatient ? 'cancelled_by_patient' : 'cancelled_by_doctor';
    await client.query(`UPDATE appointments SET status = $2, cancel_reason = $3 WHERE id = $1`, [
      appointmentId,
      newStatus,
      reason ?? null,
    ]);

    const p = await fetchParticipants(client, appointmentId);
    const slot = { startsAt: p.startsAt, endsAt: p.endsAt };

    for (const [recipientId, recipientName] of [
      [p.patientId, p.patientName],
      [p.doctorId, p.doctorName],
    ]) {
      await client.query(
        `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
         VALUES ('email', 'booking_cancelled', $1, $2, $3::jsonb)`,
        [
          appointmentId,
          recipientId,
          JSON.stringify({
            recipientName,
            patientName: p.patientName,
            doctorName: p.doctorName,
            cancelledBy: role,
            reason: reason ?? null,
            ...slot,
          }),
        ]
      );
    }

    const { rows: events } = await client.query(
      `SELECT user_id, google_event_id, calendar_id
         FROM calendar_events WHERE appointment_id = $1 AND status = 'active'`,
      [appointmentId]
    );
    for (const e of events) {
      await client.query(
        `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
         VALUES ('calendar', 'event_delete', $1, $2, $3::jsonb)`,
        [
          appointmentId,
          e.user_id,
          JSON.stringify({ googleEventId: e.google_event_id, calendarId: e.calendar_id }),
        ]
      );
    }

    return { appointmentId, status: newStatus };
  });
}

export async function rescheduleAppointment(appointmentId, patientId, newStartsAt) {
  const old = await one(`SELECT doctor_id, patient_id, status FROM appointments WHERE id = $1`, [
    appointmentId,
  ]);
  if (!old) throw notFound('Appointment not found.');
  if (old.patient_id !== patientId) throw forbidden('This appointment does not belong to you.');
  if (!['held', 'confirmed'].includes(old.status)) {
    throw conflict('Appointment cannot be rescheduled from its current state.', {
      status: old.status,
    });
  }

  const doctor = await validateSlotRequest(old.doctor_id, newStartsAt);
  const newEndsAt = new Date(
    new Date(newStartsAt).getTime() + doctor.slotMinutes * 60000
  ).toISOString();

  try {
    return await withTransaction(async (client) => {
      const { rows: lockRows } = await client.query(
        `SELECT id, status FROM appointments WHERE id = $1 FOR UPDATE`,
        [appointmentId]
      );
      if (!['held', 'confirmed'].includes(lockRows[0]?.status)) {
        throw conflict('Appointment cannot be rescheduled from its current state.', {
          status: lockRows[0]?.status,
        });
      }

      await client.query(
        `UPDATE appointments SET status = 'cancelled_by_patient', cancel_reason = 'Rescheduled'
          WHERE id = $1`,
        [appointmentId]
      );

      const { rows: events } = await client.query(
        `SELECT user_id, google_event_id, calendar_id
           FROM calendar_events WHERE appointment_id = $1 AND status = 'active'`,
        [appointmentId]
      );

      const { rows: inserted } = await client.query(
        `INSERT INTO appointments
           (doctor_id, patient_id, starts_at, ends_at, status, hold_expires_at, rescheduled_from)
         VALUES ($1, $2, $3, $4, 'held', now() + ($5 || ' minutes')::interval, $6)
         RETURNING id AS "appointmentId", starts_at AS "startsAt", ends_at AS "endsAt",
                   hold_expires_at AS "holdExpiresAt"`,
        [old.doctor_id, patientId, newStartsAt, newEndsAt, config.booking.holdMinutes, appointmentId]
      );
      const newAppt = inserted[0];

      // The symptom form (and whatever the model already made of it) belongs
      // to the visit, not the slot - carry both onto the new held row so a
      // rescheduled appointment can still clear the confirm gate below
      // without the patient re-typing their symptoms or the model re-running.
      const { rows: formRows } = await client.query(
        `SELECT symptoms, duration, severity, existing_conditions, current_medications, allergies
           FROM symptom_forms WHERE appointment_id = $1`,
        [appointmentId]
      );
      if (formRows[0]) {
        const f = formRows[0];
        await client.query(
          `INSERT INTO symptom_forms
             (appointment_id, symptoms, duration, severity, existing_conditions, current_medications, allergies)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [newAppt.appointmentId, f.symptoms, f.duration, f.severity, f.existing_conditions, f.current_medications, f.allergies]
        );

        const { rows: summaryRows } = await client.query(
          `SELECT status, urgency, content, raw_response, model, prompt_version, attempts, last_error
             FROM ai_summaries WHERE appointment_id = $1 AND kind = 'pre_visit'`,
          [appointmentId]
        );
        const s = summaryRows[0];
        await client.query(
          `INSERT INTO ai_summaries
             (appointment_id, kind, status, urgency, content, raw_response, model, prompt_version, attempts, last_error)
           VALUES ($1, 'pre_visit', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newAppt.appointmentId,
            s?.status ?? 'pending',
            s?.urgency ?? null,
            s?.content ?? null,
            s?.raw_response ?? null,
            s?.model ?? null,
            s?.prompt_version ?? null,
            s?.attempts ?? 0,
            s?.last_error ?? null,
          ]
        );
      }

      for (const e of events) {
        await client.query(
          `INSERT INTO outbox (topic, event_type, appointment_id, recipient_id, payload)
           VALUES ('calendar', 'event_update', $1, $2, $3::jsonb)`,
          [
            newAppt.appointmentId,
            e.user_id,
            JSON.stringify({
              googleEventId: e.google_event_id,
              calendarId: e.calendar_id,
              startsAt: newAppt.startsAt,
              endsAt: newAppt.endsAt,
            }),
          ]
        );
      }

      return { ...newAppt, holdSeconds: config.booking.holdMinutes * 60, rescheduledFrom: appointmentId };
    });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'unique_active_appointment') throw slotTaken();
      if (err.constraint === 'unique_active_patient_slot') throw patientBusy();
    }
    throw err;
  }
}

export async function listAppointments({ user, status, from, to }) {
  const conditions = [];
  const params = [];

  if (user.role === 'patient') {
    params.push(user.id);
    conditions.push(`a.patient_id = $${params.length}`);
  } else if (user.role === 'doctor') {
    params.push(user.id);
    conditions.push(`a.doctor_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`a.starts_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`a.starts_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return many(
    `SELECT a.id, a.status, a.starts_at AS "startsAt", a.ends_at AS "endsAt",
            a.reason, a.cancel_reason AS "cancelReason",
            a.hold_expires_at AS "holdExpiresAt", a.rescheduled_from AS "rescheduledFrom",
            a.doctor_id AS "doctorId", du.full_name AS "doctorName",
            d.specialisation AS "doctorSpecialisation", pu.full_name AS "patientName"
       FROM appointments a
       JOIN doctors d ON d.user_id = a.doctor_id
       JOIN users du ON du.id = d.user_id
       JOIN users pu ON pu.id = a.patient_id
       ${where}
       ORDER BY a.starts_at DESC`,
    params
  );
}
