# CLAUDE.md — project context for Claude Code

Place this file at the **repository root**. Claude Code reads it automatically at the start of
every session. Keep the "Current state" section updated as days are completed.

---

## What this project is

**Healthcare Appointment & Follow-up Manager** — a graded assignment. A clinic platform with
separate **patient / doctor / admin** portals. Patients book slots and submit symptoms in advance;
an LLM produces a pre-visit summary with urgency level for the doctor, and a patient-friendly
summary after the visit. Both sides are notified by email and Google Calendar.

This is graded on: slot-conflict handling, doctor-leave handling, notification reliability, LLM
prompt quality and failure handling, database schema, API design and code structure, email +
Calendar integration, and documentation. **Correctness under concurrency matters more than UI
polish.** Do not spend effort on visual design until day 9.

---

## Hard constraints — do not violate

1. **Dependency budget.** The backend has exactly three runtime dependencies:
   `express`, `pg`, `nodemailer`. The frontend has `react`, `react-dom` (+ `vite`,
   `@vitejs/plugin-react` as devDeps).
   **Do not `npm install` anything else.** If a task seems to need a package, implement it with
   Node built-ins instead and say so. Specifically:
   - password hashing → `node:crypto` `scrypt`, **not** `bcrypt`
   - JWT → `node:crypto` HMAC-SHA256, **not** `jsonwebtoken`
   - env vars → `node --env-file=.env`, **not** `dotenv`
   - CORS → the hand-rolled middleware in `server/src/middleware/core.js`, **not** `cors`
   - HTTP calls (Google, LLM) → global `fetch`, **not** `axios` or `googleapis`
   - scheduling → interval loop + secured trigger endpoint, **not** `node-cron` / BullMQ / Redis
   - validation → small hand-written validators in `server/src/lib/validate.js`, **not** `zod`
   - data access → **raw SQL**, never an ORM. The schema is a graded artifact.

2. **Repository hygiene** (submission guidelines):
   - never commit `.env`, `node_modules/`, `dist/`, `build/`, `.vscode/`, `.idea/`
   - `.env.example` **is** committed and must stay in sync with `server/src/config.js`
   - branch is `main`, repository is public
   - no scratch files, no `test.js` in the repo root, no commented-out dead code

3. **Style.** ES modules (`"type": "module"`), 2-space indent, single quotes, semicolons.
   `camelCase` in JS, `snake_case` in SQL. Comments explain *why*, not *what*.

4. **Commit attribution.** Never add a `Co-Authored-By` trailer, a
   "Generated with Claude Code" line, or any tool-attribution footer to
   commit messages. Commit messages contain only the subject line and,
   where useful, a short body describing the change. Keep `.claude/` in
   `.gitignore`.

---

## Architecture and conventions already established

### Error handling
All errors use `AppError` from `server/src/lib/errors.js` and the helpers
`badRequest / unauthorized / forbidden / notFound / conflict / unavailable`.
Every async route handler is wrapped in `asyncHandler(...)`.
The wire shape is fixed:

```json
{ "error": { "code": "SLOT_TAKEN", "message": "...", "details": {} }, "requestId": "..." }
```

Never send a raw error message from an exception to the client — the terminal handler in
`middleware/core.js` reduces unknown errors to a generic 500 and logs the full detail.

### Database access
- `query`, `one`, `many` for single statements — from `server/src/db/pool.js`
- `withTransaction(async (client) => { ... })` for anything that writes more than one table
- **always parameterised queries** (`$1`, `$2`), never string interpolation
- schema changes go into `docs/schema.sql`, which must stay idempotent
  (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` first).
  Re-apply with `npm run migrate`.

### The three design decisions that carry the grade
1. **Concurrency is a database invariant.** `unique_active_appointment` is a partial unique index
   on `appointments (doctor_id, starts_at) WHERE status IN ('held','confirmed')`. Booking is one
   `INSERT` in a transaction; the loser gets SQLSTATE `23505` → HTTP 409. **Never** replace this
   with a read-then-write check in JavaScript.
2. **Every outbound side effect goes through the `outbox` table**, inserted in the *same
   transaction* as the business change. Nothing sends email or calls Google inside a request
   handler. A worker claims rows with `FOR UPDATE SKIP LOCKED` and retries with exponential
   backoff up to `max_attempts`.
3. **`reminders` is the schedule, `outbox` is the transport.** The background job reads due
   reminders and enqueues outbox rows.

### LLM rules
- Called only from `server/src/llm/`, always with an `AbortController` timeout
  (`config.llm.timeoutMs`) and at most one retry.
- Output is parsed and validated, then stored in `ai_summaries`.
- On any failure — timeout, non-200, malformed JSON — write `status = 'failed'` with `last_error`
  and **return normally**. Booking and note submission must never fail because the LLM did. The UI
  falls back to the raw symptom form / clinical notes plus a retry button.
- Use the exact prompts from the brief; keep them in one module and version them via
  `prompt_version`.

---

## Current state (end of day 2 — verified, not assumed)

Done and tested against a real PostgreSQL 16 instance (installed locally on the developer's Mac):

- `docs/schema.sql` — 13 tables, applies cleanly and is idempotent on re-run:
  `users` · `doctors` · `doctor_availability` · `doctor_leave` · `appointments` ·
  `symptom_forms` · `visit_notes` · `prescriptions` · `ai_summaries` · `reminders` ·
  `outbox` · `google_accounts` · `calendar_events`
- `server/src/config.js` — fail-fast env validation, all future keys declared, plus `admin`
  section for the seed script
- `server/src/db/pool.js` — pool + `query` / `one` / `many` / `withTransaction`
- `server/src/db/migrate.js` — `npm run migrate`
- `server/src/middleware/core.js` — CORS, request id, access log, 404, terminal error handler
- `server/src/middleware/auth.js` — `requireAuth`, `requireRole(...)`
- `server/src/lib/password.js` — async scrypt hash/verify (`scrypt$N$r$p$salt$hash`)
- `server/src/lib/jwt.js` — hand-rolled HS256 sign/verify, distinct malformed/signature/expired
  errors
- `server/src/lib/validate.js` — `required` / `isEmail` / `minLength` / `oneOf`
- `server/src/routes/health.js` — `GET /api/health` (liveness), `GET /api/health/db` (readiness,
  503 when Postgres is down)
- `server/src/routes/auth.js` — register/login/me, role always forced to `patient` on
  self-registration, identical generic 401 for unknown email / wrong password / deactivated
  account
- `server/scripts/seed-admin.js` — idempotent admin seed from `ADMIN_EMAIL`/`ADMIN_PASSWORD`
- `server/scripts/concurrency-check.js` — **passing**: 20 simultaneous holds on one slot →
  1 success, 19 × `23505`, 1 row in the DB
- `server/src/index.js` — graceful shutdown on SIGTERM/SIGINT
- `web/` — Vite + React shell that pings both health endpoints
- `README.md`, `docs/api.md`, `docs/system-design.md` (draft, §1 written)

**Not started:** admin portal (doctor CRUD, availability, leave), slots, LLM, email, calendar,
jobs, deployment.

---

## Remaining plan

| Day | Scope |
|---|---|
| 3 | Admin portal: doctor CRUD, weekly availability, leave days |
| 4 | Slot generation, hold → confirm flow, expiry sweep, concurrency test in CI-able form |
| 5 | Symptom form, pre-visit LLM summary + urgency, doctor queue |
| 6 | Outbox worker, Nodemailer, booking / cancellation / reminder emails |
| 7 | Google Calendar OAuth 2.0, create / update / delete events for both sides |
| 8 | Post-visit notes, prescriptions, medication reminder expansion |
| 9 | Deploy backend + frontend, end-to-end integration testing |
| 10 | Finish `docs/api.md`, 800-word `docs/system-design.md`, final repo audit, zip |

---

## Definition of done for every day

Before saying a day is complete:

1. `cd server && npm run dev` starts with no errors and no warnings.
2. Every new endpoint is exercised with a real `curl` call and the actual output is shown —
   not described. Include at least one **failure** case (wrong role, duplicate, conflict).
3. Any schema change is added to `docs/schema.sql`, applied via `npm run migrate`, and the
   migration is re-run once to prove idempotency.
4. `docs/api.md` is updated with the new endpoints and their error codes.
5. `git status` shows no `.env`, `node_modules/`, or scratch files.
6. The roadmap table in `README.md` is ticked for that day.
7. `git add -A && git commit` with a clear message, then push to `main`.

## Working agreement

- Work **one day at a time**. Do not jump ahead to later days' scope.
- Before writing code for a day, state the plan in 3–6 bullets and list the files you will
  touch. Then implement.
- If a requirement in the brief seems to conflict with a constraint here, **stop and ask** rather
  than silently choosing.
- Prefer editing existing files over creating new ones. Keep the tree flat and obvious.
