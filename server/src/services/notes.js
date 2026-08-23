/**
 * Post-visit clinical notes and prescriptions: submit, amend, and the
 * post-visit patient-friendly summary they drive. The LLM is never called
 * inline here - submitVisitNotes/amendVisitNotes only ever insert/reset a
 * 'pending' ai_summaries row; jobs/ai-summaries.js does the actual
 * generation on the next tick, so a doctor moving to the next patient is
 * never blocked on the model.
 */
import { one, withTransaction } from '../db/pool.js';
import { badRequest, notFound, forbidden, conflict, notesExist } from '../lib/errors.js';
import { isDateString } from '../lib/validate.js';
import { logEvent, actor } from './events.js';
import { scheduleMedicationReminders, scheduleFollowUpReminder } from './reminders.js';

function validateNotesPayload(body) {
  const fields = [];

  const clinicalNotes = typeof body.clinicalNotes === 'string' ? body.clinicalNotes.trim() : '';
  const diagnosis = typeof body.diagnosis === 'string' ? body.diagnosis.trim() : '';
  if (!clinicalNotes && !diagnosis) {
    fields.push('clinicalNotes', 'diagnosis');
  }

  let followUpDate = null;
  if (body.followUpDate !== undefined && body.followUpDate !== null && body.followUpDate !== '') {
    try {
      isDateString(body.followUpDate, 'followUpDate');
      followUpDate = body.followUpDate;
    } catch {
      fields.push('followUpDate');
    }
  }

  const rawPrescriptions = Array.isArray(body.prescriptions) ? body.prescriptions : [];
  const prescriptions = rawPrescriptions.map((p, i) => {
    const medicationName = typeof p?.medicationName === 'string' ? p.medicationName.trim() : '';
    const dosage = typeof p?.dosage === 'string' ? p.dosage.trim() : '';
    const frequencyPerDay = Number(p?.frequencyPerDay);
    const durationDays = Number(p?.durationDays);
    const instructions = typeof p?.instructions === 'string' ? p.instructions.trim() : '';

    if (!medicationName) fields.push(`prescriptions[${i}].medicationName`);
    if (!dosage) fields.push(`prescriptions[${i}].dosage`);
    if (!Number.isInteger(frequencyPerDay) || frequencyPerDay < 1 || frequencyPerDay > 6) {
      fields.push(`prescriptions[${i}].frequencyPerDay`);
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 180) {
      fields.push(`prescriptions[${i}].durationDays`);
    }

    return { medicationName, dosage, frequencyPerDay, durationDays, instructions: instructions || null };
  });

  if (fields.length > 0) {
    // The whole payload is rejected together - nothing above this point has
    // touched the database, so there is nothing to roll back either.
    throw badRequest('Notes payload failed validation.', { fields });
  }

  return { clinicalNotes, diagnosis, followUpDate, prescriptions };
}

async function insertPrescriptions(client, appointmentId, prescriptions) {
  const rows = [];
  for (const p of prescriptions) {
    const { rows: inserted } = await client.query(
      `INSERT INTO prescriptions (appointment_id, medication_name, dosage, frequency_per_day, duration_days, instructions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, medication_name AS "medicationName", dosage,
                 frequency_per_day AS "frequencyPerDay", duration_days AS "durationDays", instructions`,
      [appointmentId, p.medicationName, p.dosage, p.frequencyPerDay, p.durationDays, p.instructions]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

async function scheduleReminders(client, ctx, followUpDate, prescriptionRows) {
  const medication = await scheduleMedicationReminders(client, ctx, prescriptionRows);
  const followUp = followUpDate ? await scheduleFollowUpReminder(client, ctx, followUpDate) : { scheduled: false };
  return { medication, followUp };
}

export async function submitVisitNotes(appointmentId, doctorId, body) {
  const { clinicalNotes, diagnosis, followUpDate, prescriptions } = validateNotesPayload(body);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, doctor_id AS "doctorId", patient_id AS "patientId", starts_at AS "startsAt", status
         FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId]
    );
    const appt = rows[0];
    if (!appt) throw notFound('Appointment not found.');
    if (appt.doctorId !== doctorId) throw forbidden('This appointment does not belong to you.');

    // Checked BEFORE the generic status check below: by the time notes
    // already exist for an appointment, its status has already moved on to
    // 'completed', not 'confirmed' - so the generic check would win every
    // time and NOTES_EXIST would never actually fire for a genuine
    // duplicate-submission attempt.
    const existingNotes = await client.query(
      `SELECT 1 FROM visit_notes WHERE appointment_id = $1`,
      [appointmentId]
    );
    if (existingNotes.rows.length > 0) throw notesExist();

    if (appt.status !== 'confirmed') {
      throw conflict('Notes can only be submitted for a confirmed appointment.', { status: appt.status });
    }
    if (new Date(appt.startsAt) > new Date()) {
      throw conflict('Notes cannot be submitted before the visit has happened.', { startsAt: appt.startsAt });
    }

    try {
      await client.query(
        `INSERT INTO visit_notes (appointment_id, doctor_id, clinical_notes, diagnosis, follow_up_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [appointmentId, doctorId, clinicalNotes, diagnosis || null, followUpDate]
      );
    } catch (err) {
      // Backstop for the race where two concurrent submits both pass the
      // SELECT above before either INSERT commits - the unique constraint
      // on visit_notes.appointment_id is the actual source of truth.
      if (err.code === '23505') throw notesExist();
      throw err;
    }

    const prescriptionRows = await insertPrescriptions(client, appointmentId, prescriptions);

    await client.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [appointmentId]);

    await client.query(
      `INSERT INTO ai_summaries (appointment_id, kind, status) VALUES ($1, 'post_visit', 'pending')`,
      [appointmentId]
    );

    const ctx = { appointmentId, patientId: appt.patientId };
    const reminders = await scheduleReminders(client, ctx, followUpDate, prescriptionRows);

    await logEvent(client, appointmentId, 'notes_submitted', actor.doctor(doctorId));
    await logEvent(client, appointmentId, 'completed', actor.doctor(doctorId));
    if (reminders.medication.totalScheduled > 0 || reminders.followUp.scheduled) {
      const clampNote = reminders.medication.clampedPrescriptions.length > 0 ? ' (some clamped at the 400 cap)' : '';
      await logEvent(
        client,
        appointmentId,
        'medication_reminders_scheduled',
        actor.system,
        `${reminders.medication.totalScheduled} medication reminder(s)${reminders.followUp.scheduled ? ' + 1 follow-up' : ''}${clampNote}`
      );
    }

    return {
      appointmentId,
      status: 'completed',
      visitNotes: { clinicalNotes, diagnosis: diagnosis || null, followUpDate },
      prescriptions: prescriptionRows,
      postVisitSummaryStatus: 'pending',
      reminders,
    };
  });
}

export async function amendVisitNotes(appointmentId, doctorId, body) {
  const { clinicalNotes, diagnosis, followUpDate, prescriptions } = validateNotesPayload(body);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, doctor_id AS "doctorId", patient_id AS "patientId"
         FROM appointments WHERE id = $1 FOR UPDATE`,
      [appointmentId]
    );
    const appt = rows[0];
    if (!appt) throw notFound('Appointment not found.');
    if (appt.doctorId !== doctorId) throw forbidden('This appointment does not belong to you.');

    const existing = await client.query(`SELECT id FROM visit_notes WHERE appointment_id = $1`, [appointmentId]);
    if (existing.rows.length === 0) {
      throw notFound('No visit notes exist yet for this appointment - use POST to create them.');
    }

    await client.query(
      `UPDATE visit_notes SET clinical_notes = $2, diagnosis = $3, follow_up_date = $4 WHERE appointment_id = $1`,
      [appointmentId, clinicalNotes, diagnosis || null, followUpDate]
    );

    // Cancel still-scheduled reminders BEFORE touching prescriptions, then
    // decouple any reminder row (scheduled, cancelled, queued, or already
    // sent) from the prescriptions about to be replaced - reminders.
    // prescription_id is ON DELETE CASCADE, so deleting the old
    // prescriptions without this step would silently wipe out reminder
    // history (including ones already delivered), not just the ones being
    // superseded.
    const { rowCount: cancelledCount } = await client.query(
      `UPDATE reminders SET status = 'cancelled'
        WHERE appointment_id = $1 AND kind IN ('medication_reminder', 'follow_up') AND status = 'scheduled'`,
      [appointmentId]
    );
    await client.query(
      `UPDATE reminders SET prescription_id = NULL
        WHERE appointment_id = $1
          AND prescription_id IN (SELECT id FROM prescriptions WHERE appointment_id = $1)`,
      [appointmentId]
    );
    await client.query(`DELETE FROM prescriptions WHERE appointment_id = $1`, [appointmentId]);

    if (cancelledCount > 0) {
      await logEvent(
        client,
        appointmentId,
        'medication_reminders_cancelled',
        actor.doctor(doctorId),
        `${cancelledCount} reminder(s) cancelled for amendment`
      );
    }

    const prescriptionRows = await insertPrescriptions(client, appointmentId, prescriptions);

    // Reset the post-visit summary so it regenerates against the amended notes.
    await client.query(
      `UPDATE ai_summaries
          SET status = 'pending', attempts = 0, last_error = NULL, content = NULL, raw_response = NULL
        WHERE appointment_id = $1 AND kind = 'post_visit'`,
      [appointmentId]
    );

    const ctx = { appointmentId, patientId: appt.patientId };
    const reminders = await scheduleReminders(client, ctx, followUpDate, prescriptionRows);

    await logEvent(client, appointmentId, 'notes_amended', actor.doctor(doctorId));
    if (reminders.medication.totalScheduled > 0 || reminders.followUp.scheduled) {
      await logEvent(
        client,
        appointmentId,
        'medication_reminders_scheduled',
        actor.system,
        `${reminders.medication.totalScheduled} medication reminder(s)${reminders.followUp.scheduled ? ' + 1 follow-up' : ''} after amendment`
      );
    }

    return {
      appointmentId,
      visitNotes: { clinicalNotes, diagnosis: diagnosis || null, followUpDate },
      prescriptions: prescriptionRows,
      postVisitSummaryStatus: 'pending',
      reminders,
    };
  });
}

function authorizePostVisitAccess(appt, user) {
  if (user.role === 'admin') return;
  if (user.role === 'doctor' && appt.doctorId === user.id) return;
  if (user.role === 'patient' && appt.patientId === user.id) return;
  throw forbidden('You do not have access to this appointment.');
}

async function fetchPrescriptions(appointmentId) {
  const row = await one(
    `SELECT coalesce(json_agg(json_build_object(
              'id', id, 'medicationName', medication_name, 'dosage', dosage,
              'frequencyPerDay', frequency_per_day, 'durationDays', duration_days,
              'instructions', instructions
            ) ORDER BY created_at), '[]'::json) AS prescriptions
       FROM prescriptions WHERE appointment_id = $1`,
    [appointmentId]
  );
  return row.prescriptions;
}

async function fetchVisitNotes(appointmentId) {
  return one(
    `SELECT clinical_notes AS "clinicalNotes", diagnosis, follow_up_date AS "followUpDate"
       FROM visit_notes WHERE appointment_id = $1`,
    [appointmentId]
  );
}

/**
 * Returns status + content, plus the real prescription list ALWAYS (it is
 * the source of truth patients see alongside the AI rendering, not only as
 * a fallback) and the raw clinical notes when the AI summary is not
 * 'ready' for a patient - or always for the doctor/admin who is editing
 * them, so the same endpoint can prefill an amend form regardless of the
 * summary's own status.
 */
export async function getPostVisitSummary(appointmentId, user) {
  const appt = await one(
    `SELECT id, doctor_id AS "doctorId", patient_id AS "patientId" FROM appointments WHERE id = $1`,
    [appointmentId]
  );
  if (!appt) throw notFound('Appointment not found.');
  authorizePostVisitAccess(appt, user);

  const summary = await one(
    `SELECT status, content, updated_at AS "generatedAt"
       FROM ai_summaries WHERE appointment_id = $1 AND kind = 'post_visit'`,
    [appointmentId]
  );
  if (!summary) throw notFound('No visit notes have been submitted for this appointment yet.');

  const response = {
    status: summary.status,
    content: summary.content,
    generatedAt: summary.status === 'ready' ? summary.generatedAt : null,
    prescriptions: await fetchPrescriptions(appointmentId),
  };

  if (summary.status !== 'ready' || user.role !== 'patient') {
    response.visitNotes = await fetchVisitNotes(appointmentId);
  }

  return response;
}

export async function retryPostVisitSummary(appointmentId, user) {
  const appt = await one(`SELECT id, doctor_id AS "doctorId" FROM appointments WHERE id = $1`, [appointmentId]);
  if (!appt) throw notFound('Appointment not found.');
  if (user.role === 'doctor' && appt.doctorId !== user.id) {
    throw forbidden('You do not have access to this appointment.');
  }

  const result = await one(
    `UPDATE ai_summaries SET status = 'pending', attempts = 0, last_error = NULL
      WHERE appointment_id = $1 AND kind = 'post_visit'
      RETURNING id`,
    [appointmentId]
  );
  if (!result) throw notFound('No visit notes have been submitted for this appointment yet.');
  return { status: 'pending' };
}
