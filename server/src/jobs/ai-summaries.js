/**
 * Generates pre-visit LLM summaries for pending/failed ai_summaries rows.
 * Reachable through the same tick as expire-holds (see jobs/runner.js).
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

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

async function claimAndProcessOne(excludeIds) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT s.id, f.symptoms, f.duration, f.severity,
              f.existing_conditions AS "existingConditions",
              f.current_medications AS "currentMedications", f.allergies
         FROM ai_summaries s
         JOIN symptom_forms f ON f.appointment_id = s.appointment_id
        WHERE s.kind = 'pre_visit' AND s.status IN ('pending', 'failed') AND s.attempts < $1
          AND s.id <> ALL($2::uuid[])
        ORDER BY s.created_at
        FOR UPDATE OF s SKIP LOCKED
        LIMIT 1`,
      [MAX_ATTEMPTS, excludeIds]
    );
    const row = rows[0];
    if (!row) return null;

    try {
      const { content, raw, model, promptVersion } = await generatePreVisitSummary(row);
      await client.query(
        `UPDATE ai_summaries
            SET status = 'ready', urgency = $2, content = $3::jsonb, raw_response = $4,
                model = $5, prompt_version = $6, attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [row.id, content.urgency, JSON.stringify(content), raw, model, promptVersion]
      );
      return { id: row.id, outcome: 'ready' };
    } catch (err) {
      // Any failure - timeout, non-200, malformed JSON that survived the
      // one repair attempt - lands here. 'failed' is a normal outcome, not
      // a crash: the row stays retryable until attempts hits MAX_ATTEMPTS,
      // one attempt per tick (see excludeIds above).
      await client.query(
        `UPDATE ai_summaries SET status = 'failed', attempts = attempts + 1, last_error = $2
          WHERE id = $1`,
        [row.id, String(err.message || err).slice(0, 500)]
      );
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
