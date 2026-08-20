import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getDoctorQueue } from '../services/queue.js';

export const doctorRouter = Router();

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

doctorRouter.use(requireAuth, requireRole('doctor'));

/** The doctor's landing page: today's confirmed appointments, urgency-sorted. */
doctorRouter.get(
  '/queue',
  asyncHandler(async (req, res) => {
    const date = req.query.date || toISODate(new Date());
    const queue = await getDoctorQueue(req.user.id, date);
    res.json({ queue });
  })
);
