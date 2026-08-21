import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

/**
 * Minimal CORS. ~15 lines of native code instead of a dependency, and it
 * only ever echoes back an origin that is explicitly allow-listed.
 */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.webOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}

/**
 * Hand-set security headers - no helmet dependency. This is a pure JSON
 * API (no HTML rendered, no inline scripts to allow), so the header list
 * is short and deliberate rather than a copied preset.
 */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
}

/** Tags every request so a log line can be traced to a client response. */
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/** One-line access log with duration. */
export function accessLog(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms [${req.id}]`
    );
  });
  next();
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

/**
 * Terminal error handler. Known AppErrors are reported faithfully; anything
 * else is logged in full and reduced to a generic 500 so internals never
 * leak to the client.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId: req.id,
    });
  }

  // Unique-violation safety net (e.g. duplicate email on register).
  if (err && err.code === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'That record already exists.' },
      requestId: req.id,
    });
  }

  console.error(`[error] ${req.method} ${req.originalUrl} [${req.id}]`, err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' },
    requestId: req.id,
  });
}
