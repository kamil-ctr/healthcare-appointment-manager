/**
 * Idempotent admin seed.
 *
 *   npm run seed:admin   (local, reads .env for ADMIN_EMAIL / ADMIN_PASSWORD)
 *
 * Creates the admin user from ADMIN_EMAIL/ADMIN_PASSWORD if it does not
 * exist; if a user with that email already exists, updates its password
 * (and promotes it to the admin role) instead of failing on the unique
 * email index. Safe to re-run.
 */
import { one, closePool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/lib/password.js';

async function main() {
  const { email, password } = config.admin;
  if (!email || !password) {
    console.error('[seed-admin] ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  const existing = await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);

  if (existing) {
    await one(
      `UPDATE users SET role = 'admin', password_hash = $2, full_name = 'Admin'
         WHERE id = $1 RETURNING id`,
      [existing.id, passwordHash]
    );
    console.log(`[seed-admin] updated existing user ${email} -> role=admin, password reset`);
    return;
  }

  const created = await one(
    `INSERT INTO users (role, email, full_name, password_hash)
     VALUES ('admin', $1, 'Admin', $2)
     RETURNING id`,
    [email, passwordHash]
  );
  console.log(`[seed-admin] created admin ${email} (id=${created.id})`);
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error('[seed-admin] FAILED:', err.message);
    await closePool().catch(() => {});
    process.exitCode = 1;
  });
