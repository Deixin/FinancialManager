export { sqliteMigration, sqliteMigrationSha256 } from './generated.js';
export { createSqliteAccountService } from './account-changes.js';
export type { SqliteAccountOptions } from './account-changes.js';
import { sqliteMigration, sqliteMigrationSha256 } from './generated.js';
export function normalizedName(value: string): string {
  if (typeof value !== 'string') throw new Error('STORAGE_NAME_INVALID');
  const result = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  if (!result) throw new Error('STORAGE_NAME_INVALID');
  return result;
}
export interface SqliteConnection {
  exec(sql: string): Promise<unknown>;
  run(
    sql: string,
    values: readonly (string | number | null)[],
  ): Promise<unknown>;
  rows(
    sql: string,
    values?: readonly (string | number | null)[],
  ): Promise<readonly Readonly<Record<string, string | number | null>>[]>;
}
// Trusted storage adapter only. Never expose this connection as UI/IPC SQL access.
export async function migrateSqlite(db: SqliteConnection): Promise<boolean> {
  let transaction = false;
  try {
    await db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA trusted_schema=OFF',
    );
    if (String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !== '1')
      throw new Error('FOREIGN_KEYS_REQUIRED');
    await db.exec('BEGIN IMMEDIATE');
    transaction = true;
    const existing = await db.rows(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name='_schema_migration'",
    );
    const applied = existing.length === 0;
    if (applied) {
      await db.exec(sqliteMigration);
      await db.run(
        'INSERT INTO _schema_migration(version,checksum) VALUES (1,?)',
        [sqliteMigrationSha256],
      );
    } else {
      const versions = await db.rows(
        'SELECT version,checksum FROM _schema_migration',
      );
      if (
        versions.length !== 1 ||
        String(versions[0]?.version) !== '1' ||
        versions[0]?.checksum !== sqliteMigrationSha256
      )
        throw new Error('SQLITE_MIGRATION_MISMATCH');
    }
    await db.exec('COMMIT');
    transaction = false;
    return applied;
  } catch (error) {
    if (transaction)
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* Caller discards a connection with a failed migration. */
      }
    throw new Error(
      error instanceof Error && error.message === 'SQLITE_MIGRATION_MISMATCH'
        ? error.message
        : 'SQLITE_MIGRATION_FAILED',
    );
  }
}
