# API Reference

Base URL: `/api`
All responses are JSON. Errors share one shape:

```json
{ "error": { "code": "SLOT_TAKEN", "message": "That slot was just taken.", "details": {} },
  "requestId": "..." }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Validation failed |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Wrong role for this route |
| 404 | `NOT_FOUND` | No such resource or route |
| 409 | `CONFLICT` | Resource is not in a state that allows this action |
| 409 | `EMAIL_TAKEN` | Registration email already in use (case-insensitive) |
| 409 | `SLOT_TAKEN` | Another appointment already holds/confirms that doctor+time |
| 409 | `PATIENT_BUSY` | Patient already holds/confirms a different doctor at that instant |
| 409 | `HOLD_EXPIRED` | The hold window passed before confirm |
| 409 | `SYMPTOMS_REQUIRED` | Appointment cannot be confirmed without a submitted symptom form |
| 503 | `SERVICE_UNAVAILABLE` | Database/upstream provider unreachable, or a required secret unset |

Authenticated routes expect `Authorization: Bearer <jwt>`.

---

## Health

### `GET /api/health`
Liveness. Answers even when the database is unreachable.

```json
{ "status": "ok", "service": "healthcare-appointment-manager",
  "env": "development", "uptimeSeconds": 12, "time": "2026-08-19T16:33:52.000Z" }
```

### `GET /api/health/db`
Readiness. Round-trips to Postgres. Returns `503` with code `DB_UNREACHABLE` on failure.

```json
{ "status": "ok", "dbTime": "2026-08-19T16:33:52.000Z", "latencyMs": 3.2,
  "pool": { "total": 1, "idle": 1, "waiting": 0 } }
```

---

## Auth

### `POST /api/auth/register`
Public. Creates a **patient** account - role is always forced server-side and is
never read from the request body.

Request:
```json
{ "email": "pat@example.com", "password": "correct-horse-1", "fullName": "Pat Doe", "phone": "555-0100" }
```
`phone` is optional. `password` must be at least 8 characters, `fullName` at least 2.

Response `201`:
```json
{ "token": "<jwt>",
  "user": { "id": "...", "role": "patient", "email": "pat@example.com", "fullName": "Pat Doe", "phone": "555-0100" } }
```

Errors: `400 BAD_REQUEST` (missing/invalid fields, `details.fields` names them),
`409 EMAIL_TAKEN` (email already registered, case-insensitive).

### `POST /api/auth/login`
Public.

Request:
```json
{ "email": "pat@example.com", "password": "correct-horse-1" }
```

Response `200`: same shape as register's response.

Errors: `400 BAD_REQUEST` (missing fields), `401 UNAUTHORIZED` - **identical** for an
unknown email, a wrong password, and a deactivated (`is_active = false`) account
(`"Invalid email or password."`), by design, so a client cannot enumerate registered
emails or detect disabled accounts.

### `GET /api/auth/me`
Requires `Authorization: Bearer <jwt>`.

Response `200`:
```json
{ "user": { "id": "...", "role": "patient", "email": "pat@example.com", "fullName": "Pat Doe",
             "phone": null, "isActive": true, "createdAt": "2026-08-19T16:33:52.000Z" } }
```
`password_hash` is never included in this or any other response.

Errors: `401 UNAUTHORIZED` (missing/malformed/expired/invalid-signature token - all
return this same code with a distinct `message`), `404 NOT_FOUND` (token valid but the
user row no longer exists).

---

## Admin - Doctors

All routes below require `Authorization: Bearer <jwt>` for an `admin` user. Every one
returns `401 UNAUTHORIZED` with no token / an invalid or expired token, and
`403 FORBIDDEN` for a valid token with a non-admin role - not repeated per route below.

### `POST /api/admin/doctors`
Creates a doctor account in one transaction (`users` + `doctors`). Password is hashed with
the same `password.js` helper as patient registration.

Request:
```json
{ "email": "dr@example.com", "password": "doctor-pass-1", "fullName": "Dr. Asha Rao",
  "phone": "555-0200", "specialisation": "Cardiology", "qualification": "MD",
  "consultationFee": 50, "slotMinutes": 30, "timezone": "Asia/Kolkata", "bio": "..." }
```
`email`, `password` (min 8 chars), `fullName` (min 2 chars), `specialisation` (min 2 chars)
are required. `phone`, `qualification`, `bio` are optional. `consultationFee` defaults to
`0`, `slotMinutes` to `30` (must be an integer 5-240), `timezone` to `Asia/Kolkata`.

Response `201`: `{ "doctor": { "id", "email", "fullName", "phone", "isActive",
"specialisation", "qualification", "consultationFee", "slotMinutes", "timezone", "bio" } }`

Errors: `400 BAD_REQUEST` (missing/invalid fields), `409 EMAIL_TAKEN` (case-insensitive,
same handling as patient registration).

### `GET /api/admin/doctors?specialisation=&q=&includeInactive=false`
`specialisation` matches exactly (case-insensitive). `q` free-text searches name and
specialisation. `includeInactive=true` also returns deactivated doctors (default: active
only).

Response `200`: `{ "doctors": [ { ...same shape as create response... } ] }`

### `GET /api/admin/doctors/:id`
Response `200`: `{ "doctor": { ...profile fields, "createdAt",
"availability": [ { "weekday", "startTime", "endTime" } ],
"upcomingLeave": [ { "date", "reason" } ] } }`

Errors: `404 NOT_FOUND`.

### `PATCH /api/admin/doctors/:id`
Partial update. Editable: `fullName`, `phone`, `specialisation`, `qualification`,
`consultationFee`, `slotMinutes`, `timezone`, `bio`. **`email` and `role` are never
editable through this route** - any such fields in the body are silently ignored.

Response `200`: `{ "doctor": { ...full detail, same shape as GET :id... } }`

Errors: `400 BAD_REQUEST` (no editable fields provided), `404 NOT_FOUND`.

### `DELETE /api/admin/doctors/:id`
Soft deactivate (`users.is_active = false`). **Never a hard delete** - appointments
reference this row.

Response `200`: `{ "futureActiveAppointments": 3 }` - the count of `held`/`confirmed`
appointments still in the future, so the admin can see the impact before/after.

Errors: `404 NOT_FOUND`.

### `PUT /api/admin/doctors/:id/availability`
Replaces the doctor's entire weekly schedule in one transaction (delete all, insert the new
set) - never a partial apply.

Request body is a raw array: `[ { "weekday": 1, "startTime": "09:00", "endTime": "12:00" } ]`
(`weekday` 0=Sunday..6=Saturday, times `HH:MM`).

Response `200`: `{ "availability": [ ...the new set, as stored... ] }`

Errors: `400 BAD_REQUEST` with `details.blocks` - an array of `{ index, reason }` naming
every offending block by its position in the request array. Triggered by: malformed
weekday/time, `endTime <= startTime`, a duration that isn't a whole multiple of the
doctor's `slotMinutes`, or two blocks overlapping on the same weekday. **The whole payload
is rejected together** - a rejected request never changes any stored availability.
`404 NOT_FOUND`.

### `POST /api/admin/doctors/:id/leave`
Records a full-day leave and, in the same transaction, cancels every `held`/`confirmed`
appointment that falls on that date **in the doctor's own timezone** (not UTC - see
`docs/system-design.md` §2) and queues their notifications as `outbox` rows.

Request: `{ "date": "2026-08-27", "reason": "Conference" }` (`reason` optional).

Response `201`: `{ "leaveDate": "2026-08-27", "affectedAppointments": 2,
"notificationsQueued": 3 }`

Errors: `400 BAD_REQUEST` (missing/malformed `date`), `409 CONFLICT` (leave already recorded
for this doctor and date - **no side effects at all**, the whole transaction rolls back
before any appointment is touched), `404 NOT_FOUND` (no such doctor).

### `DELETE /api/admin/doctors/:id/leave/:date`
Removes the leave record for that date. **Does NOT resurrect any appointment it cancelled** -
patients have already been notified their slot is gone (or the notification is already
queued), so silently reviving the appointment would contradict a message already sent.
Re-booking is the correct path back to a confirmed slot, not un-cancelling.

Response `200`: `{ "removed": true }`

Errors: `404 NOT_FOUND` (no leave recorded for that doctor/date).

---

## Doctors (read-only)

Requires `Authorization: Bearer <jwt>` for **any** authenticated role.

### `GET /api/doctors?specialisation=&q=`
Active doctors only - a deactivated doctor never appears here, regardless of role.
Same query semantics and response shape as the admin list above.

### `GET /api/doctors/:id`
Same shape as the admin detail route above. `404 NOT_FOUND` if the doctor doesn't exist
**or is deactivated** - deactivated doctors are invisible outside the admin portal.

### `GET /api/doctors/:id/slots?from=&to=`
`from`/`to` are `YYYY-MM-DD`, inclusive. Default to the next 7 days when omitted. Max span
is 30 days. All date/time maths happens in the doctor's own timezone (see
`docs/system-design.md` §3) - a slot's calendar-date key is never re-derived from its UTC
instant, so it can never drift across a UTC day boundary.

Response `200`:
```json
{ "slots": {
    "2026-08-21": [
      { "startsAt": "2026-08-21T00:30:00.000Z", "endsAt": "2026-08-21T01:30:00.000Z",
        "available": true, "reason": null },
      { "startsAt": "2026-08-21T15:30:00.000Z", "endsAt": "2026-08-21T16:30:00.000Z",
        "available": false, "reason": "taken" }
    ]
} }
```
Taken slots (booked `held`/`confirmed`) are returned greyed-out (`available: false,
reason: "taken"`), never omitted - showing scarcity honestly is intentional. Days that fall
on a `doctor_leave` date, or have no matching `doctor_availability` block, simply have no
key in the response.

Errors: `400 BAD_REQUEST` (`from`/`to` malformed, span > 30 days), `404 NOT_FOUND` (doctor
missing or deactivated).

---

## Appointments

Requires `Authorization: Bearer <jwt>`. The client-supplied slot is never trusted - every
write re-derives doctor existence/activity, grid alignment, leave days, and the booking
horizon from the database before touching `appointments`.

### `POST /api/appointments/hold`
`patient` only.

Request: `{ "doctorId": "...", "startsAt": "2026-08-21T15:30:00.000Z" }`

Response `201`: `{ "appointmentId", "startsAt", "endsAt", "holdExpiresAt", "holdSeconds" }`

Errors: `400 BAD_REQUEST` (doctor missing/inactive, `startsAt` invalid/in the
past/beyond the 30-day horizon/off the availability grid/on a leave day),
`409 SLOT_TAKEN` (another appointment already holds/confirms that doctor+time - resolved by
`unique_active_appointment`, never a pre-check `SELECT`), `409 PATIENT_BUSY` (the same
patient already holds/confirms a **different** doctor at that exact instant - resolved by
`unique_active_patient_slot`).

### `POST /api/appointments/:id/confirm`
`patient`, owner only.

Response `200`: `{ "appointmentId", "status": "confirmed", "startsAt", "endsAt" }`. In the
same transaction, enqueues `email/booking_confirmation` and `calendar/event_create` outbox
rows for both patient and doctor - nothing is sent inline.

Errors: `404 NOT_FOUND`, `403 FORBIDDEN` (not your appointment), `409 CONFLICT` (not
currently `held` - e.g. confirming a second time), `409 HOLD_EXPIRED` (hold window passed),
`409 SYMPTOMS_REQUIRED` (no `symptom_forms` row exists for this appointment yet - the
pre-visit **summary** is allowed to still be `pending`/`failed`; only the raw form is
required, since confirming can never depend on the LLM).

### `POST /api/appointments/:id/cancel`
`patient` or `doctor`, own appointments only.

Request: `{ "reason": "..." }` (optional).

Response `200`: `{ "appointmentId", "status": "cancelled_by_patient" | "cancelled_by_doctor" }`.
Enqueues `email/booking_cancelled` for both parties and `calendar/event_delete` for every
active `calendar_events` row. Because `unique_active_appointment` is partial, the slot is
bookable again the instant this commits - no separate cleanup step.

Errors: `404 NOT_FOUND`, `403 FORBIDDEN` (not your appointment), `409 CONFLICT` (not
`held`/`confirmed`).

### `POST /api/appointments/:id/reschedule`
`patient` only, owner only.

Request: `{ "startsAt": "2026-08-21T21:00:00.000Z" }`

Response `201`: `{ "appointmentId", "startsAt", "endsAt", "holdExpiresAt", "holdSeconds",
"rescheduledFrom" }` - a **new** `held` row; the old row is cancelled
(`cancel_reason: "Rescheduled"`) with `rescheduled_from` pointing back to it. Enqueues
`calendar/event_update` (carrying the existing `google_event_id`) for every party with an
active calendar event.

Errors: same as hold, plus `404 NOT_FOUND` / `403 FORBIDDEN` / `409 CONFLICT` for the old
appointment.

### `GET /api/appointments?status=&from=&to=`
Patients see only their own; doctors see only their own; admins see all. `status` filters
exactly; `from`/`to` filter `starts_at`. Newest first.

Response `200`: `{ "appointments": [ { "id", "status", "startsAt", "endsAt", "reason",
"cancelReason", "holdExpiresAt", "rescheduledFrom", "doctorId", "doctorName",
"doctorSpecialisation", "patientName" } ] }`

### `POST /api/appointments/:id/symptoms`
`patient` only, owner only. Inserts the symptom form **and** a `pending` `ai_summaries` row in
one transaction. The LLM is never called inline - the patient is mid-hold with a countdown
running and must not wait on an external API. `POST /api/internal/jobs/tick` picks the row up
on the next tick (see below).

Request: `{ "symptoms": "...", "duration": "3 days", "severity": 6,
"existingConditions": "...", "currentMedications": "...", "allergies": "..." }` - only
`symptoms` is required; `severity` (if present) must be an integer 1-10.

Response `201`: `{ "symptomFormId", "aiSummaryId", "status": "pending" }`

Errors: `400 BAD_REQUEST` (`symptoms` missing, `severity` out of range), `404 NOT_FOUND`,
`403 FORBIDDEN` (not your appointment), `409 CONFLICT` (appointment not `held`/`confirmed`,
or a symptom form was already submitted for this appointment - `symptom_forms.appointment_id`
is unique).

### `GET /api/appointments/:id/pre-visit-summary`
The appointment's own doctor, the owning patient, or an admin.

Response `200`: `{ "status": "pending"|"ready"|"failed", "urgency", "content", "generatedAt" }`.
When `status` is `'failed'` or `'pending'`, the response **also** includes
`"symptomForm": { "symptoms", "duration", "severity", "existingConditions",
"currentMedications", "allergies" }` - the doctor always has something clinically useful, even
when the model hasn't run yet or gave up.

Errors: `404 NOT_FOUND` (no such appointment, or no symptom form submitted yet),
`403 FORBIDDEN` (not your appointment / not the assigned doctor).

### `POST /api/appointments/:id/pre-visit-summary/retry`
`doctor` (must be the appointment's own doctor) or `admin`. Resets the row to `pending` with
`attempts` back to `0`.

Response `202`: `{ "status": "pending" }`

Errors: `404 NOT_FOUND` (no such appointment, or no symptom form submitted yet),
`403 FORBIDDEN` (doctor not assigned to this appointment).

---

## Doctor

Requires `Authorization: Bearer <jwt>` for a `doctor` user.

### `GET /api/doctor/queue?date=`
That doctor's `confirmed` appointments for `date` (`YYYY-MM-DD`, default today), matched in the
**doctor's own timezone** (`AT TIME ZONE doctors.timezone`, same convention as
`GET /api/doctors/:id/slots`). Sorted `High` → `Medium` → `Low` urgency (no/unset urgency
sorts last), then by time.

Response `200`: `{ "queue": [ { "appointmentId", "startsAt", "endsAt", "patientName",
"summaryStatus": "pending"|"ready"|"failed"|null, "urgency": "Low"|"Medium"|"High"|null } ] }`

Errors: `400 BAD_REQUEST` (`date` malformed).

---

## Internal (cron trigger)

No user JWT - authenticated by a shared secret instead, so an external cron pinger can
drive the sweep on hosting tiers that sleep idle instances between requests.

### `POST /api/internal/jobs/tick`
Header: `x-job-secret: <config.jobs.secret>` (compared with `crypto.timingSafeEqual`).
Runs the hold-expiry sweep (`status='held' AND hold_expires_at < now()` -> `'expired'`) and
`generatePendingSummaries()` (claims up to 5 `pending`/`failed` `ai_summaries` rows with
`attempts < 3` via `FOR UPDATE SKIP LOCKED`, calls the LLM, validates, and marks each `ready`
or `failed` - never more than one attempt per row per tick, see `docs/llm-prompts.md`). The
Day 6 outbox worker plugs into the same tick.

Response `200`: `{ "expiredHolds": 3, "summariesProcessed": 2, "summariesReady": 1,
"summariesFailed": 1 }`

Errors: `401 UNAUTHORIZED` (wrong secret), `503 SERVICE_UNAVAILABLE` (`JOB_TRIGGER_SECRET`
not configured on this deployment).

---

## Planned routes

Documented as each lands.

| Day | Method | Path | Role |
|---|---|---|---|
| 7 | GET | `/google/connect` | any |
| 7 | GET | `/google/callback` | any |
| 8 | POST | `/appointments/:id/notes` | doctor |
| 8 | GET | `/appointments/:id/post-visit-summary` | patient |
