import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  migrateSqlite,
  normalizedName,
  sqliteMigration,
  sqliteMigrationSha256,
} from '../../packages/storage-schema/dist/index.js';
import {
  seedSyntheticSqlite,
  runSyntheticCases,
} from '../../packages/storage-schema/dist/synthetic-probe.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import {
  validateDualEvidence,
  validateNativeEvidence,
  caseNames,
  dualChecks,
} from '../schema/dual-evidence.mjs';
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL('../../docs/quality/evidence/' + name, import.meta.url),
      'utf8',
    ),
  );
test('SQLite generated artifacts reproduce the versioned schema and shared synthetic corpus', () => {
  assert.equal(
    createHash('sha256').update(sqliteMigration).digest('hex'),
    sqliteMigrationSha256,
  );
  assert.equal(
    readFileSync(
      new URL(
        '../../packages/storage-schema/sqlite/migrations/0001-financial-core.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    sqliteMigration,
  );
  const result = spawnSync(
    process.execPath,
    ['infra/schema/generate-sqlite.mjs', '--check'],
    {
      cwd: new URL('../../', import.meta.url),
      windowsHide: true,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0);
});
test('portable name keys normalize NFKC, whitespace and Portuguese case without changing original text', () => {
  assert.equal(normalizedName('  CAFÉ\t Mensal  '), 'café mensal');
  assert.equal(normalizedName('Ｍｅｒｃａｄｏ'), 'mercado');
  for (const value of ['', ' \n ', null, 123])
    assert.throws(() => normalizedName(value), {
      message: 'STORAGE_NAME_INVALID',
    });
});
test('SQLite runs every shared financial case with i64 and deferred commit invariants', async () => {
  const handle = openProbeDatabase(':memory:');
  try {
    await migrateSqlite(handle.db);
    await seedSyntheticSqlite(handle.db);
    assert.deepEqual(await runSyntheticCases(handle.db), caseNames);
  } finally {
    handle.close();
  }
});
test('interrupted SQLite DDL rolls back the entire schema and never exposes raw driver errors', async () => {
  const handle = openProbeDatabase(':memory:');
  try {
    await assert.rejects(
      migrateSqlite({
        ...handle.db,
        async exec(sql) {
          await handle.db.exec(sql);
          if (sql === sqliteMigration)
            throw new Error('SYNTHETIC_PRIVATE_SQL_CANARY');
        },
      }),
      { message: 'SQLITE_MIGRATION_FAILED' },
    );
    assert.equal(
      (await handle.db.rows("SELECT * FROM sqlite_schema WHERE type='table'"))
        .length,
      0,
    );
  } finally {
    handle.close();
  }
});
test('SQLite migration rejects unavailable FK enforcement without taking over a caller transaction', async () => {
  const handle = openProbeDatabase(':memory:');
  try {
    await handle.db.exec('PRAGMA foreign_keys=OFF;BEGIN');
    await assert.rejects(migrateSqlite(handle.db), {
      message: 'SQLITE_MIGRATION_FAILED',
    });
    await handle.db.exec(
      'CREATE TABLE caller_probe(id INTEGER) STRICT;ROLLBACK',
    );
    assert.equal(
      (await handle.db.rows("SELECT * FROM sqlite_schema WHERE type='table'"))
        .length,
      0,
    );
  } finally {
    handle.close();
  }
});
test('SQLite migration is idempotent and refuses an altered schema checksum', async () => {
  const handle = openProbeDatabase(':memory:');
  try {
    assert.equal(await migrateSqlite(handle.db), true);
    assert.equal(await migrateSqlite(handle.db), false);
    await handle.db.run('UPDATE _schema_migration SET checksum=?', [
      '0'.repeat(64),
    ]);
    await assert.rejects(migrateSqlite(handle.db), {
      message: 'SQLITE_MIGRATION_MISMATCH',
    });
  } finally {
    handle.close();
  }
});
test('dual-engine evidence includes both real engines, every case, gates and current sources', () => {
  const filename = 'us-021-dual-engine-2026-10-16.json';
  assert.equal(validateDualEvidence(fixture(filename)).passed, true);
  for (const mutate of [
    (report) => {
      delete report.engines.postgresql.cases.card_debt_signed;
    },
    (report) => {
      report.checks.commit_guard_cannot_be_bypassed = false;
    },
    (report) => {
      report.payload = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (report) => {
      report.pending = [];
    },
    (report) => {
      report.resources_closed = false;
    },
    (report) => {
      report.source_sha256['infra/schema/sqlite-model.mjs'] = '0'.repeat(64);
    },
  ]) {
    const report = fixture(filename);
    mutate(report);
    assert.throws(
      () => validateDualEvidence(report),
      /DUAL_SCHEMA_EVIDENCE_INVALID/,
    );
  }
  assert.equal(dualChecks.length, 10);
});
test('historical native schema evidence preserves SQLCipher, all cases, reopens and cleanup on each platform', () => {
  for (const filename of [
    'us-021-desktop-2026-10-16.json',
    'us-021-android-2026-10-16.json',
  ]) {
    assert.equal(
      validateNativeEvidence(fixture(filename), { matchSources: false }).passed,
      true,
    );
    for (const mutate of [
      (report) => {
        report.cipher_version = 'plain sqlite';
      },
      (report) => {
        report.checks.synthetic_artifacts_removed = false;
      },
      (report) => {
        delete report.cases.i64_limits_and_precision_neighbors;
      },
      (report) => {
        report.pending = [];
      },
      (report) => {
        report.payload = 'SYNTHETIC_PRIVATE_CANARY';
      },
      (report) => {
        const key = Object.keys(report.source_sha256)[0];
        report.source_sha256[key] = 'invalid-hash';
      },
    ]) {
      const report = fixture(filename);
      mutate(report);
      assert.throws(
        () => validateNativeEvidence(report, { matchSources: false }),
        /NATIVE_SCHEMA_EVIDENCE_INVALID/,
      );
    }
  }
});
