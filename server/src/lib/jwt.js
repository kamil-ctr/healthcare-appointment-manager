/**
 * Hand-rolled HS256 JWT sign/verify - no jsonwebtoken dependency.
 *
 * Token shape: base64url(header) . base64url(payload) . base64url(signature)
 * signature = HMAC-SHA256(header.payload, secret)
 *
 * verify() throws one of three distinct error classes so callers (the auth
 * middleware) can tell a replay of an expired token apart from tampering.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export class JwtMalformedError extends Error {
  constructor(message = 'Malformed token') {
    super(message);
    this.name = 'JwtMalformedError';
  }
}
export class JwtSignatureError extends Error {
  constructor(message = 'Invalid token signature') {
    super(message);
    this.name = 'JwtSignatureError';
  }
}
export class JwtExpiredError extends Error {
  constructor(message = 'Token expired') {
    super(message);
    this.name = 'JwtExpiredError';
  }
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    '='
  );
  return Buffer.from(padded, 'base64');
}

function sign(payload, secret = config.auth.jwtSecret) {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${HEADER}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

/** Sign a token for `sub` (user id) and `role`, expiring after the configured TTL. */
export function signToken(sub, role) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + config.auth.tokenTtlSeconds;
  return sign({ sub, role, iat, exp });
}

export function verifyToken(token, secret = config.auth.jwtSecret) {
  if (typeof token !== 'string') throw new JwtMalformedError();
  const segments = token.split('.');
  if (segments.length !== 3) throw new JwtMalformedError();
  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    throw new JwtMalformedError();
  }
  if (header.alg !== 'HS256' || typeof payload.exp !== 'number') {
    throw new JwtMalformedError();
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actualSignature = base64urlDecode(encodedSignature);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new JwtSignatureError();
  }

  if (Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new JwtExpiredError();
  }

  return payload;
}
