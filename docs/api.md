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
| 409 | `CONFLICT` | Slot taken, stale hold |
| 409 | `EMAIL_TAKEN` | Registration email already in use (case-insensitive) |
| 503 | `SERVICE_UNAVAILABLE` | Database or upstream provider unreachable |

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

---

## Planned routes

Documented as each lands.

| Day | Method | Path | Role |
|---|---|---|---|
| 4 | GET | `/doctors/:id/slots?date=` | patient |
| 4 | POST | `/appointments/hold` | patient |
| 4 | POST | `/appointments/:id/confirm` | patient |
| 4 | POST | `/appointments/:id/cancel` | patient/doctor |
| 5 | POST | `/appointments/:id/symptoms` | patient |
| 5 | GET | `/appointments/:id/pre-visit-summary` | doctor |
| 7 | GET | `/google/connect` | any |
| 7 | GET | `/google/callback` | any |
| 8 | POST | `/appointments/:id/notes` | doctor |
| 8 | GET | `/appointments/:id/post-visit-summary` | patient |
