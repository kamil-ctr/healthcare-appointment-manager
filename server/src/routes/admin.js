import { Router } from 'express';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { required, isEmail, minLength, isDateString } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createDoctor,
  listDoctors,
  getDoctorDetail,
  updateDoctorProfile,
  deactivateDoctor,
  setDoctorAvailability,
} from '../services/doctors.js';
import { createLeaveWithCascade, deleteLeave } from '../services/leave.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.post(
  '/doctors',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    required(body, ['email', 'password', 'fullName', 'specialisation']);
    isEmail(body.email);
    minLength(body.password, 8, 'password');
    minLength(body.fullName, 2, 'fullName');
    minLength(body.specialisation, 2, 'specialisation');

    if (body.slotMinutes !== undefined) {
      const slotMinutes = Number(body.slotMinutes);
      if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) {
        throw badRequest('slotMinutes must be an integer between 5 and 240.', {
          fields: ['slotMinutes'],
        });
      }
    }
    if (body.consultationFee !== undefined) {
      const fee = Number(body.consultationFee);
      if (!Number.isFinite(fee) || fee < 0) {
        throw badRequest('consultationFee must be a non-negative number.', {
          fields: ['consultationFee'],
        });
      }
    }

    const doctor = await createDoctor(body);
    res.status(201).json({ doctor });
  })
);

adminRouter.get(
  '/doctors',
  asyncHandler(async (req, res) => {
    const { specialisation, q } = req.query;
    const includeInactive = req.query.includeInactive === 'true';
    const doctors = await listDoctors({ specialisation, q, includeInactive });
    res.json({ doctors });
  })
);

adminRouter.get(
  '/doctors/:id',
  asyncHandler(async (req, res) => {
    const doctor = await getDoctorDetail(req.params.id);
    if (!doctor) throw notFound('Doctor not found.');
    res.json({ doctor });
  })
);

adminRouter.patch(
  '/doctors/:id',
  asyncHandler(async (req, res) => {
    const doctor = await updateDoctorProfile(req.params.id, req.body ?? {});
    res.json({ doctor });
  })
);

adminRouter.delete(
  '/doctors/:id',
  asyncHandler(async (req, res) => {
    const result = await deactivateDoctor(req.params.id);
    if (!result) throw notFound('Doctor not found.');
    res.json(result);
  })
);

adminRouter.put(
  '/doctors/:id/availability',
  asyncHandler(async (req, res) => {
    const availability = await setDoctorAvailability(req.params.id, req.body);
    res.json({ availability });
  })
);

adminRouter.post(
  '/doctors/:id/leave',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    required(body, ['date']);
    isDateString(body.date, 'date');

    const result = await createLeaveWithCascade(req.params.id, {
      date: body.date,
      reason: body.reason,
      createdBy: req.user.id,
    });
    res.status(201).json(result);
  })
);

adminRouter.delete(
  '/doctors/:id/leave/:date',
  asyncHandler(async (req, res) => {
    isDateString(req.params.date, 'date');
    const result = await deleteLeave(req.params.id, req.params.date);
    res.json(result);
  })
);
