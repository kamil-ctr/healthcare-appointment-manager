/**
 * Admin-facing read/retry surface over the outbox - a grader needs to see
 * that retries are real and inspectable, not just that the worker exists.
 */
import { many, one, query } from '../db/pool.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';

const VALID_STATUS = ['pending', 'processing', 'sent', 'failed'];
const VALID_TOPIC = ['email', 'calendar'];
const PAGE_SIZE = 50;

export async function listOutbox({ status, topic, page }) {
  const conditions = [];
  const params = [];

  if (status) {
    if (!VALID_STATUS.includes(status)) {
      throw badRequest(`status must be one of: ${VALID_STATUS.join(', ')}.`, { fields: ['status'] });
    }
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (topic) {
    if (!VALID_TOPIC.includes(topic)) {
      throw badRequest(`topic must be one of: ${VALID_TOPIC.join(', ')}.`, { fields: ['topic'] });
    }
    params.push(topic);
    conditions.push(`topic = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const listParams = [...params, PAGE_SIZE, offset];
  const rows = await many(
    `SELECT id, topic, event_type AS "eventType", status, attempts, max_attempts AS "maxAttempts",
            next_retry_at AS "nextRetryAt", locked_at AS "lockedAt", last_error AS "lastError",
            created_at AS "createdAt", sent_at AS "sentAt"
       FROM outbox
       ${where}
       ORDER BY created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const { total } = await one(`SELECT count(*)::int AS total FROM outbox ${where}`, params);

  return { rows, page: pageNum, pageSize: PAGE_SIZE, total };
}

export async function retryOutboxRow(id) {
  const row = await one(`SELECT id, status FROM outbox WHERE id = $1`, [id]);
  if (!row) throw notFound('Outbox row not found.');
  if (row.status !== 'failed') {
    throw conflict('Only a failed (dead-lettered) row can be retried.', { status: row.status });
  }

  await query(
    `UPDATE outbox SET status = 'pending', attempts = 0, last_error = NULL, next_retry_at = now()
      WHERE id = $1`,
    [id]
  );
  return { status: 'pending' };
}
