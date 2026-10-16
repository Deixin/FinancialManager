import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { INVALID_VECTORS, moneyMinor } from './money';
import {
  assert,
  cleanup,
  createVault,
  databaseFile,
  directory,
  getKey,
  openVault,
  rawConnection,
  removeTestKey,
  storeTestKey,
  transaction,
  verifyExact,
  WORKSPACE_A,
  WORKSPACE_B,
  WORKSPACE_MIGRATION,
} from './vault';

export const reportFile = new File(Paths.document, 'us002-report.json');
type Report = {
  format_version: 1;
  synthetic_only: true;
  platform: string;
  os_version: string;
  phase: 'prepared' | 'reopened' | 'cleaned' | 'failed';
  passed: boolean;
  checks: Record<string, boolean>;
  cipher_version: string;
  completed_at_utc: string;
  error_code?: string;
};

async function rejects(
  task: () => Promise<unknown>,
  expected?: string,
): Promise<void> {
  try {
    await task();
  } catch (error) {
    if (expected)
      assert(
        error instanceof Error && error.message === expected,
        'UNEXPECTED_FAILURE_CODE',
      );
    return;
  }
  throw new Error('NEGATIVE_TEST_ACCEPTED');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function negativeTests(): Promise<void> {
  const before = await databaseFile(WORKSPACE_A).bytes();
  const name = databaseFile(WORKSPACE_A).name;
  await rejects(() => rawConnection(name));
  await rejects(() => rawConnection(name, '00'.repeat(32)));
  const keyA = await getKey(WORKSPACE_A);
  const keyB = await getKey(WORKSPACE_B);
  assert(keyA !== keyB, 'WORKSPACE_KEYS_REUSED');
  await rejects(() => rawConnection(name, keyB));
  await removeTestKey(WORKSPACE_A);
  try {
    await rejects(() => openVault(WORKSPACE_A), 'VAULT_KEY_MISSING');
    assert(
      sameBytes(before, await databaseFile(WORKSPACE_A).bytes()),
      'KEY_LOSS_CHANGED_DATABASE',
    );
  } finally {
    // Explicit recovery by the synthetic harness, never automatic key regeneration.
    await storeTestKey(WORKSPACE_A, keyA);
  }
  assert(
    sameBytes(before, await databaseFile(WORKSPACE_A).bytes()),
    'NEGATIVE_TEST_CHANGED_DATABASE',
  );
  const plainMagic = Array.from(before.slice(0, 16), (byte) =>
    String.fromCharCode(byte),
  ).join('');
  assert(plainMagic !== 'SQLite format 3\u0000', 'PLAINTEXT_DATABASE');
  const tampered = new File(directory, 'tampered.sqlite');
  const copy = before.slice();
  // Corrupt page 1, leaving the original encrypted fixture intact.
  copy[100] = (copy[100] ?? 0) ^ 1;
  await tampered.write(copy);
  try {
    await rejects(() => rawConnection(tampered.name, keyA));
  } finally {
    tampered.delete();
  }
}

async function transactionTests(): Promise<void> {
  await rejects(
    () => createVault(WORKSPACE_MIGRATION, true),
    'SYNTHETIC_MIGRATION_INTERRUPTED',
  );
  const migration = await rawConnection(
    databaseFile(WORKSPACE_MIGRATION).name,
    await getKey(WORKSPACE_MIGRATION),
  );
  try {
    const objects = await migration.getFirstAsync<{ n: number }>(
      "SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    );
    const version = await migration.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    assert(
      objects?.n === 0 && version?.user_version === 0,
      'MIGRATION_NOT_ATOMIC',
    );
  } finally {
    await migration.closeAsync();
  }
  const db = await openVault(WORKSPACE_A);
  try {
    await rejects(
      () =>
        transaction(db, async () => {
          await db.runAsync(
            'UPDATE vector SET amount_minor=CAST(? AS INTEGER) WHERE ordinal=0',
            '42',
          );
          throw new Error('SYNTHETIC_WRITE_INTERRUPTED');
        }),
      'SYNTHETIC_WRITE_INTERRUPTED',
    );
    await verifyExact(db, WORKSPACE_A);
    const inaccessible = await db.getAllAsync(
      'SELECT ordinal FROM vector WHERE workspace_id=?',
      WORKSPACE_B,
    );
    assert(inaccessible.length === 0, 'CROSS_WORKSPACE_READ');
    await rejects(() =>
      db.runAsync(
        'INSERT INTO vector VALUES (?, ?, CAST(? AS INTEGER))',
        WORKSPACE_B,
        100,
        '1',
      ),
    );
  } finally {
    await db.closeAsync();
  }
}

export async function runInstrument(): Promise<Report> {
  let previous: Report | undefined;
  if (reportFile.exists)
    previous = JSON.parse(await reportFile.text()) as Report;
  const report: Report = {
    format_version: 1,
    synthetic_only: true,
    platform: Platform.OS,
    os_version: String(Platform.Version),
    phase: 'prepared',
    passed: false,
    checks: {},
    cipher_version: '',
    completed_at_utc: new Date().toISOString(),
  };
  let stage = 'PLATFORM_CHECK';
  try {
    assert(
      Platform.OS === 'android' || Platform.OS === 'ios',
      'NATIVE_PLATFORM_REQUIRED',
    );
    assert(await SecureStore.isAvailableAsync(), 'SECRET_STORE_UNAVAILABLE');
    if (previous?.passed && previous.phase === 'cleaned') return previous;
    if (previous?.passed && previous.phase === 'reopened') {
      await finishInstrument();
      return JSON.parse(await reportFile.text()) as Report;
    }
    if (previous?.passed && previous.phase === 'prepared') {
      report.phase = 'reopened';
      report.checks = {
        ...previous.checks,
        key_recovered_after_process_restart: true,
      };
    } else {
      // A failed/incomplete run remains available for diagnosis and cannot be overwritten.
      assert(
        !databaseFile(WORKSPACE_A).exists && !databaseFile(WORKSPACE_B).exists,
        'EXPLICIT_CLEANUP_REQUIRED',
      );
      stage = 'CREATE_A';
      await createVault(WORKSPACE_A);
      stage = 'CREATE_B';
      await createVault(WORKSPACE_B);
      stage = 'TRANSACTION_TESTS';
      await transactionTests();
      stage = 'NEGATIVE_TESTS';
      await negativeTests();
      report.checks = {
        secure_store: true,
        missing_key_rejected: true,
        wrong_key_rejected: true,
        unkeyed_database_rejected: true,
        workspace_key_isolation: true,
        workspace_query_isolation: true,
        foreign_key_isolation: true,
        ciphertext_header: true,
        tampering_rejected: true,
        existing_database_preserved: true,
        migration_rollback: true,
        write_rollback: true,
      };
    }
    stage = 'VERIFY_EXACT';
    for (const workspace of [WORKSPACE_A, WORKSPACE_B]) {
      const db = await openVault(workspace);
      try {
        await verifyExact(db, workspace);
        const engine = await db.getFirstAsync<{ cipher_version: string }>(
          'PRAGMA cipher_version',
        );
        assert(engine?.cipher_version, 'SQLCIPHER_REQUIRED');
        report.cipher_version = engine.cipher_version;
      } finally {
        await db.closeAsync();
      }
    }
    for (const invalid of INVALID_VECTORS) {
      await rejects(async () => moneyMinor(invalid));
    }
    report.checks.int64_integer_storage = true;
    report.checks.int64_exact_roundtrip = true;
    report.checks.json_decimal_strings = true;
    report.checks.invalid_money_rejected = true;
    report.checks.database_integrity = true;
    report.passed = true;
  } catch (error) {
    report.phase = 'failed';
    // Never copy a native error (which might contain SQL, parameters, paths or a key).
    const code = error instanceof Error ? error.message : '';
    report.error_code = /^[A-Z][A-Z0-9_]{2,80}$/.test(code)
      ? code
      : 'NATIVE_FAILED_' + stage;
  }
  report.completed_at_utc = new Date().toISOString();
  await reportFile.write(JSON.stringify(report));
  return report;
}

export async function finishInstrument(): Promise<void> {
  assert(reportFile.exists, 'REPORT_REQUIRED');
  const report = JSON.parse(await reportFile.text()) as Report;
  assert(
    report.passed && report.phase === 'reopened',
    'RESTART_VERIFICATION_REQUIRED',
  );
  await cleanup();
  for (const workspace of [WORKSPACE_A, WORKSPACE_B, WORKSPACE_MIGRATION]) {
    await rejects(() => getKey(workspace), 'VAULT_KEY_MISSING');
  }
  assert(!directory.exists, 'CLEANUP_FAILED');
  report.phase = 'cleaned';
  report.checks.synthetic_artifacts_removed = true;
  report.completed_at_utc = new Date().toISOString();
  await reportFile.write(JSON.stringify(report));
}
