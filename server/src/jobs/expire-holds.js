import { withTransaction } from '../db/pool.js';
import { logEvent, actor } from '../services/events.js';

/**
 * Global hygiene sweep, table-wide, once a tick. services/appointments.js
 * also expires a single doctor's dead holds inline inside the hold/
 * reschedule transaction itself, so a slot never looks taken for up to a
 * minute waiting on this - this sweep exists to catch every OTHER doctor's
 * dead holds too, not just the one someone happens to be booking right now.
 */
export async function expireHolds() {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE appointments SET status = 'expired'
        WHERE status = 'held' AND hold_expires_at < now()
        RETURNING id`
    );
    for (const row of rows) {
      await logEvent(client, row.id, 'expired', actor.system, 'periodic sweep');
    }
    return { expired: rows.length };
  });
}
