import type { SqliteConnection } from './index.js';
import { sqliteCatalog } from './generated-migrations.js';
import {
  planMigrations,
  safeMigrationError,
  verifyMigrations,
} from './migration-plan.js';
import type { Migration, Sha256 } from './migration-plan.js';
export * from './migration-plan.js';
export { sqliteCatalog } from './generated-migrations.js';
// Exclusive storage connection, already unlocked by the trusted native host.
// A failed invocation requires disposal of the connection, including failed rollback.
export async function migrateSqliteTo(
  db: SqliteConnection,
  options: Readonly<{
    sha256: Sha256;
    target?: number;
    catalog?: readonly Migration[];
  }>,
): Promise<Readonly<{ from: number; to: number; applied: number }>> {
  let active = false;
  try {
    const catalog = await verifyMigrations(
      options.catalog ?? sqliteCatalog,
      options.sha256,
    );
    const target = options.target ?? catalog.length;
    planMigrations(catalog, [], target);
    await db.exec(
      'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
    );
    if (String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !== '1')
      throw new Error('MIGRATION_FOREIGN_KEYS_REQUIRED');
    await db.exec('BEGIN IMMEDIATE');
    active = true;
    const exists = await db.rows(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name='_schema_migration'",
    );
    const history = exists.length
      ? await db.rows(
          'SELECT version,checksum FROM _schema_migration ORDER BY version',
        )
      : [];
    if (exists.length && !history.length)
      throw new Error('MIGRATION_HISTORY_INVALID');
    const steps = planMigrations(
      catalog,
      history.map((row) => ({
        version: String(row.version),
        checksum: String(row.checksum),
      })),
      target,
    );
    if ((await db.rows('PRAGMA foreign_key_check')).length)
      throw new Error('MIGRATION_INTEGRITY_FAILED');
    for (const { migration, direction } of steps) {
      if (direction === 'up') {
        await db.exec(migration.up);
        await db.run(
          'INSERT INTO _schema_migration(version,checksum) VALUES (?,?)',
          [migration.version, migration.checksum],
        );
      } else {
        await db.exec(migration.down!);
        await db.run('DELETE FROM _schema_migration WHERE version=?', [
          migration.version,
        ]);
      }
    }
    if ((await db.rows('PRAGMA foreign_key_check')).length)
      throw new Error('MIGRATION_INTEGRITY_FAILED');
    await db.exec('COMMIT');
    active = false;
    return Object.freeze({
      from: history.length,
      to: target,
      applied: steps.length,
    });
  } catch (error) {
    if (active)
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* Dispose connection. */
      }
    throw safeMigrationError(error);
  }
}
