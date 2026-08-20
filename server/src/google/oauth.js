/**
 * Google OAuth 2.0 authorization-code flow, native fetch only.
 *
 * `/connect` is called by the SPA as a normal authenticated fetch (it needs
 * the Bearer token, which a plain browser navigation can't carry) and
 * returns the Google consent URL as JSON; the frontend then does
 * `window.location.href = url` for the actual full-page navigation to
 * Google. `/callback` is that navigation's landing point - it is hit
 * directly by Google's redirect with no Authorization header at all, so
 * the signed `state` parameter (not a JWT) is what proves which of our
 * users this authorization belongs to.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { unavailable } from '../lib/errors.js';
import { encryptToken, decryptToken } from './crypto.js';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input) {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

/**
 * HMAC-signed state binding the user id and issue time - the same
 * createHmac/timingSafeEqual primitives lib/jwt.js uses, applied to a state
 * value rather than a login session (different payload shape, a relative
 * TTL check instead of an absolute exp claim). An unauthenticated state
 * parameter here would be a CSRF hole: anyone could send a victim a
 * connect link that binds the victim's Google Calendar to the attacker's
 * account by forging state = { userId: attacker }.
 */
function createState(userId) {
  const payload = base64url(JSON.stringify({ userId, ts: Date.now() }));
  const signature = base64url(createHmac('sha256', config.auth.jwtSecret).update(payload).digest());
  return `${payload}.${signature}`;
}

function verifyState(state) {
  if (typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = createHmac('sha256', config.auth.jwtSecret).update(payload).digest();
  const actual = base64urlDecode(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let parsed;
  try {
    parsed = JSON.parse(base64urlDecode(payload).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed.userId !== 'string' || typeof parsed.ts !== 'number') return null;
  if (Date.now() - parsed.ts > STATE_TTL_MS) return null;
  return parsed.userId;
}

function requireGoogleConfigured() {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw unavailable('Google Calendar integration is not configured on this deployment.');
  }
}

function frontendUrl(path) {
  const base = config.webOrigins[0] || 'http://localhost:5173';
  return `${base}${path}`;
}

export function buildConnectUrl(userId) {
  requireGoogleConfigured();
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    // Both required together: without access_type=offline Google never
    // issues a refresh_token, and without prompt=consent it silently omits
    // the refresh_token on any authorization after the first (the exact
    // failure mode that would kill this integration the first time an
    // access token expires).
    access_type: 'offline',
    prompt: 'consent',
    state: createState(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${data.error || 'unknown'}`);
  }
  return data;
}

function decodeIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return { googleSub: payload.sub ?? null, googleEmail: payload.email ?? null };
  } catch {
    return { googleSub: null, googleEmail: null };
  }
}

/** Returns the frontend URL to redirect the browser to - success or error, never throws. */
export async function handleCallback({ code, state, error }) {
  if (error) return frontendUrl('/appointments?google=error');

  const userId = verifyState(state);
  if (!userId || typeof code !== 'string') return frontendUrl('/appointments?google=error');

  try {
    requireGoogleConfigured();
    const tokens = await exchangeCode(code);
    const { googleSub, googleEmail } = tokens.id_token
      ? decodeIdToken(tokens.id_token)
      : { googleSub: null, googleEmail: null };

    const encryptedAccess = encryptToken(tokens.access_token);
    // '' is a sentinel meaning "Google didn't send a refresh_token this
    // time" (a re-consent) - the UPDATE branch below keeps the existing one
    // rather than overwriting it with nothing.
    const encryptedRefresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : '';

    if (!tokens.refresh_token) {
      const existing = await one(`SELECT id FROM google_accounts WHERE user_id = $1`, [userId]);
      if (!existing) {
        console.error('[google] callback: no refresh_token and no prior grant for user', userId);
        return frontendUrl('/appointments?google=error');
      }
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await query(
      `INSERT INTO google_accounts
         (user_id, google_sub, google_email, access_token, refresh_token, expires_at, scope, calendar_id, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'primary', NULL)
       ON CONFLICT (user_id) DO UPDATE SET
         google_sub = EXCLUDED.google_sub,
         google_email = EXCLUDED.google_email,
         access_token = EXCLUDED.access_token,
         refresh_token = CASE WHEN EXCLUDED.refresh_token = '' THEN google_accounts.refresh_token
                               ELSE EXCLUDED.refresh_token END,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         revoked_at = NULL`,
      [userId, googleSub, googleEmail, encryptedAccess, encryptedRefresh, expiresAt, tokens.scope]
    );

    return frontendUrl('/appointments?google=connected');
  } catch (err) {
    console.error('[google] callback failed:', err.message);
    return frontendUrl('/appointments?google=error');
  }
}

export async function disconnectGoogle(userId) {
  const account = await one(
    `SELECT access_token, refresh_token FROM google_accounts WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  if (account) {
    try {
      // Revoking the refresh token also invalidates any access token
      // derived from it, so prefer it; fall back to the access token if
      // there's somehow no refresh token stored.
      const token = account.refresh_token ? decryptToken(account.refresh_token) : decryptToken(account.access_token);
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch (err) {
      // Revoke-at-Google is best-effort - we still mark it disconnected
      // locally either way, so a flaky call here can't strand the user in
      // a "connected" state they can't get out of.
      console.error('[google] revoke call failed (disconnecting locally anyway):', err.message);
    }
  }
  await query(`UPDATE google_accounts SET revoked_at = now() WHERE user_id = $1`, [userId]);
  return { disconnected: true };
}

export async function getGoogleStatus(userId) {
  const account = await one(
    `SELECT google_email AS "googleEmail", created_at AS "connectedAt", revoked_at AS "revokedAt"
       FROM google_accounts WHERE user_id = $1`,
    [userId]
  );
  if (!account || account.revokedAt) {
    return { connected: false, googleEmail: null, connectedAt: null };
  }
  return { connected: true, googleEmail: account.googleEmail, connectedAt: account.connectedAt };
}
