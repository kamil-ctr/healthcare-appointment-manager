# API Reference

Base URL: `/api`
Every response is JSON. Errors all share one shape:

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
| 409 | `CONFLICT` | Resource isn't in a state that allows this action |
| 409 | `EMAIL_TAKEN` | Registration email is already in use (case-insensitive) |
| 409 | `SLOT_TAKEN` | Another appointment already holds/confirms that doctor+time |
| 409 | `PATIENT_BUSY` | Patient already holds/confirms a different doctor at that instant |
| 409 | `HOLD_EXPIRED` | The hold window passed before confirm |
| 409 | `SYMPTOMS_REQUIRED` | Appointment can't be confirmed without a submitted symptom form |
| 409 | `NOTES_EXIST` | Visit notes were already submitted for this appointment - use PATCH to amend |
| 503 | `SERVICE_UNAVAILABLE` | Database/upstream provider unreachable, or a required secret isn't set |

Authenticated routes expect `Authorization: Bearer <jwt>`.

---

## Health

### `GET /api/health`
A liveness check. Answers even if the database is unreachable.

```json
{ "status": "ok", "service": "healthcare-appointment-manager",
  "env": "development", "uptimeSeconds": 12, "time": "2026-08-19T16:33:52.000Z" }
```

### `GET /api/health/db`
A readiness check. Round-trips to Postgres. Returns `503` with code `DB_UNREACHABLE` on failure.

```json
{ "status": "ok", "dbTime": "2026-08-19T16:33:52.000Z", "latencyMs": 3.2,
  "pool": { "total": 1, "idle": 1, "waiting": 0 } }
```

---

## Auth

### `POST /api/auth/register`
Public. Creates a **patient** account - the role is always set on the server and never taken
from the request body.

Request:
```json
{ "email": "pat@example.com", "password": "correct-horse-1", "fullName": "Pat Doe", "phone": "555-0100" }
```
`phone` is optional. `password` needs at least 8 characters, `fullName` at least 2.

Response `201`:
```json
{ "token": "<jwt>",
  "user": { "id": "...", "role": "patient", "email": "pat@example.com", "fullName": "Pat Doe", "phone": "555-0100" } }
```

Errors: `400 BAD_REQUEST` (missing or invalid fields - `details.fields` names them),
`409 EMAIL_TAKEN` (already registered, case-insensitive).

### `POST /api/auth/login`
Public.

Request:
```json
{ "email": "pat@example.com", "password": "correct-horse-1" }
```

Response `200`: same shape as register's response.

Errors: `400 BAD_REQUEST` (missing fields), `401 UNAUTHORIZED` - this is the **same** error for
an unknown email, a wrong password, or a deactivated (`is_active = false`) account
(`"Invalid email or password."`). That's intentional, so a client can't tell which case it hit
and can't use this endpoint to check whether an email is registered.

### `GET /api/auth/me`
Needs `Authorization: Bearer <jwt>`.

Response `200`:
```json
{ "user": { "id": "...", "role": "patient", "email": "pat@example.com", "fullName": "Pat Doe",
             "phone": null, "isActive": true, "createdAt": "2026-08-19T16:33:52.000Z" } }
```
`password_hash` is never included here or in any other response.

Errors: `401 UNAUTHORIZED` (missing, malformed, expired, or wrong-signature token - all return
this code with a different message), `404 NOT_FOUND` (the token is valid but the user row is
gone).

---

## Admin - Doctors

Every route below needs `Authorization: Bearer <jwt>` for an `admin` user. Each one returns
`401 UNAUTHORIZED` with no token or a bad one, and `403 FORBIDDEN` for a valid token with a
different role - that's the same for all of them, so it isn't repeated per route below.

### `POST /api/admin/doctors`
Creates a doctor account in one transaction (`users` + `doctors`). The password is hashed with
the same helper patient registration uses.

Request:
```json
{ "email": "dr@example.com", "password": "doctor-pass-1", "fullName": "Dr. Asha Rao",
  "phone": "555-0200", "specialisation": "Cardiology", "qualification": "MD",
  "consultationFee": 50, "slotMinutes": 30, "timezone": "Asia/Kolkata", "bio": "..." }
```
`email`, `password` (min 8 chars), `fullName` (min 2), and `specialisation` (min 2) are required.
`phone`, `qualification`, and `bio` are optional. `consultationFee` defaults to `0`,
`slotMinutes` defaults to `30` (must be a whole number 5-240), `timezone` defaults to
`Asia/Kolkata`.

Response `201`: `{ "doctor": { "id", "email", "fullName", "phone", "isActive",
"specialisation", "qualification", "consultationFee", "slotMinutes", "timezone", "bio" } }`

Errors: `400 BAD_REQUEST` (missing or invalid fields), `409 EMAIL_TAKEN` (case-insensitive, same
handling as patient registration).

### `GET /api/admin/doctors?specialisation=&q=&includeInactive=false`
`specialisation` is an exact, case-insensitive match. `q` searches name and specialisation.
`includeInactive=true` also returns deactivated doctors (the default is active-only).

Response `200`: `{ "doctors": [ { ...same shape as the create response... } ] }`

### `GET /api/admin/doctors/:id`
Response `200`: `{ "doctor": { ...profile fields, "createdAt",
"availability": [ { "weekday", "startTime", "endTime" } ],
"upcomingLeave": [ { "date", "reason" } ] } }`

Errors: `404 NOT_FOUND`.

### `PATCH /api/admin/doctors/:id`
A partial update. Editable fields: `fullName`, `phone`, `specialisation`, `qualification`,
`consultationFee`, `slotMinutes`, `timezone`, `bio`. **`email` and `role` can never be changed
through this route** - if the body includes them, they're just ignored.

Response `200`: `{ "doctor": { ...full detail, same shape as GET :id... } }`

Errors: `400 BAD_REQUEST` (no editable fields given), `404 NOT_FOUND`.

### `DELETE /api/admin/doctors/:id`
Soft deactivate (`users.is_active = false`). **Never a hard delete** - appointments still
reference this row.

Response `200`: `{ "futureActiveAppointments": 3 }` - the count of `held`/`confirmed`
appointments still in the future, so the admin can see the impact before or after.

Errors: `404 NOT_FOUND`.

### `PUT /api/admin/doctors/:id/availability`
Replaces the doctor's entire weekly schedule in one transaction (delete everything, insert the
new set) - never a partial update.

Request body is a plain array: `[ { "weekday": 1, "startTime": "09:00", "endTime": "12:00" } ]`
(`weekday` is 0 = Sunday .. 6 = Saturday, times are `HH:MM`).

Response `200`: `{ "availability": [ ...the new set, as stored... ] }`

Errors: `400 BAD_REQUEST` with `details.blocks` - an array of `{ index, reason }` naming each bad
block by its position in the request array. This is triggered by a malformed weekday/time, an
`endTime <= startTime`, a duration that isn't a whole multiple of the doctor's `slotMinutes`, or
two blocks overlapping on the same weekday. **The whole request is rejected together** - a
rejected request never changes any stored availability. Also `404 NOT_FOUND`. Overlap is also
checked at the database level (`availability_no_overlap`, a GiST exclusion constraint), as a
backstop for any write path that skips this validator - see `docs/schema.sql`.

### `POST /api/admin/doctors/:id/leave`
Records a full-day leave and, in the same transaction, cancels every `held`/`confirmed`
appointment that falls on that date **in the doctor's own timezone** (not UTC - see
`docs/system-design.md` §2), cancels their still-`'scheduled'` `reminders` rows, and queues
their notifications as `outbox` rows (one `leave_cancellation` per patient, plus one
`leave_cancellation_summary` for the doctor).

Request: `{ "date": "2026-08-27", "reason": "Conference" }` (`reason` is optional).

Response `201`: `{ "leaveDate": "2026-08-27", "affectedAppointments": 2,
"notificationsQueued": 3 }`

Errors: `400 BAD_REQUEST` (missing or malformed `date`), `409 CONFLICT` (leave already recorded
for this doctor and date - **no side effects at all**, the whole transaction rolls back before
any appointment is touched), `404 NOT_FOUND` (no such doctor).

### `DELETE /api/admin/doctors/:id/leave/:date`
Removes the leave record for that date. **This does NOT bring back any appointment it
cancelled** - patients have already been told their slot is gone, or that notification is
already queued, so silently reviving the appointment would contradict a message already sent.
Re-booking is the correct way back to a confirmed slot, not un-cancelling.

Response `200`: `{ "removed": true }`

Errors: `404 NOT_FOUND` (no leave recorded for that doctor/date).

### `GET /api/admin/outbox?status=&topic=&page=`
Paginated (50 per page), newest first. `status` is an exact match (`pending`/`processing`/
`sent`/`failed`); `topic` is an exact match (`email`/`calendar`); `page` defaults to `1`.

Response `200`: `{ "rows": [ { "id", "topic", "eventType", "status", "attempts",
"maxAttempts", "nextRetryAt", "lockedAt", "lastError", "createdAt", "sentAt" } ],
"page", "pageSize", "total" }`

Errors: `400 BAD_REQUEST` (`status`/`topic` isn't a recognised value).

### `POST /api/admin/outbox/:id/retry`
Resets a dead-lettered row: `status` goes back to `'pending'`, `attempts` back to `0`,
`last_error` cleared, `next_retry_at` set to now - picked up on the next tick like any other
pending row.

Response `200`: `{ "status": "pending" }`

Errors: `404 NOT_FOUND`, `409 CONFLICT` (the row isn't currently `'failed'` - only a
dead-lettered row can be retried this way; a `pending`/`processing` row is already on its own
schedule, and a `sent` row has nothing left to retry).

---

## Doctors (read-only)

Needs `Authorization: Bearer <jwt>` for **any** logged-in role.

### `GET /api/doctors?specialisation=&q=`
Active doctors only - a deactivated doctor never shows up here, no matter who's asking. Same
query rules and response shape as the admin list above.

### `GET /api/doctors/:id`
Same shape as the admin detail route above. `404 NOT_FOUND` if the doctor doesn't exist **or is
deactivated** - deactivated doctors are only visible in the admin portal.

### `GET /api/doctors/:id/slots?from=&to=`
`from`/`to` are `YYYY-MM-DD`, inclusive. Default to the next 7 days if left out. The max span is
30 days. All date/time math happens in the doctor's own timezone (see `docs/system-design.md`
§3) - a slot's calendar date is never re-derived from its UTC instant, so it can't drift across
a UTC day boundary.

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
Taken slots (booked `held`/`confirmed`) come back greyed out (`available: false, reason:
"taken"`), never left out entirely - showing what's actually taken is intentional. Days that
fall on a `doctor_leave` date, or have no matching `doctor_availability` block, simply have no
key in the response.

Errors: `400 BAD_REQUEST` (`from`/`to` malformed, or span over 30 days), `404 NOT_FOUND` (doctor
missing or deactivated).

---

## Appointments

Needs `Authorization: Bearer <jwt>`. Nothing the client sends about a slot is trusted - every
write re-checks the doctor's existence and status, grid alignment, leave days, and the booking
horizon straight from the database before touching `appointments`.

### `POST /api/appointments/hold`
`patient` only.

Request: `{ "doctorId": "...", "startsAt": "2026-08-21T15:30:00.000Z" }`

Response `201`: `{ "appointmentId", "startsAt", "endsAt", "holdExpiresAt", "holdSeconds" }`

Errors: `400 BAD_REQUEST` (doctor missing/inactive, or `startsAt` is invalid, in the past,
beyond the 30-day horizon, off the availability grid, or on a leave day), `409 SLOT_TAKEN`
(another appointment already holds/confirms that doctor+time - caught either by
`unique_active_appointment` for the exact same instant (SQLSTATE `23505`) or by
`appointments_no_overlap` for any time overlap (SQLSTATE `23P01`, e.g. after a doctor's
`slotMinutes` changes and the new grid offers a start time that lands inside an existing
booking). Both map to the same `409 SLOT_TAKEN` - there's never a pre-check `SELECT`.
`409 PATIENT_BUSY` (the same patient already holds/confirms a **different** doctor at that exact
instant - caught by `unique_active_patient_slot`).

### `POST /api/appointments/:id/confirm`
`patient`, and only the owner.

Response `200`: `{ "appointmentId", "status": "confirmed", "startsAt", "endsAt" }`. In the same
transaction, this queues `email/booking_confirmation` and `calendar/event_create` outbox rows
for both the patient and doctor, and schedules two `reminders` rows for the patient (24h and 2h
before `startsAt`, skipping any whose `due_at` has already passed) - nothing is sent right away.

Errors: `404 NOT_FOUND`, `403 FORBIDDEN` (not your appointment), `409 CONFLICT` (not currently
`held` - e.g. confirming twice), `409 HOLD_EXPIRED` (the hold window passed), `409
SYMPTOMS_REQUIRED` (no `symptom_forms` row exists for this appointment yet - the pre-visit
**summary** is allowed to still be `pending`/`failed`; only the raw form is required, since
confirming can never depend on the model).

### `POST /api/appointments/:id/cancel`
`patient` or `doctor`, and only for your own appointments.

Request: `{ "reason": "..." }` (optional).

Response `200`: `{ "appointmentId", "status": "cancelled_by_patient" | "cancelled_by_doctor" }`.
Queues `email/booking_cancelled` for both sides and `calendar/event_delete` for every active
`calendar_events` row, and cancels (`status = 'cancelled'`) any still-`'scheduled'` `reminders`
row for this appointment - a cancelled appointment must never send a reminder. Because
`unique_active_appointment` is partial, the slot is bookable again the moment this commits - no
separate cleanup step.

Errors: `404 NOT_FOUND`, `403 FORBIDDEN` (not your appointment), `409 CONFLICT` (not
`held`/`confirmed`).

### `POST /api/appointments/:id/reschedule`
`patient` only, and only the owner.

Request: `{ "startsAt": "2026-08-21T21:00:00.000Z" }`

Response `201`: `{ "appointmentId", "startsAt", "endsAt", "holdExpiresAt", "holdSeconds",
"rescheduledFrom" }` - this is a **new** `held` row. The old row is cancelled
(`cancel_reason: "Rescheduled"`) with `rescheduled_from` pointing back at it, and its
still-`'scheduled'` `reminders` rows are cancelled the same way `/cancel` does. Queues
`calendar/event_update` (carrying the existing `google_event_id`) for every party with an active
calendar event.

Errors: same as hold, plus `404 NOT_FOUND` / `403 FORBIDDEN` / `409 CONFLICT` for the old
appointment.

### `GET /api/appointments?status=&from=&to=`
Patients see only their own; doctors see only their own; admins see all. `status` is an exact
match; `from`/`to` filter on `starts_at`. Newest first.

Response `200`: `{ "appointments": [ { "id", "status", "startsAt", "endsAt", "reason",
"cancelReason", "holdExpiresAt", "rescheduledFrom", "doctorId", "doctorName",
"doctorSpecialisation", "patientName" } ] }`

### `POST /api/appointments/:id/symptoms`
`patient` only, and only the owner. Inserts the symptom form **and** a `pending` `ai_summaries`
row in one transaction. The model is never called inline - the patient is mid-hold with a
countdown running and can't be made to wait on an outside API.
`POST /api/internal/jobs/tick` picks the row up on the next tick (see below).

Request: `{ "symptoms": "...", "duration": "3 days", "severity": 6,
"existingConditions": "...", "currentMedications": "...", "allergies": "..." }` - only
`symptoms` is required (max 2000 characters, same limit for `existingConditions`,
`currentMedications`, and `allergies`); `severity`, if given, must be a whole number 1-10.

Response `201`: `{ "symptomFormId", "aiSummaryId", "status": "pending" }`

Errors: `400 BAD_REQUEST` (`symptoms` missing, `severity` out of range, or a text field over its
length limit), `404 NOT_FOUND`, `403 FORBIDDEN` (not your appointment), `409 CONFLICT`
(appointment not `held`/`confirmed`, or a symptom form was already submitted for this
appointment - `symptom_forms.appointment_id` is unique).

### `GET /api/appointments/:id/pre-visit-summary`
The appointment's own doctor, the owning patient, or an admin.

Response `200`: `{ "status": "pending"|"ready"|"failed", "urgency", "content", "generatedAt" }`.
When `status` is `'failed'` or `'pending'`, the response **also** includes
`"symptomForm": { "symptoms", "duration", "severity", "existingConditions",
"currentMedications", "allergies" }` - so the doctor always has something clinically useful, even
when the model hasn't run yet or gave up.

Errors: `404 NOT_FOUND` (no such appointment, or no symptom form submitted yet),
`403 FORBIDDEN` (not your appointment / not the assigned doctor).

### `POST /api/appointments/:id/pre-visit-summary/retry`
`doctor` (must be the appointment's own doctor) or `admin`. Resets the row to `pending` and
`attempts` back to `0`.

Response `202`: `{ "status": "pending" }`

Errors: `404 NOT_FOUND` (no such appointment, or no symptom form submitted yet),
`403 FORBIDDEN` (doctor isn't assigned to this appointment).

### `POST /api/appointments/:id/notes`
`doctor` only, and only the appointment's own doctor. One transaction: the appointment must be
`confirmed` **and** `startsAt` in the past (you can't write notes for a visit that hasn't
happened yet), inserts `visit_notes` plus one row per prescription, moves the appointment to
`completed`, inserts a `pending` `ai_summaries` row (`kind: 'post_visit'`) - again never called
inline, since the doctor is between patients - and schedules medication/follow-up reminders (see
`services/reminders.js`, "Medication reminders" below). Logs `notes_submitted` and `completed`
appointment events.

Request: `{ "clinicalNotes": "...", "diagnosis": "...", "followUpDate": "2026-09-01",
"prescriptions": [ { "medicationName": "Amoxicillin", "dosage": "500mg",
"frequencyPerDay": 3, "durationDays": 5, "instructions": "Take after meals" } ] }` -
`followUpDate` and each prescription's `instructions` are optional; at least one of
`clinicalNotes`/`diagnosis` is required; `frequencyPerDay` 1-6; `durationDays` 1-180;
`medicationName`/`dosage` can't be empty. The whole request is rejected together with
`details.fields` naming every bad field (e.g. `"prescriptions[0].frequencyPerDay"`) - never
partially applied.

Response `201`: `{ "appointmentId", "status": "completed", "visitNotes", "prescriptions",
"postVisitSummaryStatus": "pending",
"reminders": { "medication": { "totalScheduled", "cap": 400, "clampedPrescriptions": [] },
"followUp": { "scheduled": boolean, "dueAt"? } } }`

Errors: `400 BAD_REQUEST` (`details.fields`), `404 NOT_FOUND`, `403 FORBIDDEN` (not your
appointment), `409 CONFLICT` (appointment not `confirmed`, or `startsAt` still in the future),
`409 NOTES_EXIST` (notes already submitted - use PATCH).

### `PATCH /api/appointments/:id/notes`
`doctor` only, and only the appointment's own doctor, and notes must already exist (`404`
otherwise - POST is what creates them). Same validation and transaction shape as POST, plus:
cancels every still-`'scheduled'` medication/follow-up reminder for this appointment
(`medication_reminders_cancelled` event, only if any existed), replaces the prescription rows,
resets the `post_visit` `ai_summaries` row to `pending` (clearing any earlier content/error), and
reschedules reminders against the amended prescriptions/follow-up date. Logs `notes_amended`.

Response `200`: same shape as POST's `201`, minus `status`.

Errors: same as POST, except `404 NOT_FOUND` also covers "no notes exist yet for this
appointment."

### `GET /api/appointments/:id/post-visit-summary`
The appointment's own patient, the owning doctor, or an admin.

Response `200`: `{ "status": "pending"|"ready"|"failed", "content", "generatedAt",
"prescriptions": [ { "id", "medicationName", "dosage", "frequencyPerDay", "durationDays",
"instructions" } ] }`. `prescriptions` is **always** present - it's the source of truth patients
see alongside the AI-written version, not just a fallback for when there's nothing else.
`visitNotes: { "clinicalNotes", "diagnosis", "followUpDate" }` is included whenever `status`
isn't `'ready'`, **or** the caller is the doctor/admin (no matter the status) - so the same
endpoint can pre-fill the doctor's amend form at any time, while a patient only sees the raw
notes as a fallback when there's nothing AI-generated to show yet. `content` (when `status:
'ready'`) matches the schema in `docs/llm-prompts.md`: `{ "summary", "medicationSchedule": [ {
"medication", "dose", "when", "duration" } ], "followUpSteps", "whenToSeekHelp" }` - every
`medicationSchedule` entry is checked (see `docs/llm-prompts.md`) to make sure it matches a real
prescription.

Errors: `404 NOT_FOUND` (no such appointment, or no visit notes submitted yet),
`403 FORBIDDEN` (not your appointment).

### `POST /api/appointments/:id/post-visit-summary/retry`
`doctor` (must be the appointment's own doctor) or `admin`. Resets the row to `pending` and
`attempts` back to `0`.

Response `202`: `{ "status": "pending" }`

Errors: `404 NOT_FOUND` (no such appointment, or no visit notes submitted yet),
`403 FORBIDDEN` (doctor isn't assigned to this appointment).

### `GET /api/appointments/:id/events`
The appointment's own patient or doctor, or an admin - same access rule as
`GET /api/appointments/:id/pre-visit-summary`.

Response `200`: `{ "events": [ { "event", "actor", "detail", "createdAt" } ] }`, oldest first.
`event` is one of `held`, `symptoms_submitted`, `confirmed`, `cancelled_by_patient`,
`cancelled_by_doctor`, `cancelled_by_leave`, `expired`, `rescheduled`, `summary_ready`,
`summary_failed`, `email_sent`, `calendar_event_created`, `calendar_event_updated`,
`calendar_event_deleted`, `notes_submitted`, `notes_amended`, `completed`, `post_visit_summary_ready`,
`post_visit_summary_failed`, `medication_reminders_scheduled`,
`medication_reminders_cancelled`. `actor` is `"patient:<id>"` / `"doctor:<id>"` /
`"admin:<id>"` / `"system"`. Every row is written in the same transaction as the change it
records - added by `services/events.js`'s `logEvent()`, never as an afterthought - so this is a
real audit trail, not a log that might silently miss something.

Errors: `404 NOT_FOUND`, `403 FORBIDDEN` (not a participant and not an admin).

---

## Doctor

Needs `Authorization: Bearer <jwt>` for a `doctor` user.

### `GET /api/doctor/queue?date=`
That doctor's `confirmed` appointments for `date` (`YYYY-MM-DD`, defaults to today), matched in
the **doctor's own timezone** (`AT TIME ZONE doctors.timezone`, same as
`GET /api/doctors/:id/slots`). Sorted `High` → `Medium` → `Low` urgency (no urgency sorts last),
then by time.

Response `200`: `{ "queue": [ { "appointmentId", "startsAt", "endsAt", "patientName",
"summaryStatus": "pending"|"ready"|"failed"|null, "urgency": "Low"|"Medium"|"High"|null } ] }`

Errors: `400 BAD_REQUEST` (`date` malformed).

---

## Google Calendar

Full OAuth setup (Console steps, why publishing status must be "In production", scope, redirect
URIs, token encryption) is in
[`docs/google-calendar-setup.md`](google-calendar-setup.md). Every route needs
`Authorization: Bearer <jwt>` **except** `/callback`, which Google's own redirect hits directly
with no bearer token at all - it's authenticated instead by a signed `state` parameter (an HMAC
over the user id and issue time, checked server-side, rejected if older than 10 minutes).

### `GET /api/google/connect`
Any logged-in role. Returns the Google consent URL as JSON instead of redirecting directly - the
frontend calls this as a normal authenticated `fetch` (it needs the bearer token, which a plain
browser navigation can't send) and then does the actual full-page navigation to Google itself.

Response `200`: `{ "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }`

Errors: `503 SERVICE_UNAVAILABLE` (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` aren't configured
on this deployment).

### `GET /api/google/callback`
No bearer token - Google redirects the browser here directly with `?code=&state=`. Exchanges
the code for tokens, encrypts and saves the `google_accounts` row for the user identified by
`state`, and redirects the browser back to the frontend (`/appointments?google=connected` or
`?google=error`). If Google doesn't return a `refresh_token` (a re-consent, not a first
authorization), the previously stored one is kept instead of being overwritten with nothing.
This never shows a raw error to the browser - any failure (invalid/expired state, a token
exchange error, Google not configured) redirects to the `?google=error` variant instead.

### `DELETE /api/google/disconnect`
Any logged-in role, and only your own connection. Calls Google's revoke endpoint on a
best-effort basis (a failed revoke call still disconnects locally, so a flaky call here can
never leave a user stuck in a "connected" state they can't get out of) and sets `revoked_at`.
Existing `calendar_events` rows are kept as-is for the record; a later booking's
`calendar/event_create` row for this user dead-letters as `google_not_connected` instead of
retrying.

Response `200`: `{ "disconnected": true }`

### `GET /api/google/status`
Any logged-in role, and only your own connection.

Response `200`: `{ "connected": boolean, "googleEmail": string|null, "connectedAt": string|null }`

---

## Internal (cron trigger)

No user JWT here - a shared secret authenticates the request instead, so an external cron pinger
can drive the sweep on hosting tiers that put idle instances to sleep.

### `POST /api/internal/jobs/tick`
Header: `x-job-secret: <config.jobs.secret>` (checked with `crypto.timingSafeEqual`). Runs, in
order:
1. the hold-expiry sweep (`status='held' AND hold_expires_at < now()` -> `'expired'`)
2. `generatePendingSummaries()` (see `docs/llm-prompts.md`)
3. `queueDueReminders()` - scans `reminders WHERE status='scheduled' AND due_at <= now()` across
   all three kinds (`appointment_reminder`, `medication_reminder`, `follow_up`), queues one
   `email` `outbox` row per due reminder (`event_type` matches the kind, except `follow_up`
   becomes `follow_up_reminder`), and marks it `'queued'`
4. `processOutboxBatch()` - the delivery worker (see `docs/system-design.md` §4): claims up to
   10 `email`- and `calendar`-topic rows together with `FOR UPDATE SKIP LOCKED`, acts on each
   exactly once this tick, and moves it to `sent`/back to `pending` with backoff, or `failed` at
   `max_attempts`. `calendar` rows go through the Google Calendar REST client
   (`server/src/google/calendar.js`); a user with no `google_accounts` row or a revoked
   connection dead-letters immediately as `google_not_connected` instead of retrying.

Reminders are queued before the outbox runs, so a reminder that just came due can go out in the
same tick it was queued in.

Response `200`: `{ "expiredHolds": 3, "summariesProcessed": 2, "summariesReady": 1,
"summariesFailed": 1, "remindersQueued": 1, "outboxClaimed": 4, "outboxSent": 3,
"outboxRetried": 1, "outboxFailed": 0 }`

Errors: `401 UNAUTHORIZED` (wrong secret), `503 SERVICE_UNAVAILABLE` (`JOB_TRIGGER_SECRET` isn't
configured on this deployment).

---

## Planned routes

None currently - visit notes, prescriptions, the post-visit summary, and medication reminders
close the last functional requirement in the brief. What's left is deployment and
documentation, not new endpoints.
