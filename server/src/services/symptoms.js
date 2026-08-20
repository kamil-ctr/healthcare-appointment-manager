/**
 * Symptom form submission and pre-visit summary retrieval/retry. The LLM
 * call itself never happens inline here - submitSymptomForm only ever
 * inserts a 'pending' ai_summaries row in the same transaction as the
 * symptom_forms row; jobs/ai-summaries.js does the actual generation on the
 * next tick. A patient mid-hold-countdown must never wait on the model.
 */
import { one, query, withTransaction } from '../db/pool.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { logEvent, actor } from './events.js';

export async function submitSymptomForm(appointmentId, patientId, body) {
  const symptoms = typeof body.symptoms === 'string' ? body.symptoms.trim() : '';
  if (!symptoms) {
    throw badRequest('symptoms is required.', { fields: ['symptoms'] });
  }

  let severity = null;
  if (body.severity !== undefined && body.severity !== null && body.severity !== '') {
    severity = Number(body.severity);
    if (!Number.isInteger(severity) || severity < 1 || severity > 10) {
      throw badRequest('severity must be an integer between 1 and 10.', { fields: ['severity'] });
    }
  }

  const appt = await one(
    `SELECT id, patient_id AS "patientId", status FROM appointments WHERE id = $1`,
    [appointmentId]
  );
  if (!appt) throw notFound('Appointment not found.');
  if (appt.patientId !== patientId) throw forbidden('This appointment does not belong to you.');
  if (!['held', 'confirmed'].includes(appt.status)) {
    throw conflict('Symptoms can only be submitted for a held or confirmed appointment.', {
      status: appt.status,
    });
  }

  try {
    return await withTransaction(async (client) => {
      const { rows: formRows } = await client.query(
        `INSERT INTO symptom_forms
           (appointment_id, symptoms, duration, severity, existing_conditions, current_medications, allergies)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          appointmentId,
          symptoms,
          body.duration?.trim() || null,
          severity,
          body.existingConditions?.trim() || null,
          body.currentMedications?.trim() || null,
          body.allergies?.trim() || null,
        ]
      );
      const { rows: summaryRows } = await client.query(
        `INSERT INTO ai_summaries (appointment_id, kind, status)
         VALUES ($1, 'pre_visit', 'pending')
         RETURNING id`,
        [appointmentId]
      );
      await logEvent(client, appointmentId, 'symptoms_submitted', actor.patient(patientId));
      return { symptomFormId: formRows[0].id, aiSummaryId: summaryRows[0].id, status: 'pending' };
    });
  } catch (err) {
    if (err.code === '23505') {
      throw conflict('A symptom form has already been submitted for this appointment.');
    }
    throw err;
  }
}

function authorizeSummaryAccess(appt, user) {
  if (user.role === 'admin') return;
  if (user.role === 'doctor' && appt.doctorId === user.id) return;
  if (user.role === 'patient' && appt.patientId === user.id) return;
  throw forbidden('You do not have access to this appointment.');
}

async function fetchRawSymptomForm(appointmentId) {
  return one(
    `SELECT symptoms, duration, severity, existing_conditions AS "existingConditions",
            current_medications AS "currentMedications", allergies
       FROM symptom_forms WHERE appointment_id = $1`,
    [appointmentId]
  );
}

export async function getPreVisitSummary(appointmentId, user) {
  const appt = await one(
    `SELECT id, doctor_id AS "doctorId", patient_id AS "patientId" FROM appointments WHERE id = $1`,
    [appointmentId]
  );
  if (!appt) throw notFound('Appointment not found.');
  authorizeSummaryAccess(appt, user);

  const summary = await one(
    `SELECT status, urgency, content, updated_at AS "generatedAt"
       FROM ai_summaries WHERE appointment_id = $1 AND kind = 'pre_visit'`,
    [appointmentId]
  );
  if (!summary) throw notFound('No symptom form has been submitted for this appointment.');

  const response = {
    status: summary.status,
    urgency: summary.urgency,
    content: summary.content,
    generatedAt: summary.status === 'ready' ? summary.generatedAt : null,
  };

  // The doctor always has something clinically useful, even when the model
  // hasn't run yet or gave up - never a spinner with nothing behind it.
  if (summary.status !== 'ready') {
    response.symptomForm = await fetchRawSymptomForm(appointmentId);
  }

  return response;
}

export async function retryPreVisitSummary(appointmentId, user) {
  const appt = await one(
    `SELECT id, doctor_id AS "doctorId" FROM appointments WHERE id = $1`,
    [appointmentId]
  );
  if (!appt) throw notFound('Appointment not found.');
  if (user.role === 'doctor' && appt.doctorId !== user.id) {
    throw forbidden('You do not have access to this appointment.');
  }

  const { rowCount } = await query(
    `UPDATE ai_summaries SET status = 'pending', attempts = 0, last_error = NULL
      WHERE appointment_id = $1 AND kind = 'pre_visit'`,
    [appointmentId]
  );
  if (rowCount === 0) throw notFound('No symptom form has been submitted for this appointment.');
  return { status: 'pending' };
}
