import { Router } from 'express';
import { asyncHandler, unauthorized, unavailable } from '../lib/errors.js';
import { runJobs, checkJobSecret } from '../jobs/runner.js';

export const internalRouter = Router();

/**
 * No user JWT here - authenticated by a shared secret header instead, so
 * an external cron pinger (not a logged-in browser) can drive the sweep on
 * free hosting tiers that sleep idle instances.
 */
internalRouter.post(
  '/jobs/tick',
  asyncHandler(async (req, res) => {
    const result = checkJobSecret(req.headers['x-job-secret']);
    if (result === 'unset') throw unavailable('Job trigger secret is not configured.');
    if (result === 'invalid') throw unauthorized('Invalid job trigger secret.');

    const summary = await runJobs();
    res.json(summary);
  })
);
