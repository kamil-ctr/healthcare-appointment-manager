import { Router } from 'express';
import { asyncHandler, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { uuidParam } from '../lib/validate.js';
import { listDoctors, getDoctorDetail } from '../services/doctors.js';
import { generateSlots } from '../services/slots.js';

export const doctorsRouter = Router();

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

doctorsRouter.use(requireAuth);
doctorsRouter.param('id', uuidParam('id'));

/** Active doctors only - a deactivated doctor never appears in patient-facing search. */
doctorsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { specialisation, q } = req.query;
    const doctors = await listDoctors({ specialisation, q, includeInactive: false });
    res.json({ doctors });
  })
);

doctorsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doctor = await getDoctorDetail(req.params.id, { requireActive: true });
    if (!doctor) throw notFound('Doctor not found.');
    res.json({ doctor });
  })
);

doctorsRouter.get(
  '/:id/slots',
  asyncHandler(async (req, res) => {
    const today = new Date();
    const from = req.query.from || toISODate(today);
    const to = req.query.to || toISODate(new Date(today.getTime() + 6 * 86400000));
    const slots = await generateSlots(req.params.id, from, to);
    res.json({ slots });
  })
);
