/**
 * Central configuration.
 *
 * Env vars are loaded natively:
 *   - local  : `node --env-file=.env src/index.js` (see package.json scripts)
 *   - hosted : injected by the platform (Render/Railway dashboard)
 * No `dotenv` dependency is needed on Node >= 20.6.
 *
 * TZ: production sets `TZ=UTC` on the process (Render env var). Every date
 * bug this project has hit (the pg DATE type parser's local-time Date
 * object - see db/pool.js's setTypeParser comment; the frontend's
 * toISOString() day-shift - see web/src/pages/Book.jsx) traced back to a
 * MACHINE-local timezone leaking into a computation that should have used
 * an explicit one. Every display-time conversion in this codebase already
 * goes through an explicit zone (`AT TIME ZONE doctors.timezone` in SQL,
 * `Intl.DateTimeFormat({ timeZone })` in JS) - nothing relies on the
 * host's own local time. Pinning the host to UTC doesn't change any of
 * that logic; it just removes the host's local zone as a variable at all,
 * so a machine that happens not to be UTC (a laptop, a CI runner, a
 * different hosting region) can never reintroduce the same bug class.
 */

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];
// Only enforced in production - JOB_TRIGGER_SECRET has a graceful local
// fallback (checkJobSecret() returns 'unset', the tick endpoint 503s) that
// is fine for a dev machine with no external cron, but a production
// deploy with the trigger unset would mean hold-expiry, the outbox
// worker, AI summaries, and reminders never run at all - failing loudly
// at boot is better than that going unnoticed.
const REQUIRED_IN_PRODUCTION = ['JOB_TRIGGER_SECRET'];

function readEnv() {
  const required =
    process.env.NODE_ENV === 'production' ? [...REQUIRED, ...REQUIRED_IN_PRODUCTION] : REQUIRED;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // Names only - never log the values of any env var, required or not.
    console.error(
      `[config] Missing required environment variable(s): ${missing.join(', ')}\n` +
        `[config] Copy .env.example to .env and fill it in, then re-run.`
    );
    process.exit(1);
  }
}

readEnv();

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 4000),

  // Comma-separated list of allowed browser origins.
  webOrigins: (process.env.WEB_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  db: {
    url: process.env.DATABASE_URL,
    // Managed Postgres (Neon, Supabase, Render) requires TLS; local usually does not.
    ssl: (process.env.DATABASE_SSL ?? 'true') === 'true',
    poolMax: int(process.env.DATABASE_POOL_MAX, 10),
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET,
    tokenTtlSeconds: int(process.env.JWT_TTL_SECONDS, 60 * 60 * 12),
  },

  booking: {
    holdMinutes: int(process.env.SLOT_HOLD_MINUTES, 10),
  },

  // Only consumed by scripts/seed-admin.js; the server itself never needs
  // these, so they are not in the fail-fast REQUIRED list above.
  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },

  // Groq's OpenAI-compatible chat completions API (see server/src/llm/client.js).
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 15000),
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Clinic <no-reply@example.com>',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },
  jobs: {
    intervalMs: int(process.env.JOB_INTERVAL_MS, 60000),
    secret: process.env.JOB_TRIGGER_SECRET || '',
  },
};
