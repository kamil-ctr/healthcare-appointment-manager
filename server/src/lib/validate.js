/**
 * Small hand-written request validators - no zod dependency.
 * Each throws badRequest() with a `details.fields` array naming what failed,
 * so the client can highlight the right form fields.
 */
import { badRequest } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throws if any of `fields` is missing, null, or an empty string on `body`. */
export function required(body, fields) {
  const missing = fields.filter((field) => {
    const value = body?.[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) {
    throw badRequest('Missing required field(s).', { fields: missing });
  }
}

export function isEmail(value, field = 'email') {
  if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
    throw badRequest('Invalid email format.', { fields: [field] });
  }
}

export function minLength(value, min, field) {
  if (typeof value !== 'string' || value.length < min) {
    throw badRequest(`${field} must be at least ${min} characters.`, { fields: [field] });
  }
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, { fields: [field] });
  }
}

export function isDateString(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw badRequest(`${field} must be an ISO date string (YYYY-MM-DD).`, { fields: [field] });
  }
}

export function isUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID.`, { fields: [field] });
  }
}

export function maxLength(value, max, field) {
  if (typeof value === 'string' && value.length > max) {
    throw badRequest(`${field} must be at most ${max} characters.`, { fields: [field] });
  }
}

/**
 * Express router.param() handler: validates a path param is a well-formed
 * UUID before it reaches any query, so a malformed id 400s here instead of
 * failing deep inside a SQL call as an uncaught type error (500). A
 * well-formed-but-nonexistent id still reaches the handler and its own
 * 404 - this only rejects the shape, never existence.
 */
export function uuidParam(paramName) {
  return (req, res, next, value) => {
    try {
      isUuid(value, paramName);
      next();
    } catch (err) {
      next(err);
    }
  };
}
