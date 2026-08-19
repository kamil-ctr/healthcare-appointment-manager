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
| 409 | `CONFLICT` | Slot taken, duplicate email, stale hold |
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

## Planned routes

Documented as each lands.

| Day | Method | Path | Role |
|---|---|---|---|
| 2 | POST | `/auth/register` | public |
| 2 | POST | `/auth/login` | public |
| 2 | GET | `/auth/me` | any |
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
