/**
 * requireAuth parses `Authorization: Bearer <jwt>` and attaches req.user.
 * requireRole(...) must run after requireAuth on the same route.
 */
import { unauthorized, forbidden } from '../lib/errors.js';
import {
  verifyToken,
  JwtMalformedError,
  JwtSignatureError,
  JwtExpiredError,
} from '../lib/jwt.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Missing bearer token.'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    if (err instanceof JwtExpiredError) return next(unauthorized('Token expired.'));
    if (err instanceof JwtSignatureError) return next(unauthorized('Invalid token signature.'));
    if (err instanceof JwtMalformedError) return next(unauthorized('Malformed token.'));
    return next(unauthorized('Invalid token.'));
  }
}

/** requireRole('admin') or requireRole('doctor', 'admin'). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}
