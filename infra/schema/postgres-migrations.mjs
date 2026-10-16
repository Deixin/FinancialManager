import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  migrationContent,
  planMigrations,
  safeMigrationError,
  verifyMigrations,
} from '../../packages/storage-schema/dist/migrations.js';
export const sha256 = async (text) =>
  createHash('sha256').update(text).digest('hex');
const directory = new URL(
  '../../apps/api/persistence/postgres/migrations/',
  import.meta.url,
);
const read = (name) => readFileSync(new URL(name, directory), 'utf8');
export async function postgresCatalog() {
  const entries = [
    {
      version: 1,
      name: 'financial-core',
      up: read('0001-financial-core.sql'),
      down: null,
      destructive: false,
    },
    {
      version: 2,
      name: 'balance-reference-lookup',
      up: read('0002-balance-reference-lookup.up.sql'),
      down: read('0002-balance-reference-lookup.down.sql'),
      destructive: false,
    },
  ];
  return Promise.all(
    entries.map(async (entry) =>
      Object.freeze({
        ...entry,
        checksum: await sha256(migrationContent(entry)),
      }),
    ),
  );
}
// Operator tool, no HTTP/IPC endpoint or runtime grants. Same lock as US-020.
export async function migratePostgresTo(pool, options = {}) {
  let client,
    active = false,
    discard = false;
  try {
    const catalog = await verifyMigrations(
      options.catalog ?? (await postgresCatalog()),
      sha256,
    );
    const target = options.target ?? catalog.length;
    planMigrations(catalog, [], target);
    client = await pool.connect();
    await client.query('BEGIN');
    active = true;
    await client.query('SET LOCAL ROLE fm_schema_owner');
    await client.query(
      "SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'",
    );
    await client.query('SELECT pg_advisory_xact_lock(6020,1)');
    const version = Number(
      (
        await client.query(
          "SELECT current_setting('server_version_num') AS version",
        )
      ).rows[0].version,
    );
    if (version < 180000 || version >= 190000)
      throw new Error('MIGRATION_ENGINE_UNSUPPORTED');
    const exists = (
      await client.query(
        "SELECT to_regclass('fm.schema_migration') AS relation",
      )
    ).rows[0].relation;
    const history = exists
      ? (
          await client.query(
            'SELECT version,checksum FROM fm.schema_migration ORDER BY version',
          )
        ).rows
      : [];
    if (exists && !history.length) throw new Error('MIGRATION_HISTORY_INVALID');
    const steps = planMigrations(catalog, history, target);
    for (const { migration, direction } of steps) {
      if (direction === 'up') {
        await client.query(migration.up);
        await client.query(
          'INSERT INTO fm.schema_migration(version,checksum) VALUES($1,$2)',
          [migration.version, migration.checksum],
        );
      } else {
        await client.query(migration.down);
        await client.query('DELETE FROM fm.schema_migration WHERE version=$1', [
          migration.version,
        ]);
      }
    }
    await client.query('COMMIT');
    active = false;
    return Object.freeze({
      from: history.length,
      to: target,
      applied: steps.length,
    });
  } catch (error) {
    if (active)
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
    throw safeMigrationError(error);
  } finally {
    client?.release(discard);
  }
}
