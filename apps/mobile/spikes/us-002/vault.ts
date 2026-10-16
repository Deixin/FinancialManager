import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { moneyMinor, SYNTHETIC_VECTORS } from './money';

// These identifiers belong exclusively to the synthetic instrument, not to cloud users.
export const WORKSPACE_A = '00000000-0000-4000-8000-000000000001';
export const WORKSPACE_B = '00000000-0000-4000-8000-000000000002';
export const WORKSPACE_MIGRATION = '00000000-0000-4000-8000-000000000003';
const allowed = new Set([WORKSPACE_A, WORKSPACE_B, WORKSPACE_MIGRATION]);
export const directory = new Directory(Paths.document, 'us002-synthetic');
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'com.miudos.financialmanager.us002.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

export function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function nativeStep<T>(
  code: string,
  task: () => T | Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message))
      throw error;
    // Report the operation only; native messages may embed SQL, paths or secrets.
    throw new Error('NATIVE_' + code + '_FAILED');
  }
}

function filename(workspace: string): string {
  assert(allowed.has(workspace), 'SYNTHETIC_WORKSPACE_REQUIRED');
  return 'replica-' + workspace + '.sqlite';
}

export function databaseFile(workspace: string): File {
  return new File(directory, filename(workspace));
}

function secretName(workspace: string): string {
  filename(workspace);
  return 'replica.' + workspace;
}

export async function getKey(workspace: string): Promise<string> {
  let key: string | null;
  try {
    key = await SecureStore.getItemAsync(secretName(workspace), options);
  } catch {
    throw new Error('SECRET_STORE_UNAVAILABLE');
  }
  assert(key !== null, 'VAULT_KEY_MISSING');
  assert(/^[0-9a-f]{64}$/.test(key), 'VAULT_KEY_INVALID');
  return key;
}

// Exported only for loss/recovery tests of this synthetic instrument.
export async function storeTestKey(
  workspace: string,
  key: string,
): Promise<void> {
  assert(/^[0-9a-f]{64}$/.test(key), 'VAULT_KEY_INVALID');
  await SecureStore.setItemAsync(secretName(workspace), key, options);
  assert((await getKey(workspace)) === key, 'SECRET_STORE_READBACK_FAILED');
}

export async function removeTestKey(workspace: string): Promise<void> {
  await SecureStore.deleteItemAsync(secretName(workspace), options);
}

export async function rawConnection(
  name: string,
  key?: string,
): Promise<SQLite.SQLiteDatabase> {
  // Always separate connections: the native cache must not reuse a previously keyed handle.
  const db = await SQLite.openDatabaseAsync(
    name,
    { useNewConnection: true },
    directory.uri,
  );
  try {
    if (key !== undefined) {
      assert(/^[0-9a-f]{64}$/.test(key), 'VAULT_KEY_INVALID');
      // PRAGMA does not accept bound parameters. Only CSPRNG/validated hex reaches this string.
      await db.execAsync(`PRAGMA key = "x'${key}'"`);
    }
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
    return db;
  } catch {
    await db.closeAsync();
    throw new Error('VAULT_UNREADABLE');
  }
}

export async function openVault(
  workspace: string,
): Promise<SQLite.SQLiteDatabase> {
  assert(databaseFile(workspace).exists, 'VAULT_NOT_FOUND');
  const key = await getKey(workspace);
  const db = await rawConnection(filename(workspace), key);
  try {
    await db.execAsync(
      'PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA cipher_memory_security=ON;',
    );
    const version = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    assert(version?.user_version === 1, 'SCHEMA_VERSION_UNSUPPORTED');
    const identity = await db.getFirstAsync<{
      workspace_id: string;
      synthetic: number;
    }>('SELECT * FROM replica');
    assert(
      identity?.workspace_id === workspace && identity.synthetic === 1,
      'WORKSPACE_MISMATCH',
    );
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

// Single private connection, serial use only. Expo's exclusive helper opens an unkeyed
// connection, so it cannot be used for SQLCipher migrations without keying that handle.
export async function transaction(
  db: SQLite.SQLiteDatabase,
  task: () => Promise<void>,
): Promise<void> {
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await task();
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}

export async function createVault(
  workspace: string,
  failMigration = false,
): Promise<void> {
  await nativeStep('DIRECTORY_CREATE', () =>
    directory.create({ idempotent: true, intermediates: true }),
  );
  assert(!databaseFile(workspace).exists, 'VAULT_ALREADY_EXISTS');
  // A stale key is never silently overwritten either.
  assert(
    (await nativeStep('SECRET_READ', () =>
      SecureStore.getItemAsync(secretName(workspace), options),
    )) === null,
    'VAULT_KEY_ALREADY_EXISTS',
  );
  const bytes = await nativeStep('RANDOM_BYTES', () =>
    Crypto.getRandomBytesAsync(32),
  );
  const key = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  bytes.fill(0);
  await nativeStep('SECRET_WRITE', () => storeTestKey(workspace, key));
  const db = await nativeStep('DATABASE_OPEN', () =>
    rawConnection(filename(workspace), key),
  );
  try {
    const engine = await nativeStep('CIPHER_VERSION', () =>
      db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version'),
    );
    assert(engine?.cipher_version, 'SQLCIPHER_REQUIRED');
    await nativeStep('CIPHER_CONFIG', () =>
      db.execAsync(
        'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA cipher_memory_security=ON;',
      ),
    );
    await nativeStep('MIGRATION', () =>
      transaction(db, async () => {
        await db.execAsync(`
        CREATE TABLE replica (
          workspace_id TEXT PRIMARY KEY NOT NULL,
          synthetic INTEGER NOT NULL CHECK(synthetic=1)
        ) STRICT;
        CREATE TABLE vector (
          workspace_id TEXT NOT NULL REFERENCES replica(workspace_id),
          ordinal INTEGER NOT NULL,
          amount_minor INTEGER NOT NULL,
          PRIMARY KEY(workspace_id, ordinal)
        ) STRICT;
        PRAGMA user_version=1;
      `);
        await db.runAsync('INSERT INTO replica VALUES (?, 1)', workspace);
        if (failMigration) throw new Error('SYNTHETIC_MIGRATION_INTERRUPTED');
        for (const [index, value] of SYNTHETIC_VECTORS.entries()) {
          await db.runAsync(
            'INSERT INTO vector VALUES (?, ?, CAST(? AS INTEGER))',
            workspace,
            index,
            moneyMinor(value),
          );
        }
      }),
    );
  } finally {
    await db.closeAsync();
  }
}

export async function verifyExact(
  db: SQLite.SQLiteDatabase,
  workspace: string,
): Promise<void> {
  const rows = await db.getAllAsync<{
    amount_minor: string;
    storage_type: string;
  }>(
    'SELECT CAST(amount_minor AS TEXT) AS amount_minor, typeof(amount_minor) AS storage_type FROM vector WHERE workspace_id=? ORDER BY ordinal',
    workspace,
  );
  assert(rows.length === SYNTHETIC_VECTORS.length, 'VECTOR_COUNT_MISMATCH');
  assert(
    rows.every(
      (row, index) =>
        row.storage_type === 'integer' &&
        moneyMinor(row.amount_minor) === SYNTHETIC_VECTORS[index],
    ),
    'INT64_ROUNDTRIP_FAILED',
  );
  const wire = JSON.parse(
    JSON.stringify(rows.map((row) => ({ amount_minor: row.amount_minor }))),
  );
  assert(
    wire.every(
      (row: { amount_minor: unknown }, index: number) =>
        moneyMinor(row.amount_minor) === SYNTHETIC_VECTORS[index],
    ),
    'JSON_ROUNDTRIP_FAILED',
  );
  const integrity = await db.getFirstAsync<{ integrity_check: string }>(
    'PRAGMA integrity_check',
  );
  assert(integrity?.integrity_check === 'ok', 'SQLITE_INTEGRITY_FAILED');
  const cipherIntegrity = await db.getAllAsync('PRAGMA cipher_integrity_check');
  assert(cipherIntegrity.length === 0, 'CIPHER_INTEGRITY_FAILED');
  const violations = await db.getAllAsync('PRAGMA foreign_key_check');
  assert(violations.length === 0, 'FOREIGN_KEY_CHECK_FAILED');
}

export async function cleanup(): Promise<void> {
  for (const workspace of allowed) {
    // This namespace and directory are owned solely by this synthetic app.
    await removeTestKey(workspace);
  }
  if (directory.exists) directory.delete();
}
