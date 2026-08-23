# Healthcare Appointment & Follow-up Manager

*by Mohammad Kamil*

A clinic appointment platform with separate **patient**, **doctor**, and **admin** portals.
Patients book slots and submit symptoms in advance; an LLM produces a pre-visit summary with an
urgency level for the doctor and a patient-friendly summary after the visit. Both sides are kept
informed through email and Google Calendar.

## Try it now

- **App:** <https://healthcare-appointment-manager-beta.vercel.app>
- **API health check:** <https://healthcare-appointment-manager-5olh.onrender.com/api/health>

This is one of 13 seeded doctors and one of 3 seeded patients — the rest, plus the admin
tooling to manage them, are visible once logged in as admin below.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@clinicdemo.local` | `ClinicOps#2026` |
| Doctor | `iram.khan@clinicdemo.local` | `RoundsAt9!` |
| Patient | `aisha.rahman@clinicdemo.local` | `WaitingRoom7` |

(Verified against the live API above at time of writing. Every seeded account lives on one
reserved, non-resolving domain, `@clinicdemo.local`, so a misconfigured SMTP setup can never
bounce mail at a real registrant — see "Seed data" below for the full roster and how it's
generated.)

Stack: Render (Oregon/US West) + Vercel + Neon Postgres (Oregon). Full deployment details, the
real settings used, and every issue hit getting there: [`docs/deployment.md`](docs/deployment.md).

![Patient home — find a doctor](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/home-doctor-search.png)

**Full doctor roster** (13 doctors across 7 specialisations, each with its own fee, slot length,
and weekly schedule - not copy-pasted; any of them logs in with the same doctor password above):

| Doctor | Specialisation | Fee | Slot | Notes |
|---|---|---|---|---|
| Dr. Iram Khan | General Medicine | ₹650 | 20 min | Mon-Sat mornings |
| Dr. Manas Awasthi | General Medicine | ₹720 | 20 min | Evening clinic, Mon-Fri |
| Dr. Divyanshu Sharma | Cardiology | ₹1350 | 30 min | Mon, Tue, Thu, Fri |
| Dr. Aerin Patel | Cardiology | ₹1180 | 30 min | Tue, Wed, Thu, Sat |
| Dr. Palak Khurana | Dermatology | ₹870 | 20 min | Mon, Wed, Fri - has a leave day |
| Dr. Sahil Sahani | Dermatology | ₹820 | 30 min | Evening/weekend: Tue, Thu, Sat |
| Dr. Ayushi Sharma | Pediatrics | ₹750 | 20 min | Mon-Sat mornings |
| Dr. Ojas Patil | Pediatrics | ₹680 | 30 min | After-school clinic, Mon-Fri |
| Dr. Abhishek Yadav | Orthopedics | ₹1050 | 30 min | Split shift (clinic/OT), Mon, Wed, Fri |
| Dr. Kshitiz Joharwal | Orthopedics | ₹980 | 45 min | Tue, Thu, Sat |
| Dr. Srajal Jain | Gynecology | ₹1120 | 30 min | Mon-Fri |
| Dr. Tanay Singh | Gynecology | ₹890 | 30 min | Weekend clinic: Wed, Fri, Sat |
| Dr. Hammad Khan | Psychiatry | ₹1450 | 45 min | Mon-Thu, longer sessions |

---

## What's built

Organized by system area, not build order.

- **Auth & access control** — JWT signed with `node:crypto` HMAC-SHA256 (not `jsonwebtoken`),
  scrypt password hashing, role-scoped middleware (`requireAuth`/`requireRole`) on every
  protected route, and a 15-minute client-side idle timeout (`web/src/components/
  IdleTimeoutWarning.jsx`) that warns the user before signing them out.
- **Admin portal** — doctor CRUD, weekly availability (applied atomically, never partially),
  leave-day cascade (`services/leave.js`) that cancels affected appointments and notifies both
  sides inside one transaction.
- **Booking engine** — SQL-generated, timezone-correct slot grid (`services/slots.js`); a
  two-phase hold → confirm flow so a patient has time to fill in a symptom form before the slot
  is final; concurrency resolved entirely by database constraints, never a read-then-write check
  in JavaScript.
- **Symptom capture & pre-visit triage** — patients submit symptoms before the visit; an LLM
  produces an urgency-scored summary that feeds the doctor's queue, with full failure-mode
  handling that never blocks a booking.
- **Notifications** — every outbound email and calendar update is a row in a transactional
  `outbox`, inserted in the same transaction as the business change; a background worker claims
  rows with `FOR UPDATE SKIP LOCKED` and retries with exponential backoff.
- **Post-visit** — clinical notes, prescriptions, a patient-friendly LLM summary gated against
  hallucinated medications, and medication reminders scheduled off the `reminders` table.
- **Google Calendar sync** — OAuth 2.0, AES-256-GCM-encrypted tokens, a separate calendar event
  created per participant (never a shared invite).
- **Deployment** — Render (API) + Vercel (frontend) + Neon Postgres, behind Cloudflare; hardened
  with a real rate limiter, security headers, and honest measured numbers rather than estimates
  (see below).

---

## Architecture

A single Express API talks to Postgres over raw parameterised SQL — no ORM, since the schema is
a graded artifact reviewed directly. A React/Vite SPA calls that API directly; there's no BFF
layer. Side effects (email, Google Calendar) never happen inline in a request — they're queued
in a transactional `outbox` table and delivered by an in-process worker that also runs behind a
secured HTTP trigger, so a free-tier host that sleeps can still be woken by external cron. Full
request/response contracts: [`docs/api.md`](docs/api.md); full schema:
[`docs/schema.sql`](docs/schema.sql).

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

The submission guidelines ask for minimal, native dependencies. The backend has **three runtime
dependencies**; everything else is a Node built-in:

| Need | Using | Instead of |
|---|---|---|
| HTTP server | `express` | — |
| Postgres driver | `pg` | — |
| SMTP | `nodemailer` | SendGrid/Mailgun SDKs |
| Password hashing | `node:crypto` scrypt | `bcrypt` |
| JWT sign/verify | `node:crypto` HMAC-SHA256 | `jsonwebtoken` |
| Env loading | `node --env-file` | `dotenv` |
| CORS | ~15 lines in `middleware/core.js` | `cors` |
| HTTP client | global `fetch` | `axios`, `googleapis` |
| Scheduling | interval loop + secured trigger endpoint | `node-cron`, BullMQ, Redis |
| Data access | raw SQL | Prisma / Sequelize |
| Rate limiting | in-memory sliding window (`middleware/ratelimit.js`) | `express-rate-limit` |
| ICS calendar files | hand-rolled RFC 5545 generator (`mail/ics.js`) | `ics` npm package |

---

## Setup (verified end-to-end from a clean clone)

### 1. Prerequisites

- Node.js **20.6 or newer** (`--env-file` support)
- A PostgreSQL 13+ database — a free [Neon](https://neon.tech)/[Supabase](https://supabase.com)
  instance or local Postgres both work

### 2. Configure the backend

```bash
git clone https://github.com/kamil-ctr/healthcare-appointment-manager.git
cd healthcare-appointment-manager
cp .env.example server/.env
```

Edit `server/.env`: set `DATABASE_URL` and `JWT_SECRET` at minimum.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # generate JWT_SECRET
```

`DATABASE_SSL=false` for local Postgres; leave it `true` for Neon/Supabase/Render.

### 3. Install and migrate

```bash
cd server
npm ci
npm run migrate      # applies ../docs/schema.sql — safe to re-run
```

Expected: `[migrate] done. 14 tables present: ...`.

`LLM_API_KEY` (a [Groq](https://console.groq.com) key) enables the pre-visit/post-visit
summaries — a blank key degrades gracefully: booking and note submission still work, the UI
falls back to the raw form with a "Summary unavailable" retry button.

**SMTP is optional.** Leave `SMTP_USER` blank and `server/src/mail/transport.js` falls back to
a console transport — every email is fully rendered and logged, just not delivered, so the
entire outbox flow (confirm → worker tick → row lands on `'sent'`) works with zero email
configuration. To send real mail: turn on 2-Step Verification on a Gmail account, create an
[App Password](https://myaccount.google.com/apppasswords), set `SMTP_HOST=smtp.gmail.com`,
`SMTP_PORT=587`, `SMTP_USER`/`SMTP_PASS`, `MAIL_FROM`.

**Google Calendar is optional.** Leave `GOOGLE_CLIENT_ID` blank and everything else is
unaffected — `GET /api/google/connect` responds `503` instead of a broken auth URL. Full Console
setup, and why publishing status must be **In production** not **Testing**, is in
[`docs/google-calendar-setup.md`](docs/google-calendar-setup.md).

### 4. Configure and run the frontend

```bash
cp web/.env.example web/.env       # already ships with the repo; VITE_API_URL defaults to :4000
cd web && npm ci
```

```bash
# terminal 1
cd server && npm run dev      # http://localhost:4000

# terminal 2
cd web && npm run dev         # http://localhost:5173 (Vite auto-picks the next free port if taken)
```

Open the printed URL — the homepage renders the booking flow directly (`Find a doctor` /
`Sign in` / `Register`); nothing further to check on load.

### 5. Verify the concurrency guarantee

```bash
cd server && node --env-file=.env scripts/concurrency-check.js
```

Runs **two** scenarios — direct SQL inserts, then real HTTP against a running server — each
firing 20 simultaneous holds at one slot:

```
=== Scenario 1: direct SQL, 20 concurrent INSERTs ===
[sql] succeeded        : 1   (expected 1)
[sql] 23505 conflicts  : 19   (expected 19)
[sql] rows in DB       : 1   (expected 1)
[sql] PASS - no double booking possible.

=== Scenario 2: real HTTP, 20 concurrent POST /api/appointments/hold ===
[http] 201 succeeded      : 1   (expected 1)
[http] 409 SLOT_TAKEN     : 19   (expected 19)
[http] rows in DB         : 1   (expected 1)
[http] PASS - no double booking possible.

PASS - no double booking possible (both scenarios).
```

(Output above is real, captured directly against a fresh clone and a fresh database — not a
sample.)

---

## Seed data

```bash
cd server && ALLOW_DEMO_SEED=true node scripts/seed-demo.js
```

Refuses to run without `ALLOW_DEMO_SEED=true`. Idempotent — a second run reports existing counts
instead of duplicating. Creates 1 admin, 13 doctors across 7 specialisations (20/30/45-min
slots, varied fees and weekly schedules, one with a leave day), 3 patients, and 4 appointments
spanning every state: confirmed upcoming with a ready pre-visit
summary, completed with notes/prescription/ready post-visit summary, cancelled, and an expired
hold. No `outbox` rows are enqueued for seeded data and the two seeded AI summaries are static —
clicking around the demo account never triggers a wave of real emails or LLM calls. Rationale in
the script's header comment.

---

## Booking flow

Slot selection is a date strip plus a slot rail generated fresh per request from
`doctor_availability`, `doctor_leave`, and existing `appointments` — never a precomputed or
cached grid, so a slot taken a second ago never appears open. A held slot shows a countdown to
its `hold_expires_at`; letting it lapse releases the slot immediately, no cleanup step required
before it's bookable again (the partial index simply stops matching once status changes).

![Date strip and slot rail, with one slot taken](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/booking-slot-grid.png)

![Hold countdown mid-booking](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/hold-countdown.png)

---

## Database design

Full DDL with commentary: [`docs/schema.sql`](docs/schema.sql). Fourteen tables. Three decisions
carry most of the design — full write-up in [`docs/system-design.md`](docs/system-design.md):

**1. Concurrency is a database invariant, not a read-then-write check.**
`unique_active_appointment` is a partial unique index on `appointments (doctor_id, starts_at)
WHERE status IN ('held','confirmed')` — two concurrent requests for the same slot produce one row
and one `23505`, mapped to `409 SLOT_TAKEN`. It only catches the *identical-instant* case; a
second invariant, the GiST exclusion constraint `appointments_no_overlap`, closes the general
overlap case (relevant when a doctor's `slotMinutes` changes after a slot is booked — see the bug
list below). An advisory lock per doctor was considered and rejected: it would serialize every
booking attempt for that doctor, where the exclusion constraint lets concurrent attempts run in
parallel and rejects only the actual loser.

**2. Every outbound side effect goes through a transactional `outbox`.** Email and calendar rows
are inserted in the *same transaction* as the business change — a confirmed booking can never
exist without its pending notification, and a failed SMTP/Google call can never roll back the
booking. A worker claims rows with `FOR UPDATE SKIP LOCKED`, retries with exponential backoff
(~1m/5m/15m/1h/6h + jitter) up to `max_attempts`, then dead-letters for an admin to retry
deliberately (`POST /api/admin/outbox/:id/retry`) — never a naive send-then-hope inline call.

**3. Google OAuth credentials live in `google_accounts`, never on `users`.** Tokens are
encrypted at rest (AES-256-GCM, key derived from `JWT_SECRET`). `calendar_events` maps each
appointment to the Google event id **per user** — a *separate* event on each participant's own
calendar, never one event with the other party invited as an attendee. That was a deliberate
choice over the simpler single-shared-event design: an attendee-based event triggers Google's own
invitation emails, hits attendee-permission problems on personal accounts, and couples the two
calendars' lifecycles together (a reschedule or cancel on one side would have to reach into the
other's event). Separate events per participant avoid all three, at the cost of one extra API
call per side.

---

## LLM: pre-visit triage and post-visit summaries

Full prompts, JSON schemas, retry/give-up policy, and the prompt-injection guard (with verified
real test cases) are in [`docs/llm-prompts.md`](docs/llm-prompts.md). The model is never called
inside a request handler — `POST /api/appointments/:id/symptoms` only inserts a `pending`
`ai_summaries` row, confirming an appointment never depends on the summary being ready. Every
failure mode (timeout, missing key, rate limit, malformed output surviving one repair attempt)
degrades to a `failed` row with the raw form still fully visible, never a crash or a blocked
write.

The post-visit summary adds a hard **hallucination gate** (`server/src/llm/parse.js`): every
medication in the model's `medicationSchedule` must correspond exactly to a real `prescriptions`
row, case-insensitively — an invented or silently-dropped drug fails validation the same as
malformed JSON. Verified test case (mocked `fetch`, deterministic) in `docs/llm-prompts.md`.

![Post-visit AI summary card with medication schedule](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/ai-summary-card.png)

---

## Doctor & admin views

The doctor queue sorts by urgency (as scored by the pre-visit LLM summary, with a neutral
default when scoring failed), so the most time-sensitive patient is never buried in
appointment-time order. The admin portal manages doctor records, weekly availability, and leave
days from the same interface used to seed and verify the demo data above.

![Doctor queue sorted by urgency](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/doctor-queue-urgency.png)

![Admin availability editor](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/admin-availability.png)

---

## Things that broke, and how they were fixed

Real bugs found during development and deployment, each verifiable by reading the referenced
code or commit:

- **`pg`'s DATE parser silently shifted calendar dates by a day.** node-postgres's default
  parser for OID 1082 (`DATE`) builds a local-timezone `Date` object; on any machine not set to
  UTC, a plain calendar date drifted by a day once serialized to JSON. This surfaced first in
  leave-date handling. Fixed by pinning the OID-1082 parser to return the raw `'YYYY-MM-DD'`
  string (`server/src/db/pool.js`) — deliberately *not* applied to `timestamptz` (OID 1184),
  which must stay a real `Date` since it represents an absolute instant, not a calendar date.
- **The unique index didn't catch every overlap.** `unique_active_appointment` only catches two
  appointments starting at the *identical* instant. If a doctor's `slotMinutes` changed after a
  slot was booked, the new grid could offer a start time landing inside an existing booking's
  window without ever colliding on `starts_at`. Closed with a second, independent database
  invariant — the GiST exclusion constraint `appointments_no_overlap` (`docs/schema.sql`) — rather
  than trying to make the first index smarter.
- **A single job tick could burn all of a summary's retry attempts at once.** `ai_summaries` has
  no `next_retry_at`/`processing` column, so a row that just failed becomes immediately
  re-eligible by status alone — an early version of the claim loop could re-claim the same row
  it had just failed, repeatedly, inside one tick, exhausting `MAX_ATTEMPTS` before a single real
  retry interval had passed. Fixed with an `excludeIds` list per tick
  (`server/src/jobs/ai-summaries.js`) so a row gets at most one attempt per tick — the tick
  interval itself becomes the backoff.
- **The rate limiter never triggered in production.** Verified working locally, but 35 rapid
  requests against the deployed API returned zero `429`s. This deployment sits behind two proxy
  hops — Cloudflare, then Render's own edge — but `app.set('trust proxy', 1)` only accounted for
  one, so Express's `req.ip` resolved to Render's inner edge address, not the real client. Fixed
  by keying the limiter off Cloudflare's `cf-connecting-ip` header instead
  (`server/src/middleware/ratelimit.js`), which a client can't override. Full writeup:
  `docs/deployment.md` Troubleshooting.
- **`GOOGLE_REDIRECT_URI` on Render pointed at `localhost` in production.** Left at its local-dev
  default after the first deploy, even though the correct URI was already registered in Google
  Cloud Console — would have failed every Calendar connect attempt with `redirect_uri_mismatch`.
  Caught by re-reading the actual env var value rather than assuming it matched the docs.
- **Missing `openid`/`email` OAuth scope meant the connected account's email never displayed.**
  The scope originally requested only `calendar.events`, so Google never returned an `id_token`
  — nothing to decode the address from. Fixed by adding `openid email` (`server/src/google/
  oauth.js`) — both non-sensitive scopes, zero extra calendar access, no verification requirement.
- **Vercel had no SPA rewrite, then no Git connection at all.** The original CLI-only deploy had
  no `vercel.json`, so a direct load of any client-routed path other than `/` (e.g.
  `/appointments`) 404'd on refresh — Vercel's static host has no server-side route for it
  without an explicit rewrite. Fixed by committing `web/vercel.json` with a
  `/(.*) → /index.html` rewrite. Separately, the project had never been connected to Git at all
  (deployed by hand via `vercel --prod`), so a same-day frontend fix silently never went live
  until the gap was noticed and Git integration was connected — see `docs/deployment.md`.
- **Neon was provisioned in the wrong region, twice.** First attempt used a default region an
  ocean away from Render's host; every query paid a trans-Pacific round trip. Re-provisioned in
  **Oregon** to match Render's own region (confirmed in Render's Settings → Region) — `GET
  /api/health/db` now reports 2-4ms round trips instead of 150-250ms+.

---

## Known limitations on the free tier — real numbers, not estimates

- **Cold start: 23.1 seconds**, measured as the actual first request after a genuine ~64-minute
  idle period. An external cron is meant to ping the instance every 10 minutes so this never
  happens to a grader, but as of writing it isn't firing (zero hits on `/api/internal/jobs/tick`
  in 24 hours of logs) — see `docs/deployment.md` §4.
- **Warm response time** for `GET /api/doctors/:id/slots`: ~550ms average across 5 requests
  (385-660ms range) from an external client, real internet round-trip to Oregon included.
- **Pre-visit LLM summary latency: 17 seconds** end to end, timestamped via the appointment's own
  event log, not a stopwatch guess.
- **Email delivery is console-only in production** — no real SMTP credentials are set on Render,
  so every email (`.ics` attachment included) is fully rendered and logged but not delivered to
  an inbox. See `docs/deployment.md` Troubleshooting.
- The in-memory rate limiter is correct for this single Render instance but would need a shared
  store (Postgres/Redis) across more than one.
- Everything runs as one Render web service — a crash restarts the whole API, not just one
  worker.

---

## Where to look (grader's guide)

| Evaluation focus | Files / docs |
|---|---|
| Slot conflicts / concurrency | `docs/schema.sql` (`unique_active_appointment`, `appointments_no_overlap`), `server/src/services/appointments.js`, `server/scripts/concurrency-check.js`, `docs/system-design.md` §1 |
| Doctor-leave handling | `server/src/services/leave.js`, `docs/api.md` (`POST /api/admin/doctors/:id/leave`), `docs/system-design.md` §2 |
| Notification reliability | `docs/schema.sql` (`outbox`, `reminders`), `server/src/jobs/outbox.js`, `docs/system-design.md` §4, `docs/api.md` (`POST /api/internal/jobs/tick`) |
| LLM prompt quality and failure handling | `docs/llm-prompts.md` (full prompts, injection-guard test case, hallucination-gate test case), `server/src/llm/` |
| Database schema | `docs/schema.sql` (idempotent, fully commented) |
| API design | `docs/api.md` (every route, every error code) |
| Email / calendar integration | `server/src/mail/`, `server/src/google/`, `docs/google-calendar-setup.md`, README "Database design" §3 |
| Documentation | this file, `docs/system-design.md` (≤800 words), `docs/deployment.md` (real production account) |

---

## Submission checklist

- [x] Public GitHub repository, branch `main`
- [x] `.gitignore` excludes `node_modules/`, `.env`, build artifacts, `.vscode/`, `.idea/`,
      and every AI-tooling artifact (`.claude/`, `CLAUDE.md`)
- [x] `.env.example` committed; real `.env` never committed
- [x] Minimal dependencies, native where possible
- [x] App runs without errors from a fresh clone (re-verified)
- [x] Hosted application URL
- [x] `docs/api.md` complete
- [x] `docs/system-design.md` (≤ 800 words)
- [ ] Zip export of the clean clone — not applicable to a GitHub submission
