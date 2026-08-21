/**
 * Hand-rolled sliding-window rate limiter - no package. An in-memory Map
 * keyed by `${routeName}:${ip}`, holding the timestamps of recent requests
 * in that window; a request is rejected once the window already holds
 * `max` entries.
 *
 * HONEST LIMITATION: this state is per-process. On a single Render free
 * instance (this deployment) that is exactly correct - one process, one
 * source of truth. On a multi-instance deploy it would under-count (each
 * instance only sees its own share of traffic) and would need to move to a
 * shared store - Postgres (a `rate_limit_hits` table) or Redis - to stay
 * accurate. Not pretending otherwise is better than a limiter that looks
 * right and silently isn't once the deploy topology changes.
 */
const WINDOW_MS = 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

const buckets = new Map(); // key -> timestamps (ms), ascending

function pruneOldEntries(timestamps, cutoff) {
  let start = 0;
  while (start < timestamps.length && timestamps[start] <= cutoff) start += 1;
  return start === 0 ? timestamps : timestamps.slice(start);
}

/** Periodic sweep so buckets for IPs/routes that have gone quiet don't sit in memory forever. */
function sweep() {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of buckets) {
    const fresh = pruneOldEntries(timestamps, cutoff);
    if (fresh.length === 0) buckets.delete(key);
    else if (fresh !== timestamps) buckets.set(key, fresh);
  }
}

const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
sweepTimer.unref(); // never keeps the process alive on its own

/**
 * rateLimit('login', 10) -> at most 10 requests per IP per rolling 60s
 * window on the route it's mounted on. 429s carry the standard error
 * envelope plus a Retry-After header naming exactly when the window frees up.
 */
export function rateLimit(routeName, max, windowMs = WINDOW_MS) {
  return (req, res, next) => {
    const key = `${routeName}:${req.ip}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = pruneOldEntries(buckets.get(key) || [], cutoff);

    if (timestamps.length >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again shortly.',
          details: { retryAfterSeconds },
        },
        requestId: req.id,
      });
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    return next();
  };
}

/** Test-only: drops all bucket state between runs. */
export function resetRateLimits() {
  buckets.clear();
}
