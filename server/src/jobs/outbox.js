/**
 * The delivery worker for the transactional outbox. Reachable through the
 * same tick as expire-holds/ai-summaries/reminders (see jobs/runner.js).
 *
 * Two-phase claim, deliberately NOT the "hold the transaction open across
 * the external call" pattern used for ai_summaries on day 5 - outbox has a
 * real 'processing' status + locked_at for exactly this: claim a batch and
 * COMMIT quickly (phase 1), then send each email outside any DB lock
 * (phase 2). SKIP LOCKED still guarantees two concurrent phase-1 claims
 * never pick the same row; locked_at is what stops a second tick's phase 1
 * from re-claiming a row still being sent by phase 2 of an earlier tick -
 * only claimable again once locked_at is older than STALE_MINUTES (a
 * crashed worker). Each row gets at most one send attempt per tick, since
 * the batch is claimed once up front, not reclaimed in a loop (the bug
 * fixed in ai-summaries on day 5).
 *
 * topic = 'calendar' rows are excluded from the claim query entirely, so
 * they are never marked 'processing' and never touched - Day 7's handler
 * owns them.
 */
import { one, query, withTransaction } from '../db/pool.js';
import { sendMail } from '../mail/transport.js';
import { renderEmail } from '../mail/templates.js';

const BATCH_SIZE = 10;
const STALE_MINUTES = 10;
// Roughly 1m, 5m, 15m, 1h, 6h - indexed by (attempts - 1), clamped to the last tier.
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];

function backoffDelayMs(attempts) {
  const tier = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  const jitter = 0.8 + Math.random() * 0.4; // 0.8x - 1.2x
  return Math.round(tier * 60000 * jitter);
}

async function claimBatch(limit) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM outbox
        WHERE topic = 'email'
          AND next_retry_at <= now()
          AND attempts < max_attempts
          AND (
            status = 'pending'
            OR (status = 'processing' AND locked_at < now() - ($2 || ' minutes')::interval)
          )
        ORDER BY next_retry_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit, STALE_MINUTES]
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await client.query(
        `UPDATE outbox SET status = 'processing', locked_at = now() WHERE id = ANY($1::uuid[])`,
        [ids]
      );
    }
    return ids;
  });
}

async function fetchOutboxDetail(id) {
  return one(
    `SELECT o.id, o.event_type AS "eventType", o.payload, o.attempts, o.max_attempts AS "maxAttempts",
            ru.email AS "recipientEmail",
            COALESCE(da.timezone, dr.timezone, 'UTC') AS "doctorTimezone"
       FROM outbox o
       LEFT JOIN users ru ON ru.id = o.recipient_id
       LEFT JOIN appointments a ON a.id = o.appointment_id
       LEFT JOIN doctors da ON da.user_id = a.doctor_id
       LEFT JOIN doctors dr ON dr.user_id = o.recipient_id
      WHERE o.id = $1`,
    [id]
  );
}

async function processOne(id) {
  const row = await fetchOutboxDetail(id);

  try {
    if (!row.recipientEmail) {
      throw new Error('Outbox row has no recipient email (recipient_id missing or user deleted).');
    }
    const { subject, text, html } = renderEmail(row.eventType, row.payload, row.doctorTimezone);
    await sendMail({ to: row.recipientEmail, subject, text, html });
    await query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
    return 'sent';
  } catch (err) {
    const nextAttempts = row.attempts + 1;
    const errorMessage = String(err.message || err).slice(0, 500);

    if (nextAttempts >= row.maxAttempts) {
      // A dead letter, not a retry loop - stays 'failed' until an admin retries it.
      await query(
        `UPDATE outbox SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`,
        [id, nextAttempts, errorMessage]
      );
      return 'failed';
    }

    const delayMs = backoffDelayMs(nextAttempts);
    await query(
      `UPDATE outbox
          SET status = 'pending', attempts = $2, last_error = $3,
              next_retry_at = now() + ($4 || ' milliseconds')::interval
        WHERE id = $1`,
      [id, nextAttempts, errorMessage, delayMs]
    );
    return 'retry';
  }
}

export async function processOutboxBatch() {
  const ids = await claimBatch(BATCH_SIZE);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const id of ids) {
    const outcome = await processOne(id);
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'retry') retried += 1;
    else failed += 1;
  }

  return { claimed: ids.length, sent, retried, failed };
}
