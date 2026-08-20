import express from 'express';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { doctorsRouter } from './routes/doctors.js';
import { appointmentsRouter } from './routes/appointments.js';
import { doctorRouter } from './routes/doctor.js';
import { internalRouter } from './routes/internal.js';
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
  app.use('/api/admin', adminRouter);
  app.use('/api/doctors', doctorsRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/doctor', doctorRouter);
  app.use('/api/internal', internalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
