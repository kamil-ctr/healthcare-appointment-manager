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

_To be written on day 3._

## 3. Slot hold mechanism

_To be written on day 4._

## 4. Notification failure handling

_To be written on day 6._
