/**
 * Applies docs/schema.sql to the configured database.
 *
 *   npm run migrate         (local, reads .env)
 *   npm run migrate:prod    (hosted, platform env vars)
 *
 * schema.sql is written to be idempotent, so re-running it is safe.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pool, closePool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../../docs/schema.sql');

async function main() {
  const sql = await readFile(schemaPath, 'utf8');
  console.log(`[migrate] applying ${schemaPath}`);

  const client = await pool.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`
    );
    console.log(`[migrate] done. ${rows.length} tables present:`);
    for (const row of rows) console.log(`           - ${row.table_name}`);
  } finally {
    client.release();
  }
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error('[migrate] FAILED:', err.message);
    await closePool().catch(() => {});
    process.exit(1);
  });
