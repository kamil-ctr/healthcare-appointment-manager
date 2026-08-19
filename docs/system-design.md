# System Design Write-up

> Deliverable 4 — 800 words max. Drafted incrementally; finalised on day 10.
> Current draft: ~180 words.

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

_To be written on day 4._

## 4. Notification failure handling

_To be written on day 6._
