# System Design Write-up

> Deliverable 4 — 800 words max. Drafted incrementally; finalised on day 10.
> Current draft: ~750 words.

## 1. Double-booking prevention

Slot uniqueness is a database invariant, not application logic:

```sql
CREATE UNIQUE INDEX unique_active_appointment
  ON appointments (doctor_id, starts_at)
  WHERE status IN ('held', 'confirmed');
```

Booking is a single `INSERT` inside a transaction. Under concurrent load exactly one insert
commits; the others raise SQLSTATE `23505`, which the API translates into `409 CONFLICT`. No
read-then-write gap exists, so no lost update is possible regardless of request interleaving or
process count.

Verified with `server/scripts/concurrency-check.js`: 20 simultaneous holds on one slot →
1 success, 19 conflicts, 1 row in the database.

Because the index is *partial*, cancelled and expired appointments are excluded, so a released
slot is immediately bookable again without any cleanup step.

## 2. Doctor leave conflict handling

Marking a doctor unavailable for a date is one `withTransaction` call: insert
`doctor_leave`, lock that date's held/confirmed appointments with `SELECT ... FOR UPDATE`,
cancel them, and enqueue their notifications - all in one transaction. A duplicate leave
date raises SQLSTATE `23505` before any appointment is touched: zero side effects, never a
partial cascade.

The date match is `(starts_at AT TIME ZONE doctors.timezone)::date = $date`, never a bare
UTC comparison. A doctor's local calendar date and the UTC date of the same instant diverge
near midnight for any non-zero UTC offset - for `Asia/Kolkata` (+5:30), an early-morning
appointment can carry a UTC date one day earlier than the doctor's wall-clock date. A raw
UTC comparison would silently miss it.

Notifications are `outbox` rows in that same transaction, not sent inline. A recorded leave
never exists without its notification, and a failed email/Google call can't roll back or
block the leave - retrying is the outbox worker's job (day 6), not this request's.

Deleting a leave record does not un-cancel its appointments: patients were already told
their slot is gone, and reviving it would contradict a notification already sent.
Re-booking, not un-cancelling, is the correct path back to a confirmed slot.

## 3. Slot hold mechanism

Booking is two-phase - hold, then confirm - because a patient needs a window to fill in
details (and, from day 5, a symptom form) before the slot is final. A single-phase
insert-and-done would either lock the slot forever on an abandoned form or force a
mid-flow re-check, reopening the exact race the unique index exists to close.

`hold_expires_at` lives on the `appointments` row, not in memory or Redis, because that row
is already the source of truth for slot ownership: `unique_active_appointment`
(`WHERE status IN ('held','confirmed')`) has to know a hold's deadline to decide if it's
still active. An in-memory timer drifts across restarts and vanishes on a crash; a Redis
TTL would need to stay consistent with the row across two systems for no real benefit.

Because the index is partial, an expired or cancelled appointment simply stops matching
its `WHERE` clause the instant its status changes - bookable again immediately, no cleanup.

The sweep (`status='held' AND hold_expires_at < now()` -> `'expired'`) runs both on an
in-process interval and behind `POST /api/internal/jobs/tick`, guarded by a shared secret,
so a free-tier host that sleeps idle instances can still be driven by an external cron
pinger hitting the same endpoint.

## 4. Notification failure handling

The `outbox` row is written in the *same transaction* as the business change, so a confirmed
booking can never exist without its pending notification, and a failing SMTP call can't roll it
back - sending is fully decoupled from the request that caused it.

The worker claims a batch with `FOR UPDATE SKIP LOCKED`, marks it `'processing'`, and commits -
a short transaction, not one held open across the network call. `SKIP LOCKED` lets overlapping
ticks claim disjoint rows with zero coordination; `locked_at` stops a second tick re-claiming a
row an earlier one is still sending, since the row lock itself is gone once phase one commits.
Only once `locked_at` exceeds ten minutes - a crashed worker - does the row become claimable
again, through that same query, never a separate "unstick" step.

Backoff is exponential per attempt (~1m, 5m, 15m, 1h, 6h) with jitter, written into
`next_retry_at` on every failure. At `attempts >= max_attempts` the row becomes `'failed'` - a
dead letter an admin retries deliberately via `POST /api/admin/outbox/:id/retry`, not something
the worker keeps hammering.

`runJobs()` runs both on an interval and behind `POST /api/internal/jobs/tick` (shared-secret
guarded), so a sleeping free-tier instance still delivers once cron wakes it.
