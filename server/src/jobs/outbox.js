/**
 * The delivery worker for the transactional outbox. Reachable through the
 * same tick as expire-holds/ai-summaries/reminders (see jobs/runner.js).
 * Handles both topics: 'email' via Nodemailer, 'calendar' via the Google
 * Calendar REST client (jobs/outbox.js is the only place Google is ever
 * called from - never a request path, per the day-7 non-negotiable).
 *
 * Two-phase claim, deliberately NOT the "hold the transaction open across
 * the external call" pattern used for ai_summaries on day 5 - outbox has a
 * real 'processing' status + locked_at for exactly this: claim a batch and
 * COMMIT quickly (phase 1), then act on each row outside any DB lock
 * (phase 2). SKIP LOCKED still guarantees two concurrent phase-1 claims
 * never pick the same row; locked_at is what stops a second tick's phase 1
 * from re-claiming a row still being processed by phase 2 of an earlier
 * tick - only claimable again once locked_at is older than STALE_MINUTES
 * (a crashed worker). Each row gets at most one attempt per tick, since the
 * batch is claimed once up front, not reclaimed in a loop (the bug fixed
 * in ai-summaries on day 5).
 */
import { one, query, withTransaction } from '../db/pool.js';
import { sendMail } from '../mail/transport.js';
import { renderEmail } from '../mail/templates.js';
import { getAccessToken } from '../google/tokens.js';
import { createEvent, patchEvent, deleteEvent, buildEventBody, GoogleCalendarError } from '../google/calendar.js';
import { logEvent, actor } from '../services/events.js';
import { buildIcs } from '../mail/ics.js';
import { config } from '../config.js';

const BATCH_SIZE = 10;
const STALE_MINUTES = 10;
// Roughly 1m, 5m, 15m, 1h, 6h - indexed by (attempts - 1), clamped to the last tier.
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];

function backoffDelayMs(attempts) {
  const tier = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  const jitter = 0.8 + Math.random() * 0.4; // 0.8x - 1.2x
  return Math.round(tier * 60000 * jitter);
}

/** Shared by the email and calendar handlers: backoff, or dead-letter at max_attempts. */
async function recordRetryOrDeadLetter(id, currentAttempts, maxAttempts, errorMessage) {
  const nextAttempts = currentAttempts + 1;
  if (nextAttempts >= maxAttempts) {
    // A dead letter, not a retry loop - stays 'failed' until an admin retries it.
    await query(`UPDATE outbox SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`, [
      id,
      nextAttempts,
      errorMessage,
    ]);
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

async function claimBatch(limit) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, topic FROM outbox
        WHERE topic IN ('email', 'calendar')
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
    return rows;
  });
}

// ---------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------
async function fetchOutboxDetail(id) {
  return one(
    `SELECT o.id, o.event_type AS "eventType", o.appointment_id AS "appointmentId",
            o.payload, o.attempts, o.max_attempts AS "maxAttempts",
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

const ICS_METHOD_BY_EVENT_TYPE = {
  booking_confirmation: 'REQUEST',
  booking_cancelled: 'CANCEL',
  leave_cancellation: 'CANCEL',
};

function parseFromAddress(from) {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from;
}

/**
 * Walks the rescheduled_from chain backward from this appointment to its
 * root, so the calendar UID (and SEQUENCE, counted across every row in
 * that chain) stay stable and monotonically increasing across the
 * appointment's whole life - a reschedule must update the same calendar
 * entry, never create a second one. SEQUENCE is derived from the
 * appointment_events count rather than a new column: every state change
 * already writes one of those rows in the same transaction, so the count
 * is already an accurate, free-riding "how many times has this changed".
 */
async function resolveIcsIdentity(appointmentId) {
  const { rows } = await query(
    `WITH RECURSIVE chain AS (
       SELECT id, rescheduled_from FROM appointments WHERE id = $1
       UNION ALL
       SELECT a.id, a.rescheduled_from
         FROM appointments a JOIN chain c ON a.id = c.rescheduled_from
     )
     SELECT id, rescheduled_from AS "rescheduledFrom" FROM chain`,
    [appointmentId]
  );
  const root = rows.find((r) => r.rescheduledFrom === null) ?? rows[rows.length - 1];
  const ids = rows.map((r) => r.id);
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = ANY($1::uuid[])`,
    [ids]
  );
  return { uid: root.id, sequence: countRows[0].n };
}

/** Returns nodemailer attachments: [] for event types that don't get an invite. */
async function buildIcsAttachment(row) {
  const method = ICS_METHOD_BY_EVENT_TYPE[row.eventType];
  if (!method || !row.appointmentId) return [];

  const slot = row.eventType === 'leave_cancellation' ? row.payload.originalSlot : row.payload;
  if (!slot?.startsAt || !slot?.endsAt) return [];

  const { uid, sequence } = await resolveIcsIdentity(row.appointmentId);
  const cancelling = method === 'CANCEL';
  const ics = buildIcs({
    uid,
    sequence,
    method,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    summary: `Appointment: ${row.payload.patientName} with ${row.payload.doctorName}`,
    description: cancelling ? `Cancelled${row.payload.reason ? `: ${row.payload.reason}` : '.'}` : undefined,
    organizerEmail: parseFromAddress(config.mail.from),
    organizerName: 'Clinic',
    attendeeEmail: row.recipientEmail,
    attendeeName: row.payload.recipientName || row.payload.patientName,
  });

  return [
    {
      filename: 'invite.ics',
      content: ics,
      contentType: `text/calendar; method=${method}; charset=utf-8`,
    },
  ];
}

async function processEmailOne(id) {
  const row = await fetchOutboxDetail(id);

  try {
    if (!row.recipientEmail) {
      throw new Error('Outbox row has no recipient email (recipient_id missing or user deleted).');
    }
    const { subject, text, html } = renderEmail(row.eventType, row.payload, row.doctorTimezone);
    const attachments = await buildIcsAttachment(row);
    await sendMail({ to: row.recipientEmail, subject, text, html, attachments });
    await withTransaction(async (client) => {
      await client.query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
      if (row.appointmentId) {
        await logEvent(client, row.appointmentId, 'email_sent', actor.system, row.eventType);
      }
    });
    return 'sent';
  } catch (err) {
    return recordRetryOrDeadLetter(id, row.attempts, row.maxAttempts, String(err.message || err).slice(0, 500));
  }
}

// ---------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------
async function fetchCalendarDetail(id) {
  return one(
    `SELECT o.id, o.event_type AS "eventType", o.payload, o.attempts, o.max_attempts AS "maxAttempts",
            o.recipient_id AS "userId", o.appointment_id AS "appointmentId",
            a.starts_at AS "startsAt", a.ends_at AS "endsAt",
            a.patient_id AS "patientId", pu.full_name AS "patientName",
            du.full_name AS "doctorName", d.specialisation, d.timezone AS "doctorTimezone",
            s.status AS "summaryStatus", s.content AS "summaryContent"
       FROM outbox o
       JOIN appointments a ON a.id = o.appointment_id
       JOIN users pu ON pu.id = a.patient_id
       JOIN doctors d ON d.user_id = a.doctor_id
       JOIN users du ON du.id = d.user_id
       LEFT JOIN ai_summaries s ON s.appointment_id = a.id AND s.kind = 'pre_visit'
      WHERE o.id = $1`,
    [id]
  );
}

function eventBodyForRow(row) {
  const isPatient = row.userId === row.patientId;
  const chiefComplaint = row.summaryStatus === 'ready' ? row.summaryContent?.chiefComplaint : null;
  // doctorName already carries its own "Dr." (see mail/templates.js's
  // leave_cancellation fix on day 6) - never prepend another one.
  const summary = isPatient
    ? `Appointment — ${row.doctorName} (${row.specialisation})`
    : `Appointment — ${row.patientName}`;
  return buildEventBody({
    summary,
    description: chiefComplaint ? `Chief complaint: ${chiefComplaint}` : undefined,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timezone: row.doctorTimezone,
  });
}

async function upsertCalendarEventRow(client, appointmentId, userId, googleEventId, calendarId) {
  await client.query(
    `INSERT INTO calendar_events (appointment_id, user_id, google_event_id, calendar_id, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (appointment_id, user_id) DO UPDATE SET
       google_event_id = EXCLUDED.google_event_id, calendar_id = EXCLUDED.calendar_id, status = 'active'`,
    [appointmentId, userId, googleEventId, calendarId]
  );
}

async function processCalendarOne(id) {
  const row = await fetchCalendarDetail(id);
  const accessToken = await getAccessToken(row.userId);

  if (accessToken === null) {
    // No google_accounts row, or revoked_at is set. Not an error - and
    // must not retry five times like a transient failure would; mark it
    // terminally in one step and move on.
    await query(
      `UPDATE outbox SET status = 'failed', attempts = max_attempts, last_error = 'google_not_connected'
        WHERE id = $1`,
      [id]
    );
    return 'failed';
  }

  try {
    const calendarId = row.payload?.calendarId || 'primary';

    if (row.eventType === 'event_create') {
      const event = await createEvent(accessToken, 'primary', eventBodyForRow(row));
      await withTransaction(async (client) => {
        await upsertCalendarEventRow(client, row.appointmentId, row.userId, event.id, 'primary');
        await client.query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
        await logEvent(client, row.appointmentId, 'calendar_event_created', actor.system, row.userId === row.patientId ? 'patient' : 'doctor');
      });
      return 'sent';
    }

    if (row.eventType === 'event_update') {
      const { googleEventId } = row.payload;
      const result = await patchEvent(accessToken, calendarId, googleEventId, eventBodyForRow(row));
      await withTransaction(async (client) => {
        if (result.deleted) {
          // Gone on Google's side - nothing to patch, and the stale
          // mapping shouldn't be used for a future delete either.
          await client.query(
            `UPDATE calendar_events SET status = 'cancelled' WHERE google_event_id = $1 AND user_id = $2`,
            [googleEventId, row.userId]
          );
        } else {
          await upsertCalendarEventRow(client, row.appointmentId, row.userId, googleEventId, calendarId);
        }
        await client.query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
      });
      return 'sent';
    }

    if (row.eventType === 'event_delete') {
      const { googleEventId } = row.payload;
      // Idempotent either way - deleteEvent never throws on 404/410.
      await deleteEvent(accessToken, calendarId, googleEventId);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE calendar_events SET status = 'cancelled' WHERE google_event_id = $1 AND user_id = $2`,
          [googleEventId, row.userId]
        );
        await client.query(`UPDATE outbox SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
        await logEvent(client, row.appointmentId, 'calendar_event_deleted', actor.system, row.userId === row.patientId ? 'patient' : 'doctor');
      });
      return 'sent';
    }

    throw new Error(`Unknown calendar event_type "${row.eventType}".`);
  } catch (err) {
    if (err instanceof GoogleCalendarError && err.status === 401) {
      // The access token was rejected outright even though it looked
      // fresh - terminal, same as an invalid_grant refresh failure.
      await withTransaction(async (client) => {
        await client.query(`UPDATE google_accounts SET revoked_at = now() WHERE user_id = $1`, [row.userId]);
        await client.query(
          `UPDATE outbox SET status = 'failed', attempts = max_attempts, last_error = 'google_unauthorized'
            WHERE id = $1`,
          [id]
        );
      });
      return 'failed';
    }
    // 403 rateLimitExceeded, 429, 5xx, network errors - all retryable
    // through the same backoff path email failures use.
    return recordRetryOrDeadLetter(id, row.attempts, row.maxAttempts, String(err.message || err).slice(0, 500));
  }
}

export async function processOutboxBatch() {
  const claimed = await claimBatch(BATCH_SIZE);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of claimed) {
    const outcome = row.topic === 'calendar' ? await processCalendarOne(row.id) : await processEmailOne(row.id);
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'retry') retried += 1;
    else failed += 1;
  }

  return { claimed: claimed.length, sent, retried, failed };
}
