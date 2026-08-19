/**
 * A single error shape for the whole API:
 *   { "error": { "code": "SLOT_TAKEN", "message": "...", "details": {...} } }
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed for this role') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') =>
  new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) =>
  new AppError(409, 'CONFLICT', message, details);
export const unavailable = (message = 'Upstream service unavailable') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

/** Wrap an async handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
