import { query } from '../db/pool.js';

/** Frees up stale holds so the slot becomes bookable again immediately. */
export async function expireHolds() {
  const { rowCount } = await query(
    `UPDATE appointments SET status = 'expired'
      WHERE status = 'held' AND hold_expires_at < now()`
  );
  return { expired: rowCount };
}
