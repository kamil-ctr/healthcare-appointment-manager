import express from 'express';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { asyncHandler } from './lib/errors.js';
import {
  cors,
  requestId,
  accessLog,
  notFoundHandler,
  errorHandler,
} from './middleware/core.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render/Railway TLS termination

  app.use(requestId);
  app.use(cors);
  app.use(express.json({ limit: '256kb' }));
  app.use(accessLog);

  // --- routes -------------------------------------------------------
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);

  // TEMPORARY (Day 2 verification only): proves requireAuth/requireRole
  // work end-to-end before the real admin portal exists. Remove this once
  // Day 3 adds actual admin routes under /api/admin.
  app.get(
    '/api/admin/ping',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      res.json({ ok: true, role: req.user.role });
    })
  );

  // Day 3+: app.use('/api/admin', adminRouter);
  //         app.use('/api/doctors', doctorRouter);
  //         app.use('/api/appointments', appointmentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
