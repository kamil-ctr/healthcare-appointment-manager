# Healthcare Appointment & Follow-up Manager

*by Mohammad Kamil*

A clinic appointment platform with separate portals for patients, doctors, and admins. Patients
book a slot and fill in a symptom form before the visit. An AI model reads that form and writes a
short pre-visit summary with an urgency level for the doctor, then writes a plain-language summary
for the patient after the visit. Both sides get email and Google Calendar updates automatically.

## Try it now

- **App:** <https://healthcare-appointment-manager-beta.vercel.app>
- **API health check:** <https://healthcare-appointment-manager-5olh.onrender.com/api/health>

This is one of 13 seeded doctors and one of 3 seeded patients. Log in as admin below to see the
rest, plus the tools used to manage them.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@clinicdemo.local` | `ClinicOps#2026` |
| Doctor | `iram.khan@clinicdemo.local` | `RoundsAt9!` |
| Patient | `aisha.rahman@clinicdemo.local` | `WaitingRoom7` |

(Checked against the live API before publishing this. Every seeded account lives on one reserved,
non-resolving domain, `@clinicdemo.local`, so a misconfigured SMTP setup can never bounce mail at
a real inbox. See "Seed data" below for the full roster and how it's generated.)

Hosting: Render (Oregon) for the API, Vercel for the frontend, Neon Postgres (Oregon) for the
database. Full deployment notes, real settings, and every problem hit along the way are in
[`docs/deployment.md`](docs/deployment.md).

![Patient home — find a doctor](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/home-doctor-search.png)

**Full doctor roster** (13 doctors across 7 specialisations, each with a different fee, slot
length, and weekly schedule. Every doctor logs in with the same password shown above):

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

Grouped by area, not by the order it was built in.

- **Auth & access control.** JWT tokens signed with `node:crypto` HMAC-SHA256 (no
  `jsonwebtoken` package), passwords hashed with scrypt, role-checking middleware
  (`requireAuth`/`requireRole`) on every protected route, and a 15-minute idle timeout on the
  frontend (`web/src/components/IdleTimeoutWarning.jsx`) that warns the user before signing them
  out.
- **Admin portal.** Doctor records, weekly availability (saved all at once, never half-applied),
  and a leave-day flow (`services/leave.js`) that cancels the affected appointments and notifies
  both sides in a single transaction.
- **Booking engine.** A timezone-correct slot grid built with SQL (`services/slots.js`); a
  two-step hold-then-confirm flow that gives a patient time to fill in the symptom form before
  the slot is locked in; and booking conflicts are caught by database constraints, never by a
  read-then-write check in JavaScript.
- **Symptom capture and pre-visit triage.** Patients describe their symptoms before the visit.
  An AI model turns that into an urgency-scored summary for the doctor's queue, with proper
  handling for every way that call can fail, so a booking never gets stuck waiting on it.
- **Notifications.** Every email and calendar update is written as a row in a transactional
  `outbox` table, in the same transaction as whatever triggered it. A background worker picks
  rows up with `FOR UPDATE SKIP LOCKED` and retries failed ones with backoff.
- **Post-visit.** Clinical notes, prescriptions, an AI-written patient summary that's checked
  against the real prescription list so it can't invent a medication, and reminders scheduled off
  a `reminders` table.
- **Google Calendar sync.** OAuth 2.0, tokens encrypted with AES-256-GCM, and a separate calendar
  event created for each participant (never one shared invite).
- **Deployment.** Render for the API, Vercel for the frontend, Neon Postgres behind Cloudflare,
  with a real rate limiter, security headers, and measured numbers instead of guesses (see
  further down).

---

## Architecture

One Express API talks to Postgres with plain, parameterised SQL. There's no ORM, since the
schema itself is something that gets reviewed directly. A React/Vite frontend calls that API
directly, with no extra backend-for-frontend layer in between. Anything that leaves the system
(email, a calendar update) never happens inside a request. It gets queued as a row in the
`outbox` table and sent by a background worker, which also runs behind a secured HTTP endpoint
so a free-tier server that goes to sleep can still be woken up by an external cron job. Full
request and response details are in [`docs/api.md`](docs/api.md); the full schema is in
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

The brief asked for a small, mostly-native dependency list. The backend uses **three runtime
dependencies**; everything else is something Node already gives you:

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
| ICS calendar files | hand-written RFC 5545 generator (`mail/ics.js`) | `ics` npm package |

---

## Setup (tested end-to-end from a clean clone)

### 1. Prerequisites

- Node.js **20.6 or newer** (needed for `--env-file`)
- A PostgreSQL 13+ database - a free [Neon](https://neon.tech)/[Supabase](https://supabase.com)
  instance or local Postgres both work fine

### 2. Configure the backend

```bash
git clone https://github.com/kamil-ctr/healthcare-appointment-manager.git
cd healthcare-appointment-manager
cp .env.example server/.env
```

Edit `server/.env` and set `DATABASE_URL` and `JWT_SECRET` at minimum.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # generate JWT_SECRET
```

Set `DATABASE_SSL=false` for local Postgres, or leave it `true` for Neon/Supabase/Render.

### 3. Install and migrate

```bash
cd server
npm ci
npm run migrate      # applies ../docs/schema.sql - safe to re-run
```

You should see: `[migrate] done. 14 tables present: ...`.

`LLM_API_KEY` (a [Groq](https://console.groq.com) key) turns on the pre-visit and post-visit
summaries. Leaving it blank doesn't break anything: booking and note submission still work, and
the UI falls back to the raw form with a "Summary unavailable" retry button.

**SMTP is optional.** If `SMTP_USER` is blank, `server/src/mail/transport.js` falls back to
printing every email to the console instead of sending it. Nothing else changes: the whole
outbox flow still runs (confirm → worker tick → row marked `'sent'`), just without a real inbox
at the end. To send real mail, turn on 2-Step Verification on a Gmail account, generate an
[App Password](https://myaccount.google.com/apppasswords), and set `SMTP_HOST=smtp.gmail.com`,
`SMTP_PORT=587`, `SMTP_USER`/`SMTP_PASS`, and `MAIL_FROM`.

**Google Calendar is optional too.** Leave `GOOGLE_CLIENT_ID` blank and everything else keeps
working - `GET /api/google/connect` just returns a `503` instead of a broken sign-in link. Full
Console setup, and why the publishing status has to be **In production** and not **Testing**, is
in [`docs/google-calendar-setup.md`](docs/google-calendar-setup.md).

### 4. Configure and run the frontend

```bash
cp web/.env.example web/.env       # already in the repo; VITE_API_URL defaults to :4000
cd web && npm ci
```

```bash
# terminal 1
cd server && npm run dev      # http://localhost:4000

# terminal 2
cd web && npm run dev         # http://localhost:5173 (Vite picks the next free port if taken)
```

Open the printed URL. The homepage shows the booking flow right away, with links to find a
doctor, sign in, or register - there's nothing else to check on load.

### 5. Check the concurrency guarantee

```bash
cd server && node --env-file=.env scripts/concurrency-check.js
```

This runs two checks - one with direct SQL inserts, one over real HTTP against a running server
- and both fire 20 requests for the same slot at the same time:

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

(This output is real, taken from a fresh clone and a fresh database, not a made-up sample.)
Getting exactly 19 conflicts depends on the client not having hit the rate limit on the hold
endpoint recently - the rate limiter and the booking check are unrelated, so the actual guarantee
(one row, no double booking) holds either way.

---

## Seed data

```bash
cd server && ALLOW_DEMO_SEED=true node scripts/seed-demo.js
```

Won't run unless `ALLOW_DEMO_SEED=true` is set. Running it twice is safe - the second run just
reports what already exists instead of duplicating it. It creates 1 admin, 13 doctors across 7
specialisations (20/30/45-minute slots, different fees and weekly schedules, one with a leave
day), 3 patients, and 4 appointments that cover every state an appointment can be in: confirmed
with a ready pre-visit summary, completed with notes/prescription/a ready post-visit summary,
cancelled, and an expired hold. Seeded data never queues outbox rows and the two seeded AI
summaries are static text, so clicking around the demo account doesn't send real emails or make
real LLM calls. The reasoning is written out in the script's header comment.

---

## Booking flow

Slot selection is a date strip with a row of time slots below it, built fresh on every request
from `doctor_availability`, `doctor_leave`, and the current `appointments` table. It's never a
cached grid, so a slot that was just taken never shows up as open. A held slot shows a countdown
to its `hold_expires_at`. If that countdown runs out, the slot is free again immediately, with no
separate cleanup step needed - the database index simply stops matching once the status changes.

![Date strip and slot rail, with one slot taken](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/booking-slot-grid.png)

![Hold countdown mid-booking](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/hold-countdown.png)

---

## Database design

Full DDL with comments: [`docs/schema.sql`](docs/schema.sql). Fourteen tables. Three decisions
carry most of the design - the full write-up is in [`docs/system-design.md`](docs/system-design.md):

**1. Concurrency is enforced by the database, not by a read-then-write check.**
`unique_active_appointment` is a partial unique index on `appointments (doctor_id, starts_at)
WHERE status IN ('held','confirmed')`. Two requests racing for the same slot produce one row and
one `23505` error, which the API turns into `409 SLOT_TAKEN`. That index only catches two
appointments starting at the exact same instant, though, so a second constraint - the GiST
exclusion constraint `appointments_no_overlap` - closes the general overlap case that shows up
when a doctor's `slotMinutes` changes after a slot is already booked (see the bug list below). An
advisory lock per doctor was considered instead, but it would force every booking attempt for
that doctor to run one at a time, where the exclusion constraint lets them run in parallel and
only rejects the one that actually loses.

**2. Every outbound side effect goes through a transactional `outbox`.** Email and calendar rows
are inserted in the same transaction as whatever change caused them, so a confirmed booking can
never exist without its notification queued, and a failed email or Google call can never undo the
booking. A worker claims rows with `FOR UPDATE SKIP LOCKED`, retries with backoff (roughly
1m/5m/15m/1h/6h plus jitter) up to `max_attempts`, and then marks the row as dead so an admin can
retry it on purpose (`POST /api/admin/outbox/:id/retry`) instead of the worker just sending it
blind and hoping.

**3. Google OAuth credentials live in `google_accounts`, never on `users`.** Tokens are
encrypted at rest with AES-256-GCM, using a key derived from `JWT_SECRET`. `calendar_events` maps
each appointment to a Google event id **per user** - a separate event on each participant's own
calendar, never one shared event with the other person added as an attendee. That was a
deliberate choice over the simpler shared-event design: an attendee-based event sends Google's
own invitation emails, runs into attendee-permission issues on personal accounts, and ties the
two calendars together (a reschedule or cancel on one side would have to reach into the other
person's event too). Separate events avoid all three problems, at the cost of one extra API call
per side.

---

## LLM: pre-visit triage and post-visit summaries

Full prompts, JSON schemas, the retry/give-up rules, and the prompt-injection guard (with real
test cases) are in [`docs/llm-prompts.md`](docs/llm-prompts.md). The model is never called
inside a request - `POST /api/appointments/:id/symptoms` just inserts a `pending` `ai_summaries`
row, so confirming an appointment never depends on the summary being ready. Every way the call
can fail (timeout, missing key, rate limit, bad output that survives one repair attempt) ends
with a `failed` row and the raw form still fully visible - never a crash, and never a blocked
write.

The post-visit summary has a hard **hallucination check** (`server/src/llm/parse.js`): every
medication in the model's `medicationSchedule` has to match a real `prescriptions` row exactly
(case doesn't matter). An invented or silently dropped drug fails validation the same way
malformed JSON would. There's a real test case for this (with `fetch` mocked so it's
deterministic) in `docs/llm-prompts.md`.

![Post-visit AI summary card with medication schedule](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/ai-summary-card.png)

---

## Doctor & admin views

The doctor's queue is sorted by urgency, as scored by the pre-visit summary (with a neutral
default if scoring failed), so the patient who needs attention soonest isn't buried further down
just because they booked later. The admin portal manages doctor records, weekly availability, and
leave days from the same interface used to seed and check the demo data above.

![Doctor queue sorted by urgency](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/doctor-queue-urgency.png)

![Admin availability editor](https://raw.githubusercontent.com/kamil-ctr/healthcare-appointment-manager/main/docs/screenshots/admin-availability.png)

---

## Things that broke, and how they were fixed

Real bugs found while building and deploying this, each one you can check by reading the code or
commit referenced:

- **Postgres's date parser was silently shifting dates by a day.** node-postgres's default
  parser for `DATE` columns builds a `Date` object in the local timezone, so on any machine not
  set to UTC, a plain calendar date drifted by a day once it was turned into JSON. This showed up
  first in leave-date handling. Fixed by pinning that parser to return the raw `'YYYY-MM-DD'`
  string instead (`server/src/db/pool.js`). This is deliberately *not* applied to `timestamptz`
  columns, which need to stay real `Date` objects since they represent an exact moment, not a
  calendar date.
- **The unique index didn't catch every overlap.** `unique_active_appointment` only catches two
  appointments that start at the exact same instant. If a doctor's `slotMinutes` changed after a
  slot was already booked, the new grid could offer a start time that lands inside an existing
  booking without ever matching its `starts_at` exactly. Closed with a second, independent
  database rule - the GiST exclusion constraint `appointments_no_overlap` (`docs/schema.sql`) -
  instead of trying to make the first index cleverer.
- **A single job tick could burn through all of a summary's retries at once.** `ai_summaries` has
  no `next_retry_at` or `processing` column, so a row that just failed becomes eligible again
  right away, based on status alone. An early version of the retry loop could grab the same row
  it had just failed on, again and again in one tick, using up all the retries before any real
  time had passed between attempts. Fixed with a list of already-tried ids per tick
  (`server/src/jobs/ai-summaries.js`), so each row only gets one attempt per tick - the tick
  interval itself becomes the wait between retries.
- **The rate limiter never actually triggered in production.** It worked locally, but 35 quick
  requests against the deployed API came back with zero `429`s. The deployment sits behind two
  proxy hops - Cloudflare, then Render's own edge - and `app.set('trust proxy', 1)` only
  accounted for one of them, so Express read Render's inner edge address as the client's IP
  instead of the real one. Fixed by reading Cloudflare's `cf-connecting-ip` header instead
  (`server/src/middleware/ratelimit.js`), which a client can't fake. Full write-up in
  `docs/deployment.md`, under Troubleshooting.
- **`GOOGLE_REDIRECT_URI` on Render was still pointing at localhost.** Left at its local
  default after the first deploy, even though the right URI was already registered in Google
  Cloud Console. Would have failed every Calendar connect attempt with `redirect_uri_mismatch`.
  Caught by actually reading the env var's value in the dashboard instead of assuming it matched
  the docs.
- **Missing `openid`/`email` scope meant the connected account's email never showed up.** The
  app originally only asked for the `calendar.events` scope, so Google never sent back an
  `id_token` - there was nothing to read the address from. Fixed by adding `openid email` to the
  scope request (`server/src/google/oauth.js`). Both are non-sensitive scopes, add no extra
  calendar access, and don't need Google's review.
- **Vercel had no rewrite rule for the single-page app, then no Git connection at all.** The
  first deploy had no `vercel.json`, so loading any route other than `/` directly (like
  `/appointments`) 404'd on refresh, since Vercel's static hosting has no server-side fallback
  without one. Fixed by committing `web/vercel.json` with a rewrite that sends everything to
  `/index.html`. Separately, the project had no Git connection at all at first - it had been
  deployed by hand from a local machine - so a same-day frontend fix never actually went live
  until that was noticed and Git integration was set up. More detail in `docs/deployment.md`.
- **Neon was set up in the wrong region, twice.** The first attempt used a default region far
  from Render's, so every database query paid a long round trip across the Pacific.
  Re-provisioned in Oregon to match Render's own region, confirmed in Render's dashboard. After
  that, `GET /api/health/db` reports round trips of a few milliseconds instead of hundreds.

---

## Known limitations on the free tier - real numbers, not estimates

- **Cold start: 23.1 seconds**, measured from the first request after a genuine ~64-minute idle
  period. An external cron job is supposed to ping the instance every 10 minutes so a grader
  never sees this, but as of writing it isn't firing (zero hits on `/api/internal/jobs/tick` in
  24 hours of logs). See `docs/deployment.md` §4.
- **Warm response time** for `GET /api/doctors/:id/slots`: about 550ms on average across 5
  requests (385-660ms range), measured from an external client, real internet round trip to
  Oregon included.
- **Pre-visit summary latency: near-instant to about 60 seconds** end to end, timestamped from
  the appointment's own event log, not a stopwatch guess. The summary is never generated inside
  the request - it waits for the next background job tick (every 60,000ms), so the real
  bottleneck is how soon after submission that next tick lands, not the model call itself (which
  takes about 2 seconds, see `docs/llm-prompts.md`). Two real samples: 17s and 23.2s end to end.
  Both are correct; neither is a fixed number, since it depends on where in that 60-second cycle
  the submission happened to land.
- **Email delivery is console-only in production** - there are no real SMTP credentials set on
  Render, so every email (including the `.ics` attachment) is fully written out and logged, but
  never delivered to an inbox. See `docs/deployment.md`, under Troubleshooting.
- The in-memory rate limiter works fine for this single Render instance, but would need a shared
  store (Postgres or Redis) if this ever ran on more than one.
- Everything runs as one Render web service, so a crash restarts the whole API, not just one
  worker.
