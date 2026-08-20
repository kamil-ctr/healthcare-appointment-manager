/**
 * Generates pre-visit AND post-visit LLM summaries for pending/failed
 * ai_summaries rows - one shared job, one shared claim/retry/backoff
 * policy, dispatched by `kind`. Reachable through the same tick as
 * expire-holds (see jobs/runner.js).
 *
 * Claiming uses FOR UPDATE SKIP LOCKED on the ai_summaries row, and the
 * transaction stays open across the LLM call itself - the classic
 * job-queue-via-row-lock pattern, so two overlapping ticks can never
 * process the same row twice. ai_summaries has no separate 'processing'
 * status or next_retry_at column (unlike outbox), so a failed row becomes
 * immediately re-eligible by status alone - excludeIds keeps a single tick
 * from re-claiming the row it just failed and burning all of its attempts
 * back-to-back. The tick interval itself (jobs/runner.js) is the backoff:
 * a row gets at most one attempt per tick, spaced JOB_INTERVAL_MS apart.
 */
import { withTransaction } from '../db/pool.js';
import { generatePreVisitSummary } from '../llm/pre-visit.js';
import { generatePostVisitSummary } from '../llm/post-visit.js';
import { logEvent, actor } from '../services/events.js';

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

async function generateForRow(client, row) {
  if (row.kind === 'pre_visit') {
    const { rows: formRows } = await client.query(
      `SELECT symptoms, duration, severity, existing_conditions AS "existingConditions",
              current_medications AS "currentMedications", allergies
         FROM symptom_forms WHERE appointment_id = $1`,
      [row.appointmentId]
    );
    const result = await generatePreVisitSummary(formRows[0]);
    return { ...result, urgency: result.content.urgency };
  }

  const { rows: noteRows } = await client.query(
    `SELECT clinical_notes AS "clinicalNotes", diagnosis FROM visit_notes WHERE appointment_id = $1`,
    [row.appointmentId]
  );
  const { rows: prescriptionRows } = await client.query(
    `SELECT medication_name AS "medicationName", dosage, frequency_per_day AS "frequencyPerDay",
            duration_days AS "durationDays", instructions
       FROM prescriptions WHERE appointment_id = $1`,
    [row.appointmentId]
  );
  const result = await generatePostVisitSummary({ ...noteRows[0], prescriptions: prescriptionRows });
  return { ...result, urgency: null };
}

async function claimAndProcessOne(excludeIds) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT s.id, s.kind, s.appointment_id AS "appointmentId"
         FROM ai_summaries s
        WHERE s.kind IN ('pre_visit', 'post_visit') AND s.status IN ('pending', 'failed') AND s.attempts < $1
          AND s.id <> ALL($2::uuid[])
        ORDER BY s.created_at
        FOR UPDATE OF s SKIP LOCKED
        LIMIT 1`,
      [MAX_ATTEMPTS, excludeIds]
    );
    const row = rows[0];
    if (!row) return null;

    const readyEvent = row.kind === 'pre_visit' ? 'summary_ready' : 'post_visit_summary_ready';
    const failedEvent = row.kind === 'pre_visit' ? 'summary_failed' : 'post_visit_summary_failed';

    try {
      const { content, raw, model, promptVersion, urgency } = await generateForRow(client, row);
      await client.query(
        `UPDATE ai_summaries
            SET status = 'ready', urgency = $2, content = $3::jsonb, raw_response = $4,
                model = $5, prompt_version = $6, attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [row.id, urgency, JSON.stringify(content), raw, model, promptVersion]
      );
      await logEvent(client, row.appointmentId, readyEvent, actor.system, urgency ? `urgency=${urgency}` : '');
      return { id: row.id, outcome: 'ready' };
    } catch (err) {
      // Any failure - timeout, non-200, malformed JSON that survived the
      // one repair attempt, or (post-visit only) a hallucinated/missing
      // medication that survived the repair - lands here. 'failed' is a
      // normal outcome, not a crash: the row stays retryable until
      // attempts hits MAX_ATTEMPTS, one attempt per tick (see excludeIds).
      await client.query(
        `UPDATE ai_summaries SET status = 'failed', attempts = attempts + 1, last_error = $2
          WHERE id = $1`,
        [row.id, String(err.message || err).slice(0, 500)]
      );
      await logEvent(client, row.appointmentId, failedEvent, actor.system, String(err.message || err).slice(0, 200));
      return { id: row.id, outcome: 'failed' };
    }
  });
}

export async function generatePendingSummaries() {
  let processed = 0;
  let ready = 0;
  let failed = 0;
  const claimedIds = [];

  for (let i = 0; i < BATCH_SIZE; i += 1) {
    const result = await claimAndProcessOne(claimedIds);
    if (!result) break;
    claimedIds.push(result.id);
    processed += 1;
    if (result.outcome === 'ready') ready += 1;
    else failed += 1;
  }

  return { processed, ready, failed };
}
