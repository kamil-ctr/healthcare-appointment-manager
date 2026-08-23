/**
 * requireAuth parses `Authorization: Bearer <jwt>` and attaches req.user.
 * requireRole(...) must run after requireAuth on the same route.
 */
import { one } from '../db/pool.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import {
  verifyToken,
  JwtMalformedError,
  JwtSignatureError,
  JwtExpiredError,
} from '../lib/jwt.js';

/**
 * The JWT payload only carries id/role from the moment it was issued - if
 * this only checked the signature, a deactivated account would keep full
 * access for up to the remaining token lifetime. Re-checking is_active here
 * (once per request, never in a loop) is what makes deactivation immediate
 * on every protected route, not just /auth/me's own handler.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Missing bearer token.'));
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err instanceof JwtExpiredError) return next(unauthorized('Token expired.'));
    if (err instanceof JwtSignatureError) return next(unauthorized('Invalid token signature.'));
    if (err instanceof JwtMalformedError) return next(unauthorized('Malformed token.'));
    return next(unauthorized('Invalid token.'));
  }

  try {
    const user = await one(`SELECT is_active AS "isActive" FROM users WHERE id = $1`, [payload.sub]);
    if (!user) return next(unauthorized('Invalid token.'));
    if (!user.isActive) return next(unauthorized('Account is deactivated.'));
  } catch (err) {
    return next(err);
  }

  req.user = { id: payload.sub, role: payload.role };
  return next();
}

/** requireRole('admin') or requireRole('doctor', 'admin'). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}
