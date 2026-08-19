import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { required } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  holdAppointment,
  confirmAppointment,
  cancelAppointment,
  rescheduleAppointment,
  listAppointments,
} from '../services/appointments.js';

export const appointmentsRouter = Router();

appointmentsRouter.use(requireAuth);

appointmentsRouter.post(
  '/hold',
  requireRole('patient'),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    required(body, ['doctorId', 'startsAt']);
    const result = await holdAppointment(body.doctorId, req.user.id, body.startsAt);
    res.status(201).json(result);
  })
);

appointmentsRouter.post(
  '/:id/confirm',
  requireRole('patient'),
  asyncHandler(async (req, res) => {
    const result = await confirmAppointment(req.params.id, req.user.id);
    res.json(result);
  })
);

appointmentsRouter.post(
  '/:id/cancel',
  requireRole('patient', 'doctor'),
  asyncHandler(async (req, res) => {
    const result = await cancelAppointment(req.params.id, req.user.id, req.user.role, req.body?.reason);
    res.json(result);
  })
);

appointmentsRouter.post(
  '/:id/reschedule',
  requireRole('patient'),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    required(body, ['startsAt']);
    const result = await rescheduleAppointment(req.params.id, req.user.id, body.startsAt);
    res.status(201).json(result);
  })
);

appointmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, from, to } = req.query;
    const appointments = await listAppointments({ user: req.user, status, from, to });
    res.json({ appointments });
  })
);
