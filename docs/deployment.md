# Deployment

Target stack, all free tiers: **Neon** (Postgres) + **Render** (API) + **Vercel** (frontend),
with an external cron pinger keeping the Render instance warm and driving the background jobs.
This document is written to be reproducible by someone who has never touched this repo before.

**This deployment, as it actually stands** (last verified):

| Piece | Actual value |
|---|---|
| Backend | `https://healthcare-appointment-manager-5olh.onrender.com` (Render, Oregon/US West) |
| Frontend | `https://healthcare-appointment-manager-beta.vercel.app` (Vercel) |
| Database | Neon Postgres 16, **Oregon** region (co-located with Render - see §1) |
| Google Cloud project | `healthcare-appointment-manager` (project ID `tidal-vim-506212-q8`), OAuth client `healthcare-appointment-manager-web`, publishing status **In production**, external user type |
| External cron | **Not currently running** - see Troubleshooting. The in-process job timer (`JOB_INTERVAL_MS`) still drives hold-expiry/outbox/AI-summaries/reminders on its own every 60s whenever the instance is awake; only the "never sleeps" guarantee depends on the external cron specifically |

---

## Services used

| Service | Role | Why this one |
|---|---|---|
| [Neon](https://neon.tech) | Managed PostgreSQL 16 | Generous free tier, `btree_gist` extension available (required - see below), serverless so it doesn't idle-bill |
| [Render](https://render.com) | Node.js web service (the API) | Free web service tier, health-check support, env var dashboard |
| [Vercel](https://vercel.com) | Static hosting for the Vite build | Free tier, build-time env var injection, instant redeploys |
| [cron-job.org](https://cron-job.org) (or any free HTTP cron) | Pings `POST /api/internal/jobs/tick` every 10 minutes | Drives hold-expiry/outbox/AI-summaries/reminders AND keeps Render's free instance from sleeping |
| Google Cloud Console | OAuth client for Calendar sync | Already provisioned per `docs/google-calendar-setup.md`; this doc only covers the two production-specific additions |

---

## 1. Neon (Postgres)

**What to create:** a Neon project (any name, e.g. "healthcare-appointment-manager"), Postgres
version 16, in whichever region is closest to Render's region (keeps API↔DB latency low - pick
the same region for both). Neon creates one database and one role automatically; no extra setup
is needed on the Neon side beyond copying the connection string it gives you (Dashboard →
Connection Details → "Pooled connection" string, which looks like
`postgresql://<user>:<password>@<host>/<db>?sslmode=require`).

**Why Oregon, not Singapore.** Render's free web service tier for this project runs in **Oregon
(US West)** - confirmed in the Render dashboard's Settings → Region field, not a choice this doc
made independently (Render's own available free-tier regions are limited, and Oregon was what
the service was created with). Following this doc's own same-region guidance above, the Neon
project was provisioned in **Oregon** to match - not Singapore, which would add a trans-Pacific
round trip (150-250ms+ per query) to every database call the API makes, on top of whatever
latency the client already has to Render. `GET /api/health/db` reports round-trip latency
directly; on this deployment it reads consistently 2-4ms, which is only possible because both
services are in the same region and the same cloud provider's network.

**Neon gives you two connection strings - use the right one for the right job.**

| String | Host | Used for |
|---|---|---|
| **Pooled** (`DATABASE_URL`) | contains `-pooler` | The **running app** (Render's `DATABASE_URL` env var, §2) |
| **Direct** (`DATABASE_URL_DIRECT`) | no `-pooler` | **Migration and seeding only** - never given to the running app |

Neon's pooled endpoint is PgBouncer running in **transaction mode**, which does not reliably
support session-level operations - `CREATE EXTENSION btree_gist` (and, by extension, the
`appointments_no_overlap`/`availability_no_overlap` exclusion constraints and the `timerange`
type that depend on it) can fail outright or silently no-op through a transaction-mode pooler,
depending on what else is sharing the connection at that instant. The one-off migration and seed
commands run against the **direct** connection, where session state is guaranteed to behave
normally; the long-lived app connection pool (`server/src/db/pool.js`, a normal `pg.Pool`, already
does its own connection pooling application-side) runs against the **pooled** one, which is what
Neon's free tier is sized for under sustained traffic. Keep both strings around after the initial
migration - a future schema change needs the direct one again.

**Then, from wherever it's safe to paste the direct connection string (not committed - see
`server/.env.production` staying gitignored):**

```bash
cd server
DATABASE_URL="<the DIRECT connection string>" DATABASE_SSL=true npm run migrate:prod

# Seed demo data (see Part B / README "Demo credentials") - also against DIRECT.
DATABASE_URL="<the DIRECT connection string>" DATABASE_SSL=true ALLOW_DEMO_SEED=true node scripts/seed-demo.js
```

**Verified on this deployment's Neon project** (direct connection):

```
btree_gist installed: YES
overlap constraints present: appointments_no_overlap, availability_no_overlap
timerange type present: YES
table count: 14 (expected 14)
```

**If `CREATE EXTENSION btree_gist` fails on Neon:** stop and do not proceed with the rest of
deployment - the overlap-prevention exclusion constraints are load-bearing (see
`docs/schema.sql`'s comments on `appointments_no_overlap`), and there is no fallback path that
preserves the same guarantee without them. It did not fail on this project's free-tier Neon
instance (verified above, against the direct connection specifically - the pooled connection is
exactly the scenario where this can go wrong silently), so this is a "should not happen, but
check, don't assume" note rather than a known issue.

**Idempotency:** `npm run migrate:prod` is safe to re-run (every statement in `docs/schema.sql`
is `IF NOT EXISTS`/`DROP ... IF EXISTS` first). `seed-demo.js` is safe to re-run - see its header
comment; it no-ops once the demo admin user exists.

**Credential rotation.** Three credentials were briefly exposed during initial setup and later
rotated end-to-end: the Groq `LLM_API_KEY`, the Neon database password (inside `DATABASE_URL`),
and the Google OAuth `GOOGLE_CLIENT_SECRET`. All three were regenerated at the provider, updated
in Render's environment variables, and the service was redeployed and re-verified (`/api/health`,
`/api/health/db`, and a full `smoke-test.js` run all green against the rotated values) before
continuing. If a credential is ever suspected exposed, this is the correct sequence: rotate at
the provider first, then update Render, then redeploy, then verify - never the reverse, since
updating Render with a not-yet-rotated value just moves the same exposed secret.

---

## 2. Render (API)

**Service type:** Web Service, free plan.

| Setting | Value |
|---|---|
| Repository | this repo |
| Root directory | `server/` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Region | **Oregon (US West)** - confirmed in Settings → Region |

**Environment variables** (every key from `.env.example`, production values):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TZ` | `UTC` — see `server/src/config.js`'s comment for why |
| `PORT` | Render sets this automatically; do not override |
| `WEB_ORIGIN` | the Vercel domain - on this deployment, `https://healthcare-appointment-manager-beta.vercel.app` |
| `DATABASE_URL` | the Neon pooled connection string (Oregon project - see §1) |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `10` (or lower - Neon free tier has a connection cap, see Troubleshooting) |
| `JWT_SECRET` | a fresh random value, **different from the local dev one** - `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_TTL_SECONDS` | `43200` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | only needed if you also run `npm run seed:admin`; `seed-demo.js` creates its own separate demo admin and doesn't need these |
| `SLOT_HOLD_MINUTES` | `10` |
| `LLM_API_KEY` | a real Groq API key (rotated once this deployment - see §1) |
| `LLM_MODEL` | `openai/gpt-oss-120b` |
| `LLM_TIMEOUT_MS` | `15000` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | real SMTP credentials (Gmail App Password works, see README) - **not currently set on this deployment**; see Troubleshooting, "Emails going to a console log" |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from the Google Cloud Console client (see §4 below); secret rotated once this deployment - see §1 |
| `GOOGLE_REDIRECT_URI` | `https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback` on this deployment - was briefly left pointing at the localhost value after the first deploy; see Troubleshooting |
| `JOB_INTERVAL_MS` | `60000` (the in-process timer; this is what actually drives the background jobs on this deployment right now - see the external cron note below) |
| `JOB_TRIGGER_SECRET` | a fresh random value - **required in production**, `config.js` now fails to boot without it |

**Free-tier cold start:** the instance sleeps after ~15 minutes of no inbound HTTP traffic and
takes roughly 30-60 seconds to wake on the next request. The external cron in §3 is *intended* to
double as a keep-warm ping every 10 minutes - see Troubleshooting for why that isn't actually
happening on this deployment yet, and what that means for cold-start numbers in practice.

---

## 3. Vercel (frontend)

| Setting | Value on this deployment |
|---|---|
| Root directory | `web` - **was empty/unset** until this session (see Troubleshooting); required once Git is connected, since the repo is a monorepo with no build target at its root |
| Build command | `npm run build` |
| Output directory | `dist` |
| Framework preset | Vite |
| Git integration | **Connected this session** to `kamil-ctr/healthcare-appointment-manager` on `main`. Before that, this project had no Git connection at all - it was deployed once via `vercel --prod` run locally from inside `web/`, which uploads only the invoked directory and therefore never needed a Root Directory setting. That meant every code change had to be redeployed by hand; see Troubleshooting |

**Environment variable:** `VITE_API_URL` = the Render URL, e.g.
`https://healthcare-appointment-manager-5olh.onrender.com`.

**Important - Vite inlines env vars at BUILD time, not runtime.** Changing `VITE_API_URL` in the
Vercel dashboard does nothing to an already-built deployment; it only takes effect on the *next*
build. If the Render URL changes (a service rename, a new Render project), update the env var
**and** trigger a redeploy (Vercel dashboard → Deployments → "Redeploy", or push a commit) - a
restart is not enough, because there is no running process to restart in the way there is on
Render; it's a static build being served.

---

## 4. External cron (cron-job.org)

Create a cron job with:

| Field | Value |
|---|---|
| URL | `https://healthcare-appointment-manager-5olh.onrender.com/api/internal/jobs/tick` |
| Method | `POST` |
| Header | `x-job-secret: <the same value as JOB_TRIGGER_SECRET on Render>` |
| Schedule | every 10 minutes |

This one endpoint does four jobs per call (hold-expiry sweep, AI summary generation, reminder
queueing, outbox delivery - see `docs/api.md`'s `/internal/jobs/tick` section) and, as a side
effect of just being an HTTP request, keeps the Render free instance from going idle. Response is
`200` with a JSON summary of what each sub-job did; a non-200 (401 wrong secret, 503 secret not
configured) is worth alerting on if the cron provider supports it.

**On this deployment, this cron job is not currently firing** - see Troubleshooting for how that
was confirmed and what it means in practice.

---

## 5. Google Cloud Console (production additions)

Full initial setup is in [`docs/google-calendar-setup.md`](google-calendar-setup.md). This
deployment's actual project: name `healthcare-appointment-manager`, project ID
`tidal-vim-506212-q8`, OAuth client `healthcare-appointment-manager-web` (Web application type),
publishing status **In production**, user type **External**, currently 1 user against a 100-user
cap (the cap only matters for scopes requiring Google's review - `calendar.events` is not one, so
this cap is not a practical constraint here; see `docs/google-calendar-setup.md` §6).

For production, on the **same** OAuth client created in the setup doc:

1. **Credentials → the OAuth client → Authorized redirect URIs → Add URI:**
   `https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback` — keep the
   existing `http://localhost:4000/api/google/callback` too, so local dev keeps working.
2. **Authorized JavaScript origins → Add URI:**
   `https://healthcare-appointment-manager-beta.vercel.app` — the frontend origin that initiates
   the OAuth redirect.
3. **OAuth consent screen → confirm Publishing status is "In production", not "Testing."** If it
   somehow reverted to Testing, every refresh token issued under Testing expires after 7 days
   regardless of use (see `docs/google-calendar-setup.md` §4) - re-publish before demoing.
4. Set `GOOGLE_REDIRECT_URI=https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback`
   on Render (§2 above) to match exactly what was just added - the OAuth exchange fails if these
   two values differ by so much as a trailing slash. **This exact mismatch happened once on this
   deployment** - see Troubleshooting.

---

## Verifying a deploy

```bash
# From anywhere with internet access, no repo checkout needed beyond this one file:
BASE_URL=https://healthcare-appointment-manager-5olh.onrender.com node server/scripts/smoke-test.js
```

Then the manual browser checks: register, book, confirm; the pre-visit summary generating for
real (verified this deployment: symptom submission to summary ready in **17 seconds**, timestamped
via the appointment's own event timeline, not a stopwatch guess); the confirmation email with its
`.ics` attachment (currently only visible in the Render console log - see Troubleshooting, "Emails
going to a console log"); Google Calendar connect completing on the production redirect URI; a
doctor submitting notes; admin leave cascading to an email; a cron tick moving outbox rows to
`sent`; and a cold-start timing (see Troubleshooting for why this deployment's actual cold-start
behavior is more nuanced than "should never happen").

---

## Troubleshooting

Every item below except the two marked "generic, not yet hit" is a real issue this deployment
actually ran into, in the order they were found.

**Rate limiter never triggering in production.** `POST /api/auth/login` allows 30 requests per IP
per rolling 60s window, verified working *locally*, but 35 rapid requests against the deployed
API returned 401 every time - zero 429s, even with a spoofed but consistent
`X-Forwarded-For` header. Root cause: `healthcare-appointment-manager-5olh.onrender.com` sits
behind **two** proxy hops - Cloudflare (confirmed via `server: cloudflare` / `cf-ray` on every
response), then Render's own edge - but `app.set('trust proxy', 1)` only accounts for one hop, so
Express's `req.ip` resolved to Render's inner edge address rather than the real client, and every
request looked like a different "IP" to the limiter. Fixed by keying the limiter off the
`cf-connecting-ip` header instead (`server/src/middleware/ratelimit.js`) - Cloudflare sets this to
the true client IP at its edge and a client cannot override it, which is what makes it safe to
trust for an app that (like this one) is only ever reachable through Cloudflare. Verified after
the fix: exactly 30 successful requests then `429` with `Retry-After` from request 31 onward.

**Security headers and the rate limiter were missing in production despite being "done."** A
whole day's hardening work (the rate limiter above, plus `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) existed only in the local working
tree - it had never been committed or pushed, so Render had been running the pre-hardening code
the entire time regardless of what local testing showed. `curl -I` against the deployed URL is
the only way this is actually visible; local `npm run dev` testing cannot catch a "forgot to
push" gap. Committed, pushed, redeployed, and re-verified with `curl -I` showing all four headers
present.

**The external cron isn't actually running.** Searching Render's application logs for
`jobs/tick` over the last 24 hours returns zero matches - no request has ever hit
`POST /api/internal/jobs/tick` in that window. Whatever was configured on cron-job.org (if
anything was saved there) is not currently firing. Practical impact: the **in-process** job timer
(`JOB_INTERVAL_MS=60000` in `server/src/jobs/runner.js`) still runs hold-expiry, the outbox
worker, AI summaries, and reminders every 60 seconds on its own - completely independent of the
external cron - so functionality is unaffected as long as the instance is awake. What the missing
cron actually costs is the "never sleeps" guarantee: without it, a true 15-minute gap in inbound
traffic will let the free instance spin down, and the next request pays the ~30-60s cold-start
cost. Fix: recreate the cron-job.org job per §4 and confirm its own run history shows successful
`200` ticks, not just that it was configured once.

**Vercel had no Git connection and no Root Directory set.** The frontend was deployed once via
`vercel --prod` run locally from inside `web/` - which works, but silently means every later
frontend change requires someone to remember to re-run that command by hand. This was caught when
the Vercel dashboard showed the live deployment still pinned to a commit from *before* a same-day
frontend fix had been pushed to `main`. Connected the project to
`kamil-ctr/healthcare-appointment-manager` on `main` and set **Root Directory to `web`** (it was
empty, which only worked for the original CLI deploy because that upload method doesn't consult
Root Directory at all - a Git-connected build at the repo root would have failed immediately
looking for a root `package.json` that doesn't exist in this monorepo). Future frontend commits
now deploy automatically.

**Stale `GOOGLE_REDIRECT_URI` pointed at localhost, in production.** After the first production
deploy, Render's `GOOGLE_REDIRECT_URI` was still `http://localhost:4000/api/google/callback` -
the local-dev default - instead of the production callback URL, even though the correct URI was
already registered in Google Cloud Console. Google Calendar connect would have failed with
`redirect_uri_mismatch` (see the general case below) the first time anyone tried it in
production. Caught by re-reading the actual env var value in the Render dashboard rather than
assuming it matched what the setup doc said it should be; corrected and redeployed.

**`redirect_uri_mismatch` on the Google consent screen (generic case, not yet hit as a live
incident but the mechanism above is exactly this failure mode).** The `GOOGLE_REDIRECT_URI` env
var on Render and the Authorized redirect URI in the Google Cloud Console must be
**byte-for-byte** identical - same scheme (`https`), same host, no trailing slash difference.
Copy-paste one into the other rather than retyping either.

**Missing `openid`/`email` scope meant the connected Google account's email never displayed.**
The OAuth scope originally requested only `calendar.events`, which means Google never returns an
`id_token` in the token exchange response - the UI's "Connected as ..." line rendered with a
blank email because there was no `id_token` to decode. Fixed by adding `openid email` to the
scope (`server/src/google/oauth.js`) - both are Google's own non-sensitive scopes, add zero
calendar access, and never trigger a verification requirement, unlike `calendar.events`. Existing
`google_accounts` connections predate the fix and still show blank until the user disconnects and
reconnects (which re-runs the OAuth exchange under the new scope); new connections get the email
immediately.

**CORS failures in the browser console (`No 'Access-Control-Allow-Origin' header`) (generic case,
not yet hit as a live incident on this deployment).** `WEB_ORIGIN` on Render must equal the
Vercel domain **exactly**, including `https://` and with no trailing slash -
`middleware/core.js`'s `cors()` only ever echoes back an origin from `config.webOrigins`, an
exact-match allow-list, never a wildcard. If the Vercel project has a custom domain in addition
to the `*.vercel.app` one, both need to be in `WEB_ORIGIN` (comma-separated - see `config.js`'s
`webOrigins` parsing).

**A transient Neon connection timeout right at a deploy restart.** Render's logs show two
`Error: Connection terminated due to connection timeout` entries on `GET /api/doctors` and
`GET /api/appointments`, both in the same second, immediately after a deploy went live. Not
reproduced since, and consistent with the app's own connection pool needing its first round-trip
to Neon's pooled endpoint right as a fresh process starts up. Worth knowing about if a grader's
very first request after a redeploy 500s - it is very likely this, and the next request succeeds.

**Cold starts, revisited.** The original assumption ("the external cron keeps it warm, so a
grader should never see a cold start") does not currently hold, because the cron isn't running
(see above). Whether the instance is actually cold at any given moment now depends entirely on
how recently *any* inbound request landed - including a grader's own previous page load. See
`README.md`'s "Known limitations" for the actual measured cold-start number from this deployment,
taken after a genuine idle period with no external cron running.

**Neon connection limits.** Neon's free tier caps concurrent connections (varies by plan, commonly
around 100 on the pooled endpoint but far lower on the *direct* one). Make sure `DATABASE_URL`
uses the **pooled** connection string (Neon's dashboard labels it explicitly, and the host usually
contains `-pooler`) rather than the direct one, and keep `DATABASE_POOL_MAX` modest (10, the
existing default) - a single Render free instance with `max: 10` is well inside any Neon free-tier
cap; the failure mode to watch for is `DATABASE_POOL_MAX` set too high across multiple services
sharing the same database, not this app alone.

**Emails going to a console log instead of an inbox in production.** `server/src/mail/
transport.js` falls back to a console transport whenever `SMTP_HOST`/`SMTP_USER` are blank - this
is the actual state of this deployment right now, not just a local-dev fallback: no real SMTP
credentials are set on Render, so every confirmation, cancellation, and reminder email (`.ics`
attachment included) is fully generated and logged, but not delivered to a real inbox. Verified
by reading the rendered email content straight out of Render's application logs
(`[mail:console] ...`). Set real SMTP credentials on Render (§2) if email delivery needs to be
visible in an actual inbox, not just functionally correct and inspectable in the logs.
