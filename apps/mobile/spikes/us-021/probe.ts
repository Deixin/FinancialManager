import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import {
  migrateSqlite,
  sqliteMigration,
} from '@financial-manager/storage-schema';
import type { SqliteConnection } from '@financial-manager/storage-schema';
import {
  syntheticCorpus,
  seedSyntheticSqlite,
  runSyntheticCases,
} from '@financial-manager/storage-schema/synthetic-probe';
const folder = new Directory(Paths.document, 'us021-synthetic');
const reportFile = new File(Paths.document, 'us021-report.json');
const databaseFile = new File(folder, 'financial.sqlite');
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'com.miudos.financialmanager.us021.synthetic',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const keyName = 'us021.synthetic.key';
type Report = {
  format_version: 1;
  synthetic_only: true;
  platform: 'android';
  passed: boolean;
  phase: 'prepared' | 'cleaned';
  cases: Record<string, boolean>;
  checks: Record<string, boolean>;
  cipher_version: string;
  sqlite_version: string;
  failure_stage?: string;
};
let stage = 'startup';
function requireCheck(value: unknown): asserts value {
  if (!value) throw new Error('NATIVE_SCHEMA_CHECK_FAILED');
}
async function open(key?: string) {
  const db = await SQLite.openDatabaseAsync(
    'financial.sqlite',
    { useNewConnection: true },
    folder.uri,
  );
  try {
    await db.execAsync('PRAGMA cipher_log_level=NONE');
    if (key !== undefined) {
      requireCheck(/^[a-f0-9]{64}$/.test(key));
      await db.execAsync(`PRAGMA key="x'${key}'"`);
    }
    await db.getFirstAsync('SELECT count(*) FROM sqlite_schema');
    await db.execAsync(
      'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA temp_store=MEMORY;PRAGMA cipher_memory_security=ON;PRAGMA trusted_schema=OFF',
    );
    return db;
  } catch {
    await db.closeAsync();
    throw new Error('NATIVE_SCHEMA_OPEN_REJECTED');
  }
}
function adapter(db: SQLite.SQLiteDatabase): SqliteConnection {
  return {
    exec: (sql) => db.execAsync(sql),
    run: (sql, values) => db.runAsync(sql, [...values]),
    rows: (sql, values = []) =>
      db.getAllAsync<Record<string, string | number | null>>(sql, [...values]),
  };
}
export async function runNativeProbe(): Promise<Report> {
  let db: SQLite.SQLiteDatabase | undefined;
  let report: Report = {
    format_version: 1,
    synthetic_only: true,
    platform: 'android',
    passed: false,
    phase: 'prepared',
    cases: {},
    checks: {},
    cipher_version: '',
    sqlite_version: '',
  };
  try {
    if (reportFile.exists) {
      report = JSON.parse(await reportFile.text()) as Report;
      requireCheck(
        report.format_version === 1 &&
          report.synthetic_only === true &&
          report.passed === true,
      );
      if (report.phase === 'cleaned') return report;
      stage = 'reopen_after_restart';
      const key = await SecureStore.getItemAsync(keyName, options);
      requireCheck(key !== null);
      db = await open(key);
      const query = syntheticCorpus.cases[0].query;
      requireCheck(
        JSON.stringify(await adapter(db).rows(query.sql, query.parameters)) ===
          JSON.stringify(query.rows),
      );
      report.checks.native_secret_persisted = true;
      report.checks.reopened_balance = true;
      await db.closeAsync();
      db = undefined;
      stage = 'cleanup';
      folder.delete();
      await SecureStore.deleteItemAsync(keyName, options);
      requireCheck(
        !folder.exists &&
          (await SecureStore.getItemAsync(keyName, options)) === null,
      );
      report.checks.synthetic_artifacts_removed = true;
      report.phase = 'cleaned';
    } else {
      stage = 'prepare';
      requireCheck(!folder.exists);
      folder.create();
      const bytes = await Crypto.getRandomBytesAsync(32);
      const key = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      await SecureStore.setItemAsync(keyName, key, options);
      requireCheck((await SecureStore.getItemAsync(keyName, options)) === key);
      report.checks.secure_store = true;
      db = await open(key);
      const port = adapter(db);
      stage = 'migration_rollback';
      await port.exec('BEGIN IMMEDIATE');
      await port.exec(sqliteMigration);
      let rejected = false;
      try {
        await port.exec('SELECT 1 FROM deliberately_missing_table');
      } catch {
        rejected = true;
      }
      await port.exec('ROLLBACK');
      requireCheck(
        rejected &&
          (await port.rows("SELECT name FROM sqlite_schema WHERE type='table'"))
            .length === 0,
      );
      report.checks.migration_rollback = true;
      stage = 'migration';
      requireCheck(await migrateSqlite(port));
      requireCheck(!(await migrateSqlite(port)));
      report.checks.migration_idempotent = true;
      stage = 'shared_corpus';
      await seedSyntheticSqlite(port);
      const cases = await runSyntheticCases(port);
      report.cases = Object.fromEntries(cases.map((name) => [name, true]));
      stage = 'integrity';
      requireCheck(
        (await port.rows('PRAGMA integrity_check'))[0]?.integrity_check ===
          'ok',
      );
      requireCheck((await port.rows('PRAGMA foreign_key_check')).length === 0);
      report.checks.database_integrity = true;
      const cipher = await port.rows('PRAGMA cipher_version');
      const sqlite = await port.rows('SELECT sqlite_version() AS version');
      report.cipher_version = String(Object.values(cipher[0] ?? {})[0]);
      report.sqlite_version = String(sqlite[0]?.version);
      requireCheck(/^4\./.test(report.cipher_version));
      await db.closeAsync();
      db = undefined;
      stage = 'ciphertext';
      const encrypted = await databaseFile.bytes();
      requireCheck(
        Array.from(encrypted.slice(0, 16))
          .map((b) => String.fromCharCode(b))
          .join('') !== 'SQLite format 3\0',
      );
      report.checks.ciphertext_header = true;
      for (const [name, wrong] of [
        ['wrong_key_rejected', '0'.repeat(64)],
        ['unkeyed_open_rejected', undefined],
      ] as const) {
        let denied = false;
        try {
          const opened = await open(wrong);
          await opened.closeAsync();
        } catch {
          denied = true;
        }
        requireCheck(denied);
        report.checks[name] = true;
      }
      report.passed = true;
    }
  } catch {
    report.passed = false;
    report.failure_stage = stage;
  } finally {
    await db?.closeAsync();
  }
  reportFile.write(JSON.stringify(report));
  return report;
}
