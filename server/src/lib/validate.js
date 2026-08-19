/**
 * Small hand-written request validators - no zod dependency.
 * Each throws badRequest() with a `details.fields` array naming what failed,
 * so the client can highlight the right form fields.
 */
import { badRequest } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
