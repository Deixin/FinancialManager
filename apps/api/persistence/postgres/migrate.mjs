import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const initialMigration = () =>
  readFileSync(
    new URL('./migrations/0001-financial-core.sql', import.meta.url),
    'utf8',
  );
// Trusted migration tool only; not exported by the application or an HTTP endpoint.
export async function applyInitialMigration(pool, sql = initialMigration()) {
  const checksum = createHash('sha256').update(sql).digest('hex');
  let client;
  let discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE fm_schema_owner');
    await client.query(
      "SET LOCAL search_path = pg_catalog; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'",
    );
    await client.query('SELECT pg_advisory_xact_lock(6020,1)');
    const version = await client.query(
      "SELECT current_setting('server_version_num')::integer AS version",
    );
    if (version.rows[0].version < 180000 || version.rows[0].version >= 190000)
      throw new Error('MIGRATION_ENGINE_UNSUPPORTED');
    const existing = await client.query(
      "SELECT to_regclass('fm.schema_migration') AS relation",
    );
    let applied = false;
    if (existing.rows[0].relation) {
      const current = await client.query(
        'SELECT version,checksum FROM fm.schema_migration',
      );
      if (
        current.rowCount !== 1 ||
        current.rows[0].version !== 1 ||
        current.rows[0].checksum !== checksum
      )
        throw new Error('MIGRATION_CHECKSUM_MISMATCH');
    } else {
      await client.query(sql);
      await client.query(
        'INSERT INTO fm.schema_migration(version,checksum) VALUES (1,$1)',
        [checksum],
      );
      applied = true;
    }
    await client.query('COMMIT');
    return Object.freeze({ applied, checksum });
  } catch (error) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    const code = [
      'MIGRATION_ENGINE_UNSUPPORTED',
      'MIGRATION_CHECKSUM_MISMATCH',
    ].includes(error?.message)
      ? error.message
      : 'MIGRATION_FAILED';
    throw new Error(code);
  } finally {
    client?.release(discard);
  }
}
