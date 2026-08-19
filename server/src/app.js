import express from 'express';
import { healthRouter } from './routes/health.js';
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
  // Day 2+: app.use('/api/auth', authRouter);
  //         app.use('/api/admin', adminRouter);
  //         app.use('/api/doctors', doctorRouter);
  //         app.use('/api/appointments', appointmentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
