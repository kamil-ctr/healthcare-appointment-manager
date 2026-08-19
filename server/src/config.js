/**
 * Central configuration.
 *
 * Env vars are loaded natively:
 *   - local  : `node --env-file=.env src/index.js` (see package.json scripts)
 *   - hosted : injected by the platform (Render/Railway dashboard)
 * No `dotenv` dependency is needed on Node >= 20.6.
 */

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

function readEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
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

  // Filled in on later days; declared here so the shape is visible from day 1.
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-6',
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
