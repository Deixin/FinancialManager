export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string | null;
  readonly destructive: boolean;
  readonly checksum: string;
}
export interface AppliedMigration {
  readonly version: string | number;
  readonly checksum: string;
}
export type Sha256 = (text: string) => Promise<string>;
export interface MigrationStep {
  readonly migration: Migration;
  readonly direction: 'up' | 'down';
}
// Version 1 keeps the byte checksum already installed by US-020/021.
// Later versions bind both directions and their safety classification.
export function migrationContent(
  migration: Omit<Migration, 'checksum'>,
): string {
  return migration.version === 1
    ? migration.up
    : JSON.stringify([
        migration.version,
        migration.name,
        migration.up,
        migration.down,
        migration.destructive,
      ]);
}
export async function verifyMigrations(
  input: readonly Migration[],
  sha256: Sha256,
): Promise<readonly Migration[]> {
  const catalog = input.map((entry) => Object.freeze({ ...entry }));
  if (!catalog.length) throw new Error('MIGRATION_CATALOG_INVALID');
  for (const [index, entry] of catalog.entries()) {
    if (
      entry.version !== index + 1 ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(entry.name) ||
      typeof entry.up !== 'string' ||
      !entry.up.trim() ||
      !(
        entry.down === null ||
        (typeof entry.down === 'string' && entry.down.trim())
      ) ||
      typeof entry.destructive !== 'boolean' ||
      !/^[a-f0-9]{64}$/.test(entry.checksum)
    )
      throw new Error('MIGRATION_CATALOG_INVALID');
    if ((await sha256(migrationContent(entry))) !== entry.checksum)
      throw new Error('MIGRATION_CHECKSUM_MISMATCH');
  }
  return Object.freeze(catalog);
}
export function planMigrations(
  catalog: readonly Migration[],
  history: readonly AppliedMigration[],
  target: number,
): readonly MigrationStep[] {
  if (!Number.isSafeInteger(target) || target < 1 || target > catalog.length)
    throw new Error('MIGRATION_TARGET_UNSUPPORTED');
  for (const [index, record] of history.entries()) {
    const migration = catalog[index];
    if (!migration || String(record.version) !== String(index + 1))
      throw new Error('MIGRATION_HISTORY_INVALID');
    if (record.checksum !== migration.checksum)
      throw new Error('MIGRATION_CHECKSUM_MISMATCH');
  }
  const steps: MigrationStep[] =
    history.length <= target
      ? catalog
          .slice(history.length, target)
          .map((migration) => ({ migration, direction: 'up' }))
      : catalog
          .slice(target, history.length)
          .reverse()
          .map((migration) => ({ migration, direction: 'down' }));
  // Validate the whole plan before applying even its first step.
  for (const step of steps) {
    if (step.direction === 'down' && step.migration.down === null)
      throw new Error('MIGRATION_DOWN_UNSUPPORTED');
    if (step.migration.destructive)
      throw new Error('MIGRATION_DESTRUCTIVE_UNSUPPORTED');
  }
  return Object.freeze(steps.map((step) => Object.freeze(step)));
}
export function assertSchemaCompatibility(
  version: number,
  window: Readonly<{ minimum: number; maximum: number }>,
): void {
  if (
    !Number.isSafeInteger(version) ||
    !Number.isSafeInteger(window.minimum) ||
    !Number.isSafeInteger(window.maximum) ||
    window.minimum < 1 ||
    window.maximum < window.minimum ||
    version < window.minimum ||
    version > window.maximum
  )
    throw new Error('MIGRATION_SCHEMA_INCOMPATIBLE');
}
export const migrationErrors = Object.freeze([
  'MIGRATION_CATALOG_INVALID',
  'MIGRATION_CHECKSUM_MISMATCH',
  'MIGRATION_HISTORY_INVALID',
  'MIGRATION_TARGET_UNSUPPORTED',
  'MIGRATION_DOWN_UNSUPPORTED',
  'MIGRATION_DESTRUCTIVE_UNSUPPORTED',
  'MIGRATION_ENGINE_UNSUPPORTED',
  'MIGRATION_FOREIGN_KEYS_REQUIRED',
  'MIGRATION_INTEGRITY_FAILED',
]);
export function safeMigrationError(error: unknown): Error {
  return new Error(
    error instanceof Error && migrationErrors.includes(error.message)
      ? error.message
      : 'MIGRATION_FAILED',
  );
}
