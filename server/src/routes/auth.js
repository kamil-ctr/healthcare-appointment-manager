import { Router } from 'express';
import { one } from '../db/pool.js';
import { AppError, asyncHandler, unauthorized, notFound } from '../lib/errors.js';
import { required, isEmail, minLength } from '../lib/validate.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// Computed once and reused so a login against an unknown email takes the
// same code path (and roughly the same time) as one against a real user
// with a wrong password - the response must not leak whether the email
// is registered.
let dummyHashPromise;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('dummy-password-for-timing-parity');
  return dummyHashPromise;
}

const USER_COLUMNS = `id, role, email, full_name AS "fullName", phone`;

/**
 * Role is never read from the request body - every self-registration is a
 * patient. Admins and doctors are created via the admin seed script / the
 * admin portal (day 3), never through this public endpoint.
 */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, fullName, phone } = req.body ?? {};
    required(req.body ?? {}, ['email', 'password', 'fullName']);
    isEmail(email);
    minLength(password, 8, 'password');
    minLength(fullName, 2, 'fullName');

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await one(
        `INSERT INTO users (role, email, full_name, phone, password_hash)
         VALUES ('patient', $1, $2, $3, $4)
         RETURNING ${USER_COLUMNS}`,
        [email, fullName, phone ?? null, passwordHash]
      );
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
      }
      throw err;
    }

    const token = signToken(user.id, user.role);
    res.status(201).json({ token, user });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    required(req.body ?? {}, ['email', 'password']);

    const user = await one(
      `SELECT ${USER_COLUMNS}, is_active AS "isActive", password_hash AS "passwordHash"
         FROM users WHERE lower(email) = lower($1)`,
      [email]
    );

    // Same generic error in every failure case - unknown email, wrong
    // password, and a deactivated account must all be indistinguishable to
    // the client, otherwise the response itself leaks account state.
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw unauthorized('Invalid email or password.');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid || !user.isActive) throw unauthorized('Invalid email or password.');

    const token = signToken(user.id, user.role);
    delete user.passwordHash;
    delete user.isActive;
    res.json({ token, user });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT ${USER_COLUMNS}, is_active AS "isActive", created_at AS "createdAt"
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!user) throw notFound('User not found.');
    res.json({ user });
  })
);
