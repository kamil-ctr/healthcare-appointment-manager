/**
 * Runs scheduled jobs both in-process (setInterval) AND on demand via
 * POST /api/internal/jobs/tick. Free hosting tiers sleep idle instances, so
 * an external cron pinger has to be able to drive the same work the
 * in-process timer would otherwise do. The Day 6 outbox worker plugs into
 * runJobs() the same way expireHolds() does - leave the seam.
 */
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { expireHolds } from './expire-holds.js';
import { generatePendingSummaries } from './ai-summaries.js';

let intervalHandle;

export function startJobRunner() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runJobs().catch((err) => console.error('[jobs] tick failed:', err.message));
  }, config.jobs.intervalMs);
  intervalHandle.unref();
}

export function stopJobRunner() {
  clearInterval(intervalHandle);
  intervalHandle = undefined;
}

export async function runJobs() {
  const { expired } = await expireHolds();
  const { processed, ready, failed } = await generatePendingSummaries();
  // Day 6: const { sent, failed } = await processOutboxBatch();
  return {
    expiredHolds: expired,
    summariesProcessed: processed,
    summariesReady: ready,
    summariesFailed: failed,
  };
}

/** 'unset' | 'invalid' | 'ok'. Constant-time so timing can't leak the secret. */
export function checkJobSecret(headerValue) {
  if (!config.jobs.secret) return 'unset';
  if (typeof headerValue !== 'string' || !headerValue) return 'invalid';

  const provided = Buffer.from(headerValue);
  const expected = Buffer.from(config.jobs.secret);
  if (provided.length !== expected.length) return 'invalid';
  return timingSafeEqual(provided, expected) ? 'ok' : 'invalid';
}
