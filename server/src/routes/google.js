import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { buildConnectUrl, handleCallback, disconnectGoogle, getGoogleStatus } from '../google/oauth.js';

export const googleRouter = Router();

/**
 * Returns the consent URL rather than redirecting directly - the SPA calls
 * this as a normal authenticated fetch (needs the Bearer token) and then
 * performs the actual full-page navigation to Google itself.
 */
googleRouter.get(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ url: buildConnectUrl(req.user.id) });
  })
);

/**
 * No requireAuth here - this is hit directly by Google's redirect with no
 * Authorization header at all. The signed `state` param is what identifies
 * the user. Never throws; always redirects the browser back to the SPA.
 */
googleRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const redirectTo = await handleCallback(req.query);
    res.redirect(redirectTo);
  })
);

googleRouter.delete(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await disconnectGoogle(req.user.id));
  })
);

googleRouter.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getGoogleStatus(req.user.id));
  })
);
