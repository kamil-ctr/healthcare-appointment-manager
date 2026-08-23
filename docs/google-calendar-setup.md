# Google Calendar setup

How to set up a Google OAuth client for this app, and why the publishing status has to be
**In production** rather than **Testing**.

**Already set up and checked for this deployment.** The steps below were followed against a
real Google Cloud project and OAuth client, created directly in the Console (not by this
codebase or any script). Current state:

- Publishing status: **In production** (not Testing - see §4 for why that matters).
- Authorized redirect URIs registered on the OAuth client: `http://localhost:4000/api/google/callback`
  (local dev) and `https://healthcare-appointment-manager-5olh.onrender.com/api/google/callback`
  (Render). `GOOGLE_REDIRECT_URI` is set to the matching value in each environment (`server/.env`
  locally, a Render environment variable in production) - see §7.
- Authorized JavaScript origin: `https://healthcare-appointment-manager-beta.vercel.app` (Vercel).
- The full connect flow has been checked in a real browser against the production deployment:
  connecting as both a patient and a doctor (same scopes, separate `google_accounts` rows),
  confirming an appointment creates one event on each side's own calendar (never a shared
  invite), and cancelling removes both events. The "unverified app" screen (§4) shows up as
  expected and is just a one-time click, not a blocker.

---

## 1. Create a project

[console.cloud.google.com](https://console.cloud.google.com) → project picker (top left) →
**New Project** → any name (e.g. "Healthcare Appointment Manager") → Create.

## 2. Enable the Calendar API

"APIs & Services" → "Library" → search **Google Calendar API** → **Enable**.

## 3. Configure the OAuth consent screen

"APIs & Services" → "OAuth consent screen".

- User type: **External** → Create.
- App name / support email / developer contact: anything you can actually reach.
- Save through Scopes and Test users without adding anything there (the app asks for its scopes
  at runtime instead - see §6) until you reach the summary page.

## 4. Publishing status - read this before clicking anything

On the consent screen summary, click **"Publish app"** to move it from **Testing** to
**In production**.

**Why this matters more than it looks like it should.** While an OAuth app's publishing status
is *Testing*, Google expires every refresh token after **7 days**, no matter how often it's
used. For a submission or a demo judged weeks after the code was written, that means the
calendar integration would already be dead by demo day - every `google_accounts` row's refresh
token invalid, every calendar sync silently failing with `invalid_grant`, and nothing in the code
to explain why.

Once the app is **In production**, and it hasn't gone through Google's full verification review
(this app's only scope that would need review is `calendar.events`, and it's narrow and
low-risk enough that going through review isn't worth it - `openid`/`email`, see §6, never need
it either), refresh tokens keep working normally. The only real cost is that every user sees
Google's **"unverified app"** warning the first time they consent, and has to click
**"Advanced" → "Go to \<app name> (unsafe)"** to continue. That's a one-time click per user, not
a real limitation. Accept it, and publish to production.

## 5. Create the OAuth client

"APIs & Services" → "Credentials" → **+ Create Credentials** → **OAuth client ID**.

- Application type: **Web application**.
- Authorized redirect URIs → **Add URI**:
  - Local dev: `http://localhost:4000/api/google/callback`
  - Deployed: `https://<your-backend-domain>/api/google/callback` (add this once you have a
    deployed backend URL; the redirect URI has to match exactly what `GOOGLE_REDIRECT_URI` is
    set to in that environment)
- Create. Copy the **Client ID** and **Client Secret** shown in the dialog.

## 6. Scope

The app asks for three scopes, at runtime (`server/src/google/oauth.js`), nowhere configured in
the Console:

```
https://www.googleapis.com/auth/calendar.events openid email
```

`calendar.events` is the only scope that actually touches calendar data - not the broader
`calendar` or `calendar.readonly` scopes, since `calendar.events` is the minimum needed to
create, update, and delete events, and nothing more (no access to the user's existing calendars,
free/busy data, or calendar list). `openid` and `email` add no calendar access at all - they're
what makes Google return an `id_token` in the token exchange, which is the only way to show the
connected address in the UI ("Connected as ..."). Both are Google's own non-sensitive scopes, so
unlike `calendar.events`, adding them never triggers a verification review or changes anything
else in this setup.

## 7. Where each value goes

In `server/.env`:

```
GOOGLE_CLIENT_ID=<the Client ID from step 5>
GOOGLE_CLIENT_SECRET=<the Client Secret from step 5>
GOOGLE_REDIRECT_URI=http://localhost:4000/api/google/callback   # or your deployed URL
```

If any of these three is missing, `GET /api/google/connect` returns `503
SERVICE_UNAVAILABLE` instead of building a broken authorization URL - everything else in the app
(booking, confirming, cancelling, rescheduling) works exactly the same either way. See
[Google Calendar: optional by design](#google-calendar-optional-by-design) below.

## Token storage

`access_token` and `refresh_token` are encrypted at rest with AES-256-GCM
(`server/src/google/crypto.js`) before they ever reach `google_accounts` - the key is derived
from `JWT_SECRET` through `scrypt`, so there's no second secret to set up. They're stored as
`iv:tag:ciphertext`, and only decrypted at the point of use (a token refresh, or a Calendar API
call from the outbox worker) - never logged, never sent back to a client.

## Google Calendar: optional by design

Nothing in the booking/confirm/cancel/reschedule request path calls Google directly - those
routes only ever write `calendar`-topic `outbox` rows, the same way the `email`-topic rows
already work. The actual Google API calls only happen in the background worker
(`server/src/jobs/outbox.js`), on the same tick as email delivery. So a user who never connects
Google, or a deployment with no `GOOGLE_CLIENT_ID` set at all, still gets a fully working
appointment flow - the `calendar`-topic rows for that user just dead-letter right away with
`last_error = 'google_not_connected'` instead of retrying five times, and nothing else in the
system notices or cares.
