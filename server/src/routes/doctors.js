import { Router } from 'express';
import { asyncHandler, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { listDoctors, getDoctorDetail } from '../services/doctors.js';

export const doctorsRouter = Router();

doctorsRouter.use(requireAuth);

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
