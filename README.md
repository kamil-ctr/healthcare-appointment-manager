# Healthcare Appointment & Follow-up Manager

A clinic appointment platform with separate **patient**, **doctor**, and **admin** portals.
Patients book slots and submit symptoms in advance; an LLM produces a pre-visit summary with an
urgency level for the doctor and a patient-friendly summary after the visit. Both sides are kept
informed through email and Google Calendar.

> **Status:** Day 8 of 10 — post-visit notes, prescriptions, a patient-friendly post-visit
> summary (LLM, with a hallucination gate on the medication schedule), and medication/follow-up
> reminders close the last functional requirement in the brief. Day 7 (previous): Google
> Calendar OAuth 2.0 (native fetch, no `googleapis` package), AES-256-GCM token encryption at
> rest, transparent access-token refresh, and the calendar-topic outbox handler (create/update/
> delete events, idempotent 404/410 handling, revoked-grant detection) - entirely optional,
> nothing in the booking request path ever calls Google. Day 7 hardening pass: a GiST exclusion
> constraint closing the overlap hole `unique_active_appointment` couldn't catch, inline
> per-doctor stale-hold expiry, an append-only `appointment_events` audit log with a timeline
> UI, and hand-rolled
> RFC 5545 `.ics` calendar attachments. See [Roadmap](#roadmap) for what lands next.

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
│       │   ├── parse.js      # strict output validation + post-visit hallucination gate
│       │   ├── pre-visit.js  # orchestrates call -> validate -> one repair -> give up
│       │   └── post-visit.js # same shape, post-visit patient-friendly summary
│       ├── google/
│       │   ├── crypto.js     # AES-256-GCM token encryption at rest (key from JWT_SECRET)
│       │   ├── oauth.js      # connect/callback/disconnect/status, signed state param
│       │   ├── tokens.js     # getAccessToken(): transparent refresh, revoked-grant handling
│       │   └── calendar.js   # native-fetch Calendar REST client: create/patch/delete
│       ├── mail/
│       │   ├── transport.js  # one shared nodemailer transport, console fallback
│       │   ├── templates.js  # plain-literal email templates, doctor-timezone rendering
│       │   └── ics.js        # hand-rolled RFC 5545 .ics generator, no dependency
│       ├── middleware/
│       │   ├── core.js
│       │   └── auth.js       # requireAuth, requireRole(...)
│       ├── services/
│       │   ├── doctors.js    # doctor CRUD, availability
│       │   ├── leave.js      # leave + appointment-cancellation cascade
│       │   ├── appointments.js  # hold/confirm/cancel/reschedule + reminder scheduling
│       │   ├── slots.js
│       │   ├── symptoms.js   # symptom form submission, pre-visit summary get/retry
│       │   ├── notes.js      # visit notes/prescriptions submit+amend, post-visit summary get/retry
│       │   ├── reminders.js  # medication/follow-up reminder expansion (FREQUENCY_TIMES)
│       │   ├── queue.js      # doctor's urgency-sorted daily queue
│       │   ├── notifications.js  # admin outbox listing + dead-letter retry
│       │   └── events.js     # appointment_events append helper (logEvent, actor)
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

Expected output: `[migrate] done. 14 tables present: ...`

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

Full DDL with commentary in [`docs/schema.sql`](docs/schema.sql). Fourteen tables:

`users` · `doctors` · `doctor_availability` · `doctor_leave` · `appointments` ·
`appointment_events` · `symptom_forms` · `visit_notes` · `prescriptions` · `ai_summaries` ·
`reminders` · `outbox` · `google_accounts` · `calendar_events`

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

That index only catches two appointments starting at the *identical* instant, not general
overlap - a doctor's `slotMinutes` changing after a slot is booked can otherwise offer a new
start time that lands inside an existing appointment's window. A GiST exclusion constraint,
`appointments_no_overlap`, closes that hole as a second database invariant (`23P01`, also
mapped to `409 SLOT_TAKEN`); the same pattern is applied to `doctor_availability` so
overlapping weekly blocks are rejected at the database level too. An advisory lock per doctor
was considered and rejected here: it would serialise every booking attempt for that doctor one
at a time, while the exclusion constraint lets concurrent attempts run fully in parallel and
rejects only the actual loser.

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

**4. Every appointment's history is auditable, and every confirmation/cancellation carries a
calendar file that works without Google.**

`appointment_events` is an append-only log (`held`, `symptoms_submitted`, `confirmed`,
`cancelled_by_*`, `expired`, `rescheduled`, `summary_ready`/`summary_failed`, `email_sent`,
`calendar_event_created`/`_deleted`) written in the same transaction as the change itself, never
after - `GET /api/appointments/:id/events` renders it as a timeline on the appointment detail
page, which is what makes the leave cascade and hold expiry independently verifiable instead of
only asserted. Separately, `server/src/mail/ics.js` hand-rolls an RFC 5545 `.ics` file (no
dependency) attached to booking-confirmation, cancellation, and leave-cancellation emails.
Google Calendar sync requires the recipient to complete OAuth first, so an ICS attachment is the
only notification path that reaches *every* recipient - including a grader who never connects an
account - which is why it exists alongside, not instead of, the Day 7 integration.

---

## LLM: pre-visit triage and post-visit summaries

Full prompts, JSON schemas, validation rules, retry/give-up policy, and the prompt-injection
guard (with verified real test cases) are documented in
[`docs/llm-prompts.md`](docs/llm-prompts.md). The short version: the model is never called
inside a request handler (`POST /api/appointments/:id/symptoms` only inserts a `pending`
`ai_summaries` row, same for `POST/PATCH /api/appointments/:id/notes`), confirming an
appointment never depends on the pre-visit summary being ready, and every failure mode -
timeout, missing/invalid key, rate limit, malformed output surviving one repair attempt -
degrades to a `failed` row with the raw symptom form (or, post-visit, the raw clinical notes
and real prescription list) still fully visible, never a crash or a blocked write.

The post-visit summary (Day 8) adds a hard **hallucination gate**
(`server/src/llm/parse.js`): every medication in the model's `medicationSchedule` must
correspond exactly to a real `prescriptions` row for that appointment, case-insensitively - an
invented drug or a silently-dropped one fails validation just like malformed JSON, triggers the
same one-repair-then-give-up policy, and ends the row `'failed'` rather than shipping a
patient-facing summary that could be wrong about their own medication. Verified test case (fetch
mocked to force the failure deterministically) in `docs/llm-prompts.md`.

**Medication reminder scheduling** (`server/src/services/reminders.js`) expands each
prescription into individual `reminders` rows, starting the day after the visit and running for
`durationDays`, at times of day (in the **doctor's** timezone) fixed by `frequencyPerDay`:

| Times/day | Schedule (local time) |
|---|---|
| 1 | 09:00 |
| 2 | 09:00, 21:00 |
| 3 | 08:00, 14:00, 20:00 |
| 4 | 08:00, 12:00, 16:00, 20:00 |
| 5 | 08:00, 11:30, 15:00, 18:30, 22:00 |
| 6 | 08:00, 10:48, 13:36, 16:24, 19:12, 22:00 |

(5 and 6 are evenly spaced across the 08:00-22:00 window.) Rows already in the past are skipped
(relevant when notes are entered late in the day), and the total is capped at 400 per appointment
- a prescription that would exceed the cap is clamped, with the clamp recorded in the API
response rather than silently dropped. Amending notes (`PATCH .../notes`) cancels every
still-`'scheduled'` reminder before rescheduling against the new prescriptions, so a superseded
dose can never fire.

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
| 7+ | Hardening: overlap exclusion constraints, inline hold expiry, event log + timeline, ICS attachments | ✅ done |
| 8 | Post-visit notes, prescriptions, post-visit LLM summary, medication reminders | ✅ done |
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
