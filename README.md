# Healthcare Appointment & Follow-up Manager

A clinic appointment platform with separate **patient**, **doctor**, and **admin** portals.
Patients book slots and submit symptoms in advance; an LLM produces a pre-visit summary with an
urgency level for the doctor and a patient-friendly summary after the visit. Both sides are kept
informed through email and Google Calendar.

> **Status:** Day 7 of 10 — Google Calendar OAuth 2.0 (native fetch, no `googleapis`
> package), AES-256-GCM token encryption at rest, transparent access-token refresh,
> and the calendar-topic outbox handler (create/update/delete events, idempotent
> 404/410 handling, revoked-grant detection) - entirely optional, nothing in the
> booking request path ever calls Google. See [Roadmap](#roadmap) for what lands next.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 20+ / Express, ES modules |
| Database | PostgreSQL (raw SQL, no ORM) |
| Frontend | React 18 + Vite + react-router-dom, Tailwind CSS v4 (`@theme` design tokens) |
| Auth | JWT signed with `node:crypto` HMAC; passwords hashed with scrypt |
| Email | Nodemailer over SMTP |
| Calendar | Google Calendar REST API + OAuth 2.0 via native `fetch` |
| LLM | Groq (OpenAI-compatible chat completions API) via native `fetch` |

### Dependency policy

The submission guidelines ask for minimal, native dependencies. The backend therefore has
**three runtime dependencies**, and everything else uses Node built-ins:

| Need | Using | Instead of |
|---|---|---|
| HTTP server | `express` | — |
| Postgres driver | `pg` | — |
| SMTP | `nodemailer` | SendGrid/Mailgun SDKs |
| Password hashing | `node:crypto` scrypt | `bcrypt` |
| JWT sign/verify | `node:crypto` HMAC-SHA256 | `jsonwebtoken` |
| Env loading | `node --env-file` | `dotenv` |
| CORS | 15 lines in `middleware/core.js` | `cors` |
| HTTP client | global `fetch` | `axios`, `googleapis` |
| Scheduling | interval loop + secured trigger endpoint | `node-cron`, BullMQ, Redis |
| Data access | raw SQL | Prisma / Sequelize |

Raw SQL is deliberate: the database schema is a graded artifact, so it is written and reviewed
directly rather than generated from an ORM model.

---

## Repository structure

```
healthcare-appointment-manager/
├── README.md
├── .gitignore
├── .env.example              # template; the real .env is never committed
├── docs/
│   ├── schema.sql            # full PostgreSQL schema (idempotent)
│   ├── api.md                # endpoint reference
│   ├── llm-prompts.md        # exact prompts, schema, retry/give-up policy, injection guard
│   └── system-design.md      # 800-word write-up (deliverable 4)
├── server/
│   ├── package.json
│   ├── scripts/
│   │   ├── concurrency-check.js   # proves the no-double-booking guarantee
│   │   └── seed-admin.js          # idempotent admin seed
│   └── src/
│       ├── index.js          # entrypoint + graceful shutdown
│       ├── app.js            # express wiring
│       ├── config.js         # env loading, fail-fast validation
│       ├── db/
│       │   ├── pool.js       # pool, query helpers, withTransaction()
│       │   └── migrate.js    # applies docs/schema.sql
│       ├── lib/
│       │   ├── errors.js     # AppError + typed helpers
│       │   ├── password.js   # scrypt hash/verify
│       │   ├── jwt.js        # hand-rolled HS256 sign/verify
│       │   └── validate.js   # required/isEmail/minLength/oneOf/isDateString
│       ├── llm/
│       │   ├── client.js     # native-fetch Groq client, typed LlmError, timeout+retry
│       │   ├── prompts.js    # versioned prompts, injection-guard sanitisation
│       │   ├── parse.js      # strict output validation
│       │   └── pre-visit.js  # orchestrates call -> validate -> one repair -> give up
│       ├── google/
│       │   ├── crypto.js     # AES-256-GCM token encryption at rest (key from JWT_SECRET)
│       │   ├── oauth.js      # connect/callback/disconnect/status, signed state param
│       │   ├── tokens.js     # getAccessToken(): transparent refresh, revoked-grant handling
│       │   └── calendar.js   # native-fetch Calendar REST client: create/patch/delete
│       ├── mail/
│       │   ├── transport.js  # one shared nodemailer transport, console fallback
│       │   └── templates.js  # plain-literal email templates, doctor-timezone rendering
│       ├── middleware/
│       │   ├── core.js
│       │   └── auth.js       # requireAuth, requireRole(...)
│       ├── services/
│       │   ├── doctors.js    # doctor CRUD, availability
│       │   ├── leave.js      # leave + appointment-cancellation cascade
│       │   ├── appointments.js  # hold/confirm/cancel/reschedule + reminder scheduling
│       │   ├── slots.js
│       │   ├── symptoms.js   # symptom form submission, pre-visit summary get/retry
│       │   ├── queue.js      # doctor's urgency-sorted daily queue
│       │   └── notifications.js  # admin outbox listing + dead-letter retry
│       ├── jobs/
│       │   ├── runner.js
│       │   ├── expire-holds.js
│       │   ├── ai-summaries.js  # generatePendingSummaries(), one attempt per row per tick
│       │   ├── reminders.js     # queueDueReminders(): reminders -> outbox
│       │   └── outbox.js        # the delivery worker: claim, send, backoff, dead-letter
│       └── routes/
│           ├── health.js
│           ├── auth.js
│           ├── admin.js      # admin-only: doctors, availability, leave, outbox
│           ├── doctors.js    # read-only, any authenticated role
│           ├── appointments.js
│           ├── doctor.js     # GET /api/doctor/queue
│           ├── google.js     # OAuth connect/callback/disconnect/status (thin, calls google/)
│           └── internal.js   # cron trigger
└── web/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/{main.jsx, App.jsx, api.js, styles.css, AuthContext.jsx, pages/, components/}
```

---

## Setup

### 1. Prerequisites

- Node.js **20.6 or newer** (`--env-file` support)
- A PostgreSQL 13+ database — a free [Neon](https://neon.tech) or
  [Supabase](https://supabase.com) instance works, or local Postgres

### 2. Configure

```bash
git clone https://github.com/<username>/healthcare-appointment-manager.git
cd healthcare-appointment-manager
cp .env.example server/.env
```

Edit `server/.env` and set at minimum `DATABASE_URL` and `JWT_SECRET`.
Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `DATABASE_SSL=false` for a local Postgres; leave it `true` for Neon/Supabase/Render.

### 3. Create the schema

```bash
cd server
npm install
npm run migrate      # applies ../docs/schema.sql — safe to re-run
```

Expected output: `[migrate] done. 13 tables present: ...`

Set `LLM_API_KEY` to a [Groq](https://console.groq.com) API key to enable the pre-visit
summary (Day 5) - a blank key degrades gracefully (booking still works; the doctor sees the
raw symptom form with a "Summary unavailable" retry button instead of a generated summary).

**SMTP (Day 6, optional).** Leave `SMTP_USER` blank and the app runs fully without any email
setup: `server/src/mail/transport.js` falls back to a console transport that logs each
rendered email to the server output and reports it as delivered, so the entire outbox flow -
confirm a booking, run the worker, watch the row land on `'sent'` - works end to end on a
fresh clone with zero configuration. To send real email with a Gmail account:

1. Turn on 2-Step Verification on the Google account.
2. Create an [App Password](https://myaccount.google.com/apppasswords) (Mail, any device name).
3. Set in `server/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=<the 16-character app password, no spaces>
   MAIL_FROM=Clinic <you@gmail.com>
   ```

Any other SMTP provider works the same way - just set `SMTP_HOST`/`SMTP_PORT` accordingly.

**Google Calendar (Day 7, optional).** Leave `GOOGLE_CLIENT_ID` blank and everything still
works - booking, confirming, cancelling, rescheduling are all identical for a user who
never connects Google; `GET /api/google/connect` just responds `503` instead of building a
broken authorization URL. Full Console setup (project, OAuth consent screen, **why
publishing status must be "In production" and not "Testing"** - Testing expires refresh
tokens after 7 days, which would kill a demo judged weeks later - scope, redirect URIs) is
in [`docs/google-calendar-setup.md`](docs/google-calendar-setup.md). Once you have a
client id/secret:
```
GOOGLE_CLIENT_ID=<from the Console>
GOOGLE_CLIENT_SECRET=<from the Console>
GOOGLE_REDIRECT_URI=http://localhost:4000/api/google/callback
```

### 4. Configure the frontend

```bash
cp web/.env.example web/.env
```

`VITE_API_URL` defaults to `http://localhost:4000` for local dev; point it at the deployed
backend URL in production.

### 5. Run

```bash
# terminal 1 — API on http://localhost:4000
cd server && npm run dev

# terminal 2 — UI on http://localhost:5173
cd web && npm install && npm run dev
```

Open <http://localhost:5173>. Both checks on the page should read green.

### 6. Verify the concurrency guarantee

```bash
cd server && node --env-file=.env scripts/concurrency-check.js
```

Fires 20 simultaneous booking attempts at one slot and asserts that exactly one wins:

```
[test] succeeded        : 1   (expected 1)
[test] 23505 conflicts  : 19  (expected 19)
[test] unexpected errors: 0   (expected 0)
[test] rows in DB       : 1   (expected 1)

PASS - no double booking possible.
```

---

## Health endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness. Responds even if the database is down. |
| `GET` | `/api/health/db` | Readiness. Round-trips to Postgres, returns latency and pool stats. `503` if unreachable. |

---

## Database design

Full DDL with commentary in [`docs/schema.sql`](docs/schema.sql). Thirteen tables:

`users` · `doctors` · `doctor_availability` · `doctor_leave` · `appointments` ·
`symptom_forms` · `visit_notes` · `prescriptions` · `ai_summaries` · `reminders` ·
`outbox` · `google_accounts` · `calendar_events`

Three decisions carry most of the design:

**1. Concurrency is enforced by Postgres, not by application code.**

```sql
CREATE UNIQUE INDEX unique_active_appointment
  ON appointments (doctor_id, starts_at)
  WHERE status IN ('held', 'confirmed');
```

Two simultaneous requests for the same slot produce one row and one `23505` unique violation,
which the API maps to `409 CONFLICT`. Because cancelled and expired rows fall outside the partial
index, a freed slot becomes bookable again immediately.

**2. Every outbound side effect goes through a transactional `outbox`.**

Email and calendar rows are inserted in the *same transaction* as the business change. A confirmed
booking can never exist without its pending notification, and a failed SMTP or Google call can
never roll back a booking. A worker claims due rows with `FOR UPDATE SKIP LOCKED`, marks them
`'processing'`, and retries failures with exponential backoff (~1m, 5m, 15m, 1h, 6h, with jitter)
up to `max_attempts`, after which a row becomes a `'failed'` dead letter an admin retries
deliberately (`/admin/notifications`) rather than something the worker keeps hammering on its
own. `email`-topic rows go through Nodemailer today; `calendar`-topic rows are left untouched
for Day 7. Full write-up: `docs/system-design.md` §4.

`reminders` holds the *schedule* (what is due, when); `outbox` holds the *delivery* (how it is
sent, with retries). The background job moves work from one to the other - confirming an
appointment schedules a 24h and a 2h reminder for the patient; cancelling, rescheduling, or a
leave cascade cancels any of those still `'scheduled'`, so a cancelled appointment never reminds.

**3. Google OAuth credentials live in `google_accounts`, never on `users`.**

Tokens, expiry, scope, and `calendar_id` are isolated, so a user can connect or disconnect
Calendar without touching their login - both `access_token` and `refresh_token` are
encrypted at rest (AES-256-GCM, key derived from `JWT_SECRET`; see
`docs/google-calendar-setup.md`). `calendar_events` maps each appointment to the Google event
id **per user**, which is what makes update-on-reschedule and delete-on-cancel possible for both
patient and doctor - a *separate* event on each participant's own calendar, never one event with
the other party invited as an attendee (avoids Google's own invitation emails, avoids attendee
permission problems on personal accounts, and keeps the two calendars' lifecycles independent).
Calendar is entirely optional: nothing in the booking/confirm/cancel/reschedule request path
ever calls Google - only the outbox worker does, on its own tick, and a user who never connects
just gets `calendar`-topic rows that dead-letter immediately as `google_not_connected`.

---

## LLM: pre-visit triage summary

Full prompts, JSON schema, validation rules, retry/give-up policy, and the prompt-injection
guard (with a verified real test case) are documented in
[`docs/llm-prompts.md`](docs/llm-prompts.md). The short version: the model is never called
inside a request handler (`POST /api/appointments/:id/symptoms` only inserts a `pending`
`ai_summaries` row), confirming an appointment never depends on the summary being ready, and
every failure mode - timeout, missing/invalid key, rate limit, malformed output surviving one
repair attempt - degrades to a `failed` row with the raw symptom form still fully visible to
the doctor, never a crash or a blocked booking.

---

## Roadmap

| Day | Scope | Status |
|---|---|---|
| 1 | Repo, schema, DB layer, health checks | ✅ done |
| 2 | Auth: register/login, scrypt, JWT, role middleware, admin seed | ✅ done |
| 3 | Admin portal: doctor CRUD, availability, leave days | ✅ done |
| 4 | Slot generation, hold/confirm flow, **concurrency test** | ✅ done |
| 5 | Symptom form, pre-visit LLM summary, doctor queue | ✅ done |
| 6 | Outbox worker, Nodemailer, booking/cancellation emails | ✅ done |
| 7 | Google Calendar OAuth, create/update/delete events | ✅ done |
| 8 | Post-visit notes, prescriptions, medication reminders | |
| 9 | Deployment + integration testing | |
| 10 | Documentation, system-design write-up, final audit | |

---

## Submission checklist

- [x] Public GitHub repository, branch `main`
- [x] `.gitignore` excludes `node_modules/`, `.env`, build artifacts, `.vscode/`, `.idea/`
- [x] `.env.example` committed; real `.env` never committed
- [x] Minimal dependencies, native where possible
- [ ] App runs without errors from a fresh clone
- [ ] Hosted application URL
- [ ] `docs/api.md` complete
- [ ] `docs/system-design.md` (≤ 800 words)
- [ ] Zip export of the clean clone
