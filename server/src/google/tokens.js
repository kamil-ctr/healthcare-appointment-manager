/**
 * Access-token retrieval for outbound Calendar API calls, with transparent
 * refresh. Only called from jobs/outbox.js's calendar handler - never from
 * a request path, so a slow or failing Google refresh can never block
 * booking/confirm/cancel/reschedule.
 */
import { one, query } from '../db/pool.js';
import { config } from '../config.js';
import { encryptToken, decryptToken } from './crypto.js';

const REFRESH_SKEW_MS = 60 * 1000;

/**
 * Returns a usable access token for `userId`, or null if there's nothing
 * usable - no google_accounts row, a revoked grant, or a refresh that came
 * back invalid_grant (the user revoked access from their Google account
 * settings). null is a normal, expected outcome here, not an error: the
 * caller treats it as "this user isn't connected" and moves on without
 * retrying.
 */
export async function getAccessToken(userId) {
  const account = await one(
    `SELECT access_token, refresh_token, expires_at, revoked_at
       FROM google_accounts WHERE user_id = $1`,
    [userId]
  );
  if (!account || account.revoked_at) return null;

  const expiresAt = new Date(account.expires_at).getTime();
  if (expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return decryptToken(account.access_token);
  }

  const refreshToken = decryptToken(account.refresh_token);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_grant') {
      // The user revoked access on Google's side. Terminal - never retry a
      // revoked grant; mark it so every future call short-circuits above.
      await query(`UPDATE google_accounts SET revoked_at = now() WHERE user_id = $1`, [userId]);
      return null;
    }
    throw new Error(`Google token refresh failed (${res.status}): ${body.error || 'unknown'}`);
  }

  // A refresh response normally does NOT include a new refresh_token
  // (Google doesn't rotate it here) - only access_token/expires_in change.
  const data = await res.json();
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await query(`UPDATE google_accounts SET access_token = $2, expires_at = $3 WHERE user_id = $1`, [
    userId,
    encryptToken(data.access_token),
    newExpiresAt,
  ]);
  return data.access_token;
}
