# Google Calendar setup (Day 7)

How to provision a Google OAuth client for this app, and why the publishing status has to
be **In production** rather than **Testing**.

---

## 1. Create a project

[console.cloud.google.com](https://console.cloud.google.com) → project picker (top left) →
**New Project** → any name (e.g. "Healthcare Appointment Manager") → Create.

## 2. Enable the Calendar API

"APIs & Services" → "Library" → search **Google Calendar API** → **Enable**.

## 3. Configure the OAuth consent screen

"APIs & Services" → "OAuth consent screen".

- User type: **External** → Create.
- App name / support email / developer contact: anything reachable by you.
- Save through Scopes and Test users without adding anything (the app requests its one
  scope at runtime, not here) to the summary page.

## 4. Publishing status — read this before clicking anything

On the consent screen summary, click **"Publish app"** to move it from **Testing** to
**In production**.

**Why this matters more than it looks like it should:** while an OAuth app's publishing
status is *Testing*, Google unconditionally expires every refresh token after **7 days**,
regardless of use. For a submission or a hackathon demo judged weeks after the code is
written, that means the calendar integration would already be dead by demo day - every
`google_accounts` row's refresh token invalid, every calendar sync silently failing with
`invalid_grant`, and no code bug to explain it.

In **In production** with an app that hasn't gone through Google's verification review
(this app only requests `calendar.events`, a narrow, non-sensitive scope, so verification
isn't worth pursuing for this scope), refresh tokens persist normally - the only visible
cost is that every user sees Google's **"unverified app"** interstitial on first consent
and has to click **"Advanced" → "Go to \<app name> (unsafe)"** to proceed. That's a one-time
click per user, not a functional limitation. Accept it; publish to production.

## 5. Create the OAuth client

"APIs & Services" → "Credentials" → **+ Create Credentials** → **OAuth client ID**.

- Application type: **Web application**.
- Authorized redirect URIs → **Add URI**:
  - Local dev: `http://localhost:4000/api/google/callback`
  - Deployed: `https://<your-backend-domain>/api/google/callback` (add this once you have
    a deployed backend URL; the redirect URI must match exactly what `GOOGLE_REDIRECT_URI`
    is set to in that environment)
- Create. Copy the **Client ID** and **Client Secret** shown in the dialog.

## 6. Scope

The app requests exactly one scope, at runtime (`server/src/google/oauth.js`), nowhere
configured in the Console:

```
https://www.googleapis.com/auth/calendar.events
```

Not the broader `calendar` or `calendar.readonly` scopes - `calendar.events` is the minimum
that allows creating, updating, and deleting events, and nothing else (no access to the
user's existing calendars, free/busy data, or calendar list).

## 7. Where each value goes

In `server/.env`:

```
GOOGLE_CLIENT_ID=<the Client ID from step 5>
GOOGLE_CLIENT_SECRET=<the Client Secret from step 5>
GOOGLE_REDIRECT_URI=http://localhost:4000/api/google/callback   # or your deployed URL
```

If any of these three is unset, `GET /api/google/connect` responds `503
SERVICE_UNAVAILABLE` rather than building a broken authorization URL - the rest of the app
(booking, confirming, cancelling, rescheduling) works identically either way. See
[Google Calendar: optional by design](#google-calendar-optional-by-design) below.

## Token storage

`access_token` and `refresh_token` are encrypted at rest with AES-256-GCM
(`server/src/google/crypto.js`) before they ever reach `google_accounts` - a key derived
from `JWT_SECRET` via `scrypt`, no second secret to provision. Stored as
`iv:tag:ciphertext`; decrypted only at the point of use (a token refresh, or a Calendar API
call from the outbox worker), never logged, never returned to a client.

## Google Calendar: optional by design

Nothing in the booking/confirm/cancel/reschedule request path calls Google - those routes
only ever write `calendar`-topic `outbox` rows, exactly like the `email`-topic rows they've
written since Day 6. The actual Google API calls happen only in the background worker
(`server/src/jobs/outbox.js`), on the same tick as email delivery. A user who never
connects Google, or a deployment with no `GOOGLE_CLIENT_ID` configured at all, still gets
a fully working appointment flow - the `calendar`-topic rows for that user simply
dead-letter immediately with `last_error = 'google_not_connected'` instead of retrying five
times, and nothing else in the system notices or cares.
