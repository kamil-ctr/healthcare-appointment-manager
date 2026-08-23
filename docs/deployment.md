# Deployment

The target stack, all on free tiers, is **Neon** (Postgres) + **Render** (API) + **Vercel**
(frontend), with an external cron job keeping the Render instance warm and driving the
background jobs. This doc is written so someone who has never touched this repo can follow it
from scratch.

**How this deployment actually stands right now** (last checked):

| Piece | Actual value |
|---|---|
| Backend | `https://healthcare-appointment-manager-5olh.onrender.com` (Render, Oregon/US West) |
| Frontend | `https://healthcare-appointment-manager-beta.vercel.app` (Vercel) |
| Database | Neon Postgres 16, **Oregon** region (same region as Render - see §1) |
| Google Cloud project | `healthcare-appointment-manager` (project ID `tidal-vim-506212-q8`), OAuth client `healthcare-appointment-manager-web`, publishing status **In production**, external user type |
| External cron | **Not currently running** - see Troubleshooting. The in-process job timer (`JOB_INTERVAL_MS`) still drives hold-expiry, the outbox, AI summaries, and reminders on its own every 60s whenever the instance is awake. Only the "never sleeps" guarantee needs the external cron specifically |

---

## Services used

| Service | Role | Why this one |
|---|---|---|
| [Neon](https://neon.tech) | Managed PostgreSQL 16 | Generous free tier, the `btree_gist` extension is available (required - see below), and it's serverless so it doesn't bill for idle time |
| [Render](https://render.com) | Node.js web service (the API) | Free web service tier, health-check support, an env var dashboard |
| [Vercel](https://vercel.com) | Static hosting for the Vite build | Free tier, env vars injected at build time, instant redeploys |
| [cron-job.org](https://cron-job.org) (or any free HTTP cron) | Pings `POST /api/internal/jobs/tick` every 10 minutes | Drives hold-expiry/outbox/AI-summaries/reminders and keeps Render's free instance from sleeping |
| Google Cloud Console | OAuth client for Calendar sync | Already set up per `docs/google-calendar-setup.md`; this doc only covers the two production-only additions |

---

## 1. Neon (Postgres)

**What to create:** a Neon project (any name works, e.g. "healthcare-appointment-manager"),
Postgres version 16, in whichever region is closest to Render's (keeping API-to-database latency
low means picking the same region for both). Neon creates one database and one role
automatically - the only setup left on Neon's side is copying the connection string it gives you
(Dashboard → Connection Details → the "Pooled connection" string, which looks like
`postgresql://<user>:<password>@<host>/<db>?sslmode=require`).

**Why Oregon, not Singapore.** Render's free web service tier for this project runs in
**Oregon (US West)**, confirmed in the Render dashboard's Settings → Region field - Render's
free-tier regions are limited, and Oregon is simply what the service was created with. Following
the same-region guidance above, the Neon project was set up in **Oregon** to match, rather than
Singapore, which would add a trans-Pacific round trip (150-250ms or more per query) on top of
whatever latency the client already has to Render. `GET /api/health/db` reports round-trip
latency directly, and on a warm instance it reads consistently 2-3ms (four warm requests in a
row came back at 2.0-2.5ms, right after one cold-start request that also paid the connection
pool's first round trip). That's only possible because both services sit in the same region and
the same cloud provider's network.

**Neon gives you two connection strings - use the right one for the right job.**

| String | Host | Used for |
|---|---|---|
| **Pooled** (`DATABASE_URL`) | contains `-pooler` | The **running app** (Render's `DATABASE_URL` env var, §2) |
| **Direct** (`DATABASE_URL_DIRECT`) | no `-pooler` | **Migration and seeding only** - never given to the running app |

Neon's pooled endpoint runs PgBouncer in **transaction mode**, which doesn't reliably support
session-level operations - `CREATE EXTENSION btree_gist` (and by extension the
`appointments_no_overlap`/`availability_no_overlap` exclusion constraints and the `timerange`
type they depend on) can fail outright, or silently do nothing, through a transaction-mode
pooler, depending on what else is sharing that connection at the time. So the one-off migration
and seed commands run against the **direct** connection, where session state behaves normally.
The long-lived app connection pool (`server/src/db/pool.js`, a normal `pg.Pool` that already does
its own pooling on the application side) runs against the **pooled** one, which is what Neon's
free tier is sized for under real traffic. Keep both connection strings around after the first
migration - a future schema change will need the direct one again.

**Then, from wherever it's safe to paste the direct connection string (never committed - see
`server/.env.production` staying gitignored):**

```bash
cd server
DATABASE_URL="<the DIRECT connection string>" DATABASE_SSL=true npm run migrate:prod

# Seed demo data (see README "Seed data") - also against DIRECT.
DATABASE_URL="<the DIRECT connection string>" DATABASE_SSL=true ALLOW_DEMO_SEED=true node scripts/seed-demo.js
```

**Checked on this deployment's Neon project** (direct connection):

```
btree_gist installed: YES
overlap constraints present: appointments_no_overlap, availability_no_overlap
timerange type present: YES
table count: 14 (expected 14)
```

**If `CREATE EXTENSION btree_gist` fails on Neon,** stop and don't continue with the rest of
deployment. The overlap-prevention exclusion constraints depend on it (see `docs/schema.sql`'s
comments on `appointments_no_overlap`), and there's no fallback that keeps the same guarantee
without it. It didn't fail on this project's free-tier Neon instance (checked above, against the
direct connection specifically, since the pooled connection is exactly where this can go wrong
silently), so this is a "shouldn't happen, but check rather than assume" note, not a known issue.

**Staying idempotent:** `npm run migrate:prod` is safe to run again (every statement in
`docs/schema.sql` starts with `IF NOT EXISTS` or `DROP ... IF EXISTS`). `seed-demo.js` is safe to
run again too - see its header comment; it does nothing once the demo admin user already exists.

**Credential rotation.** Three credentials were briefly exposed during initial setup and later
rotated end to end: the Groq `LLM_API_KEY`, the Neon database password (inside `DATABASE_URL`),
and the Google OAuth `GOOGLE_CLIENT_SECRET`. All three were regenerated at the provider, updated
in Render's environment variables, and the service was redeployed and rechecked (`/api/health`,
`/api/health/db`, and a full `smoke-test.js` run all green against the rotated values) before
moving on. If a credential is ever suspected exposed, the right order is: rotate at the provider
first, then update Render, then redeploy, then verify - never the other way around, since
updating Render with a value that hasn't been rotated yet just moves the same exposed secret
somewhere else.

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

**Environment variables** (every key from `.env.example`, with production values):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TZ` | `UTC` - see the comment in `server/src/config.js` for why |
| `PORT` | Render sets this automatically; don't override it |
| `WEB_ORIGIN` | the Vercel domain - on this deployment, `https://healthcare-appointment-manager-beta.vercel.app` |
| `DATABASE_URL` | the Neon pooled connection string (Oregon project - see §1) |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `10` (or lower - Neon's free tier has a connection cap, see Troubleshooting) |
| `JWT_SECRET` | a fresh random value, **different from the local dev one** - `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_TTL_SECONDS` | `43200` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | only needed if you also run `npm run seed:admin`; `seed-demo.js` creates its own separate demo admin and doesn't need these |
| `SLOT_HOLD_MINUTES` | `10` |
| `LLM_API_KEY` | a real Groq API key (rotated once on this deployment - see §1) |
| `LLM_MODEL` | `openai/gpt-oss-120b` |
| `LLM_TIMEOUT_MS` | `15000` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | real SMTP credentials (a Gmail App Password works, see README) - **not currently set on this deployment**; see Troubleshooting, "Emails going to a console log" |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from the Google Cloud Console client (see §5 below); the secret was rotated once on this deployment - see §1 |
| `GOOGLE_REDIRECT_URI` | `https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback` on this deployment - it was briefly left pointing at the localhost value after the first deploy; see Troubleshooting |
| `JOB_INTERVAL_MS` | `60000` (the in-process timer - this is what actually drives the background jobs on this deployment right now; see the external cron note below) |
| `JOB_TRIGGER_SECRET` | a fresh random value - **required in production**, `config.js` won't boot without it |

**Free-tier cold start:** the instance goes to sleep after about 15 minutes of no inbound HTTP
traffic, and takes roughly 30-60 seconds to wake up for the next request. The external cron in
§4 is meant to double as a keep-warm ping every 10 minutes - see Troubleshooting for why that
isn't actually happening on this deployment yet, and what that means for cold-start numbers in
practice.

---

## 3. Vercel (frontend)

| Setting | Value on this deployment |
|---|---|
| Root directory | `web` - required now that Git integration is connected, since the repo is a monorepo with no build target at its root (see Troubleshooting for why leaving this unset only worked under the earlier CLI-only deploy) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Framework preset | Vite |
| Git integration | Connected to `kamil-ctr/healthcare-appointment-manager` on `main` - every push to `main` triggers an automatic build and deploy. See Troubleshooting for the earlier CLI-only deploy method this replaced, and why it needed every change to be redeployed by hand |

**Environment variable:** `VITE_API_URL` is set to the Render URL, e.g.
`https://healthcare-appointment-manager-5olh.onrender.com`.

**Important - Vite bakes env vars in at build time, not runtime.** Changing `VITE_API_URL` in
the Vercel dashboard does nothing to a deployment that's already built - it only takes effect on
the next build. If the Render URL ever changes (a rename, a new project), update the env var
**and** trigger a redeploy (Vercel dashboard → Deployments → "Redeploy", or push a commit). A
restart alone isn't enough, since there's no running process to restart the way there is on
Render - it's a static build being served.

---

## 4. External cron (cron-job.org)

Create a cron job with:

| Field | Value |
|---|---|
| URL | `https://healthcare-appointment-manager-5olh.onrender.com/api/internal/jobs/tick` |
| Method | `POST` |
| Header | `x-job-secret: <the same value as JOB_TRIGGER_SECRET on Render>` |
| Schedule | every 10 minutes |

This one endpoint runs four jobs per call (hold-expiry sweep, AI summary generation, reminder
queueing, outbox delivery - see the `/internal/jobs/tick` section in `docs/api.md`), and as a
side effect of just being an HTTP request, it also keeps the Render free instance from going
idle. The response is `200` with a JSON summary of what each sub-job did. A non-200 response
(401 for a wrong secret, 503 if the secret isn't configured) is worth alerting on if your cron
provider supports that.

**On this deployment, this cron job is not currently firing** - see Troubleshooting for how that
was confirmed and what it means in practice.

---

## 5. Google Cloud Console (production additions)

Full initial setup is in [`docs/google-calendar-setup.md`](google-calendar-setup.md). This
deployment's actual project: name `healthcare-appointment-manager`, project ID
`tidal-vim-506212-q8`, OAuth client `healthcare-appointment-manager-web` (Web application type),
publishing status **In production**, user type **External**, currently 1 user against a 100-user
cap (that cap only matters for scopes that need Google's review - `calendar.events` isn't one,
so it's not a real constraint here; see `docs/google-calendar-setup.md` §6).

On the **same** OAuth client created in the setup doc, add for production:

1. **Credentials → the OAuth client → Authorized redirect URIs → Add URI:**
   `https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback` - keep the
   existing `http://localhost:4000/api/google/callback` too, so local dev still works.
2. **Authorized JavaScript origins → Add URI:**
   `https://healthcare-appointment-manager-beta.vercel.app` - the frontend origin that starts
   the OAuth redirect.
3. **OAuth consent screen → check that Publishing status is "In production," not "Testing."**
   If it somehow reverted to Testing, every refresh token issued under Testing expires after 7
   days regardless of use (see `docs/google-calendar-setup.md` §4) - republish before demoing.
4. Set `GOOGLE_REDIRECT_URI=https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback`
   on Render (§2 above) to match exactly what was just added. The OAuth exchange fails if these
   two values differ by even a trailing slash - **this exact mismatch happened once on this
   deployment**, see Troubleshooting.

---

## Verifying a deploy

```bash
# From anywhere with internet access, no repo checkout needed beyond this one file:
BASE_URL=https://healthcare-appointment-manager-5olh.onrender.com node server/scripts/smoke-test.js
```

Then the manual browser checks: register, book, confirm; watch the pre-visit summary actually
generate (measured samples on this deployment: 17s and 23.2s from symptom submission to summary
ready, timestamped from the appointment's own event timeline - see README for why this varies
instead of being one fixed number); the confirmation email with its `.ics` attachment (currently
only visible in the Render console log - see Troubleshooting, "Emails going to a console log");
Google Calendar connect completing on the production redirect URI; a doctor submitting notes;
admin leave cascading into an email; a cron tick moving outbox rows to `sent`; and a cold-start
timing (see Troubleshooting for why this deployment's actual cold-start behavior is more
complicated than "should never happen").

---

## Troubleshooting

Every item below, except the two marked "generic, not hit yet," is a real issue this deployment
actually ran into, in the order they were found.

**Rate limiter never triggering in production.** `POST /api/auth/login` allows 30 requests per
IP per rolling 60-second window, and that worked fine locally - but 35 quick requests against
the deployed API came back `401` every time, with zero `429`s, even with a spoofed but
consistent `X-Forwarded-For` header. The cause: this deployment sits behind two proxy hops -
Cloudflare (confirmed by the `server: cloudflare` and `cf-ray` headers on every response), then
Render's own edge - but `app.set('trust proxy', 1)` only accounts for one hop, so Express read
Render's inner edge address as the client's IP instead of the real one, and every request looked
like a different "IP" to the limiter. Fixed by reading Cloudflare's `cf-connecting-ip` header
instead (`server/src/middleware/ratelimit.js`) - Cloudflare sets this to the true client IP at
its edge, and a client can't override it, which is what makes it safe to trust for an app that's
only ever reachable through Cloudflare, like this one. Checked after the fix: exactly 30
successful requests, then `429` with `Retry-After` starting from request 31.

**Security headers and the rate limiter were missing in production despite being "done."** A
full day of hardening work (the rate limiter above, plus `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) existed only in the local working
tree - it had never actually been committed or pushed, so Render had been running the
pre-hardening code the whole time no matter what local testing showed. `curl -I` against the
deployed URL is the only way this becomes visible; running `npm run dev` locally can't catch a
"forgot to push" gap. Committed, pushed, redeployed, and rechecked with `curl -I` showing all
four headers present.

**The external cron isn't actually running.** Searching Render's application logs for
`jobs/tick` over the last 24 hours turns up zero matches - nothing has ever hit
`POST /api/internal/jobs/tick` in that window. Whatever was set up on cron-job.org, if anything
was saved there at all, isn't currently firing. In practice this doesn't break anything: the
**in-process** job timer (`JOB_INTERVAL_MS=60000` in `server/src/jobs/runner.js`) still runs
hold-expiry, the outbox worker, AI summaries, and reminders every 60 seconds on its own,
completely apart from the external cron, as long as the instance stays awake. What the missing
cron actually costs is the "never sleeps" guarantee - without it, a real 15-minute gap in
traffic lets the free instance spin down, and the next request pays the 30-60 second cold-start
cost. Fix: recreate the cron-job.org job from §4 and check its own run history shows successful
`200` ticks, not just that it was set up once.

**Vercel had no Git connection and no Root Directory set.** The frontend had first been deployed
by hand, running `vercel --prod` locally from inside `web/` - which works, but quietly means
every later frontend change needs someone to remember to run that command again. This was caught
when the Vercel dashboard showed the live deployment still pinned to a commit from before a
same-day frontend fix had already been pushed to `main`. Fixed by connecting the project to
`kamil-ctr/healthcare-appointment-manager` on `main` and setting **Root Directory to `web`** (it
had been empty, which only worked for the original CLI deploy because that upload method never
looks at Root Directory at all - a Git-connected build at the repo root would have failed
immediately looking for a root `package.json` that doesn't exist in this monorepo). Frontend
commits now deploy on their own.

**Stale `GOOGLE_REDIRECT_URI` pointed at localhost, in production.** After the first production
deploy, Render's `GOOGLE_REDIRECT_URI` was still `http://localhost:4000/api/google/callback` -
the local-dev default - instead of the production callback URL, even though the right URI was
already registered in Google Cloud Console. This would have failed every Calendar connect
attempt with `redirect_uri_mismatch` (see the general case below) the first time anyone tried it
in production. Caught by actually reading the env var's value in the Render dashboard, instead
of assuming it matched what the setup doc said it should be. Corrected and redeployed.

**`redirect_uri_mismatch` on the Google consent screen (a generic case - not hit yet as a live
incident, but the issue above is exactly this failure mode).** The `GOOGLE_REDIRECT_URI` env var
on Render and the Authorized redirect URI in the Google Cloud Console need to match
**byte-for-byte** - same scheme (`https`), same host, no difference in trailing slash. Copy and
paste one into the other rather than retyping either.

**Missing `openid`/`email` scope meant the connected Google account's email never showed up.**
The app originally only asked for the `calendar.events` scope, which means Google never sends
back an `id_token` in the token exchange response - so the UI's "Connected as ..." line showed a
blank email, since there was nothing to decode it from. Fixed by adding `openid email` to the
scope request (`server/src/google/oauth.js`) - both are non-sensitive Google scopes, add no
extra calendar access, and don't trigger a verification requirement the way `calendar.events`
can. Connections made before this fix still show a blank email until the user disconnects and
reconnects (which re-runs the OAuth exchange under the new scope); new connections get the email
right away.

**CORS failures in the browser console (a generic case - not hit yet on this deployment).**
`WEB_ORIGIN` on Render needs to equal the Vercel domain **exactly**, including `https://` and
with no trailing slash - `middleware/core.js`'s `cors()` only ever echoes back an origin from
`config.webOrigins`, an exact-match list, never a wildcard. If the Vercel project also has a
custom domain besides the `*.vercel.app` one, both need to be in `WEB_ORIGIN` (comma-separated -
see `config.js`'s `webOrigins` parsing).

**A brief Neon connection timeout right at a deploy restart.** Render's logs show two
`Error: Connection terminated due to connection timeout` entries on `GET /api/doctors` and
`GET /api/appointments`, both within the same second, right after a deploy went live. Hasn't
happened again since, and lines up with the app's own connection pool needing its first round
trip to Neon's pooled endpoint right as a fresh process starts. Worth knowing about if a
grader's very first request after a redeploy comes back as a 500 - it's very likely this, and
the next request should succeed.

**Cold starts, revisited.** The original plan ("the external cron keeps it warm, so a grader
should never see a cold start") doesn't currently hold, because the cron isn't running (see
above). Whether the instance happens to be cold at any given moment now depends entirely on how
recently any request landed, including a grader's own earlier page load. See README's "Known
limitations" section for the actual measured cold-start number on this deployment, taken after a
genuine idle period with no external cron running.

**Neon connection limits.** Neon's free tier caps how many concurrent connections it allows
(this varies by plan, but is commonly around 100 on the pooled endpoint and much lower on the
direct one). Make sure `DATABASE_URL` uses the **pooled** connection string (Neon's dashboard
labels it clearly, and the host usually contains `-pooler`) rather than the direct one, and keep
`DATABASE_POOL_MAX` reasonable (10, the current default) - a single Render free instance at
`max: 10` sits well inside any Neon free-tier cap. The thing to actually watch for is
`DATABASE_POOL_MAX` set too high across several services sharing the same database, not this app
on its own.

**Emails going to a console log instead of an inbox in production.** `server/src/mail/
transport.js` falls back to a console transport whenever `SMTP_HOST`/`SMTP_USER` are blank -
and that's the real state of this deployment right now, not just a local fallback: there are no
real SMTP credentials set on Render, so every confirmation, cancellation, and reminder email
(including the `.ics` attachment) is fully written out and logged, but never delivered to a real
inbox. Checked by reading the rendered email content straight out of Render's application logs
(`[mail:console] ...`). Set real SMTP credentials on Render (§2) if email delivery needs to show
up in an actual inbox, rather than just being correct and readable in the logs.
