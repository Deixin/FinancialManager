import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { createMobileIdentity } from '../../src/identity';
import {
  identityVectors,
  runIdentityProbe,
} from '@financial-manager/contracts/identity-probe';
import {
  seedSyntheticSqlite,
  syntheticCorpus,
} from '@financial-manager/storage-schema/synthetic-probe';
import { migrateSqliteTo } from '@financial-manager/storage-schema/migrations';
import type { SqliteConnection } from '@financial-manager/storage-schema';
const folder = new Directory(Paths.document, 'us023-synthetic'),
  file = new File(Paths.document, 'us023-report.json');
const keyName = 'us023.synthetic.key',
  options: SecureStore.SecureStoreOptions = {
    keychainService: 'com.miudos.financialmanager.us023.synthetic',
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
type Report = {
  format_version: 1;
  synthetic_only: true;
  platform: 'android';
  passed: boolean;
  phase: 'prepared' | 'cleaned';
  same_millisecond_sample_count: 4096;
  checks: Record<string, boolean>;
  cipher_version: string;
  sqlite_version: string;
  failure_stage?: string;
  failure_code?: string;
  failure_operation?: string;
  failure_reason?: string;
};
function check(value: unknown): asserts value {
  if (!value) throw new Error('IDENTITY_NATIVE_FAILED');
}
let failureOperation: string | undefined, failureReason: string | undefined;
function adapter(db: SQLite.SQLiteDatabase): SqliteConnection {
  let call = 0;
  async function invoke<T>(
    kind: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const label = kind + '_' + ++call;
    try {
      return await operation();
    } catch (error) {
      if (!failureOperation) {
        failureOperation = label;
        const text = error instanceof Error ? error.message.toLowerCase() : '';
        failureReason = text.includes('unsafe use')
          ? 'UNSAFE_SCHEMA'
          : text.includes('no such table')
            ? 'MISSING_TABLE'
            : text.includes('syntax error')
              ? 'SYNTAX'
              : text.includes('transaction')
                ? 'TRANSACTION'
                : text.includes('locked')
                  ? 'LOCKED'
                  : text.includes('already exists')
                    ? 'ALREADY_EXISTS'
                    : 'NATIVE_STATEMENT_FAILED';
      }
      throw error;
    }
  }
  return {
    exec: (sql) => invoke('EXEC', () => db.execAsync(sql)),
    run: (sql, values) => invoke('RUN', () => db.runAsync(sql, [...values])),
    rows: (sql, values = []) =>
      invoke('ROWS', () =>
        db.getAllAsync<Record<string, string | number | null>>(sql, [
          ...values,
        ]),
      ),
  };
}
async function open(key: string) {
  check(/^[a-f0-9]{64}$/.test(key));
  const db = await SQLite.openDatabaseAsync(
    'identity.sqlite',
    { useNewConnection: true },
    folder.uri,
  );
  try {
    await db.execAsync(
      `PRAGMA cipher_log_level=NONE;PRAGMA key="x'${key}'";PRAGMA cipher_memory_security=ON;PRAGMA temp_store=MEMORY;PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF;PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL`,
    );
    await db.getFirstAsync('SELECT count(*) FROM sqlite_schema');
    return db;
  } catch {
    await db.closeAsync();
    throw new Error('IDENTITY_NATIVE_OPEN_FAILED');
  }
}
export async function runIdentityNativeProbe(): Promise<Report> {
  let db: SQLite.SQLiteDatabase | undefined,
    stage = 'startup';
  let report: Report = {
    format_version: 1,
    synthetic_only: true,
    platform: 'android',
    passed: false,
    phase: 'prepared',
    same_millisecond_sample_count: 4096,
    checks: {},
    cipher_version: '',
    sqlite_version: '',
  };
  try {
    report.checks = { ...runIdentityProbe(createMobileIdentity) };
    const saved = file.exists
      ? (JSON.parse(file.textSync()) as Report)
      : undefined;
    if (saved?.passed && saved.phase === 'prepared') {
      stage = 'reopen';
      report = { ...saved };
      const key = await SecureStore.getItemAsync(keyName, options);
      check(key);
      db = await open(key);
      const rows = await db.getAllAsync<{ created_at: string }>(
        'SELECT created_at FROM workspace WHERE display_name=? ORDER BY created_at',
        'SYNTHETIC_US023',
      );
      check(rows.length === identityVectors.valid_instants.length);
      for (const [index, value] of identityVectors.valid_instants.entries())
        check(rows[index]?.created_at === value.text);
      await db.closeAsync();
      db = undefined;
      folder.delete();
      await SecureStore.deleteItemAsync(keyName, options);
      check(
        !folder.exists &&
          (await SecureStore.getItemAsync(keyName, options)) === null,
      );
      report.checks.sqlcipher_roundtrip_reopen_and_cleanup = true;
      report.phase = 'cleaned';
      report.passed = true;
    } else {
      stage = 'prepare';
      check(
        !folder.exists &&
          (await SecureStore.getItemAsync(keyName, options)) === null,
      );
      folder.create();
      const bytes = new Uint8Array(32);
      Crypto.getRandomValues(bytes);
      const key = Array.from(bytes, (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      stage = 'secure_store';
      await SecureStore.setItemAsync(keyName, key, options);
      stage = 'open_database';
      db = await open(key);
      stage = 'migration';
      await migrateSqliteTo(adapter(db), {
        async sha256(input) {
          try {
            const digest = await Crypto.digest(
              Crypto.CryptoDigestAlgorithm.SHA256,
              new TextEncoder().encode(input),
            );
            return Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
          } catch (error) {
            failureOperation = 'DIGEST';
            const cause = error as {
              code?: unknown;
              name?: unknown;
              message?: unknown;
            };
            const text = String(cause?.message ?? '').toLowerCase();
            failureReason =
              typeof cause?.code === 'string' && /^[A-Z_]+$/.test(cause.code)
                ? cause.code
                : text.includes('algorithm')
                  ? 'DIGEST_ALGORITHM'
                  : text.includes('argument')
                    ? 'DIGEST_ARGUMENT'
                    : typeof cause?.name === 'string' &&
                        /^[A-Za-z]+Error$/.test(cause.name)
                      ? cause.name
                      : 'NATIVE_DIGEST_FAILED';
            throw error;
          }
        },
      });
      stage = 'seed';
      await seedSyntheticSqlite(adapter(db));
      const identity = createMobileIdentity();
      const account = syntheticCorpus.seed.find(
        (row) => row.table === 'financial_account',
      );
      check(
        account && 'workspace_id' in account.values && 'id' in account.values,
      );
      stage = 'roundtrip';
      await db.execAsync('BEGIN IMMEDIATE');
      for (const [index, value] of identityVectors.valid_instants.entries()) {
        const id = identity.newId();
        await db.runAsync(
          "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,created_at) VALUES(?,'SYNTHETIC_US023','PERSONAL','LOCAL','BRL',?,?)",
          id,
          identity.newId(),
          value.text,
        );
        const row = await db.getFirstAsync<{ id: string; created_at: string }>(
          'SELECT id,created_at FROM workspace WHERE id=?',
          id,
        );
        check(row?.id === id && row.created_at === value.text);
        const day =
          identityVectors.valid_dates[
            index % identityVectors.valid_dates.length
          ]!;
        const reference = identity.newId();
        await db.runAsync(
          "INSERT INTO balance_reference(id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status,created_at) VALUES(?,?,?,0,?,'START_OF_DAY','MANUAL','SUPERSEDED',?)",
          reference,
          account.values.workspace_id,
          account.values.id,
          day,
          value.text,
        );
        const date = await db.getFirstAsync<{ reference_date: string }>(
          'SELECT reference_date FROM balance_reference WHERE id=?',
          reference,
        );
        check(date?.reference_date === day);
      }
      await db.execAsync('COMMIT');
      const cipher = await db.getFirstAsync<{ cipher_version: string }>(
        'PRAGMA cipher_version',
      );
      const sqlite = await db.getFirstAsync<{ version: string }>(
        'SELECT sqlite_version() AS version',
      );
      report.cipher_version = String(cipher?.cipher_version);
      report.sqlite_version = String(sqlite?.version);
      check(/^4\./.test(report.cipher_version));
      await db.closeAsync();
      db = undefined;
      report.passed = true;
    }
  } catch (error) {
    report.passed = false;
    report.failure_stage = stage;
    if (failureOperation) report.failure_operation = failureOperation;
    if (failureReason) report.failure_reason = failureReason;
    report.failure_code =
      error instanceof Error &&
      /^(MIGRATION_[A-Z_]+|IDENTITY_[A-Z_]+|SYNTHETIC_[A-Z_]+)$/.test(
        error.message,
      )
        ? error.message
        : 'IDENTITY_NATIVE_FAILURE';
  } finally {
    await db?.closeAsync().catch(() => {});
    file.write(JSON.stringify(report));
  }
  return report;
}
