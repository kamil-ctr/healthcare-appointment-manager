# System Design Write-up

> Deliverable 4 — 800 words max.

## 1. Double-booking prevention

Slot uniqueness is enforced by the database, not by application code:

```sql
CREATE UNIQUE INDEX unique_active_appointment
  ON appointments (doctor_id, starts_at)
  WHERE status IN ('held', 'confirmed');
```

Booking is one `INSERT` inside a transaction. Under concurrent load, exactly one insert succeeds
and the rest raise SQLSTATE `23505`, mapped to `409 CONFLICT`. There's no gap between reading and
writing, so no request can silently overwrite another.

Checked with `server/scripts/concurrency-check.js`: 20 requests fired at one slot at once produce
1 success, 19 conflicts, 1 row in the database. Getting exactly 19 conflicts needs a client that
hasn't recently hit the rate limit - the one-row guarantee itself doesn't depend on it.

Because the index is partial, cancelled and expired appointments don't count toward it, so a
released slot is bookable again right away, with no cleanup step.

## 2. Doctor leave conflict handling

Marking a doctor unavailable for a date is one transaction: insert the `doctor_leave` row, lock
that date's held/confirmed appointments with `SELECT ... FOR UPDATE`, cancel them, and queue
their notifications. A duplicate leave date raises SQLSTATE `23505` before any appointment is
touched, so there's never a half-finished cancellation.

The date match is `(starts_at AT TIME ZONE doctors.timezone)::date = $date`, never a plain UTC
comparison. A doctor's local date and the UTC date of the same moment can differ near midnight -
for `Asia/Kolkata` (+5:30), an early-morning appointment can carry a UTC date one day earlier
than the doctor's own wall-clock date. A raw UTC comparison would silently get this wrong.

Notifications are `outbox` rows in that same transaction, never sent right away, so a failed
email or Google call can't block the leave - retrying is the outbox worker's job.

Removing a leave record doesn't bring back the appointments it cancelled. Patients were already
told their slot was gone, and quietly reviving it would contradict a message already sent.
Booking a new slot, not un-cancelling the old one, is the right way back.

## 3. Slot hold mechanism

Booking happens in two steps - hold, then confirm - because a patient needs time to fill in the
symptom form before the slot is locked in. One step would either hold the slot forever if the
form is never finished, or need a mid-flow check, reopening the race the unique index closes.

`hold_expires_at` lives on the `appointments` row itself, not in memory or Redis. That row is
already the source of truth for who owns the slot, so a separate timer would just be another
system that has to stay in sync with it for no real benefit.

Because the index is partial, an expired or cancelled appointment stops matching its `WHERE`
clause the moment its status changes - bookable again immediately, with nothing to clean up.

A background sweep (`status='held' AND hold_expires_at < now()` → `'expired'`) runs once per
tick, so a dead hold can still look taken for up to a minute. To close that gap, `holdAppointment`
and `rescheduleAppointment` also run a quick sweep of their own first, scoped to just that one
doctor, in the same transaction as the new booking - so booking right after someone else's hold
died is never blocked by a row the periodic sweep hasn't reached yet. That sweep still matters as
a backstop for doctors nobody is actively booking against. It runs on an interval in-process, and
behind `POST /api/internal/jobs/tick` (secret-protected) so an external cron job can drive it too.

## 4. Notification failure handling

The `outbox` row is written in the same transaction as the change that caused it, so a confirmed
booking can never exist without its notification queued, and a failing SMTP call can't undo the
booking. Sending is fully separate from the request that triggered it.

The worker claims a batch with `FOR UPDATE SKIP LOCKED`, marks it `'processing'`, and commits - a
short transaction, not one held open across a slow network call. `SKIP LOCKED` lets overlapping
ticks claim different rows with no coordination. `locked_at` stops a second tick grabbing a row
an earlier one is still working on, since the actual row lock is gone once that commits. Only
once `locked_at` is older than ten minutes - meaning that worker likely crashed - is the row
claimable again, through that same query.

Backoff grows with each attempt (roughly 1m, 5m, 15m, 1h, 6h, plus some jitter), written into
`next_retry_at` after every failure. Once `attempts` reaches `max_attempts`, the row is marked
`'failed'` - a dead letter an admin can retry on purpose via `POST /api/admin/outbox/:id/retry`,
rather than something the worker keeps hammering on its own.

`runJobs()` runs on a timer and behind `POST /api/internal/jobs/tick`, so a sleeping free-tier
instance still delivers its queued notifications once an external cron job wakes it up.
