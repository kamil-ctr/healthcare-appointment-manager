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

### `GET /api/admin/ping` — **temporary, Day 2 only**
Requires `Authorization: Bearer <jwt>` for an `admin` user. Exists solely to prove
`requireAuth` + `requireRole('admin')` work end-to-end before the real admin portal
(Day 3) exists. **Remove once Day 3 adds real routes under `/api/admin`.**

Response `200`: `{ "ok": true, "role": "admin" }`

Errors: `401 UNAUTHORIZED` (no/invalid token), `403 FORBIDDEN` (valid token, non-admin role).

---

## Planned routes

Documented as each lands.

| Day | Method | Path | Role |
|---|---|---|---|
| 3 | POST | `/admin/doctors` | admin |
| 3 | PATCH | `/admin/doctors/:id` | admin |
| 3 | PUT | `/admin/doctors/:id/availability` | admin |
| 3 | POST | `/admin/doctors/:id/leave` | admin |
| 4 | GET | `/doctors?specialisation=` | patient |
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
