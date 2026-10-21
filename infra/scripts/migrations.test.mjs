import {
  readEvidenceFile as readFileSync,
  currentEvidenceValidator,
} from '../validation/evidence.mjs';
import assert from 'node:assert/strict';

import test from 'node:test';
import {
  migrateSqliteTo,
  sqliteCatalog,
  verifyMigrations,
  planMigrations,
  migrationContent,
  assertSchemaCompatibility,
} from '../../packages/storage-schema/dist/migrations.js';
import { migrateSqlite } from '../../packages/storage-schema/dist/index.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { sha256, migratePostgresTo } from '../schema/postgres-migrations.mjs';
import {
  migrationGates,
  validateMigrationEvidence as rawValidateMigrationEvidence,
} from '../schema/migration-evidence.mjs';

const validateMigrationEvidence = currentEvidenceValidator(
  rawValidateMigrationEvidence,
);

test('migration catalog verifies both directions, ordering and safety classification', async () => {
  assert.equal((await verifyMigrations(sqliteCatalog, sha256)).length, 2);
  for (const change of [
    (entry) => ({ ...entry, up: entry.up + '\n-- changed' }),
    (entry) => ({ ...entry, down: entry.down + '\n-- changed' }),
    (entry) => ({ ...entry, destructive: true }),
    (entry) => ({ ...entry, name: 'changed' }),
  ])
    await assert.rejects(
      verifyMigrations([sqliteCatalog[0], change(sqliteCatalog[1])], sha256),
      /MIGRATION_CHECKSUM_MISMATCH/,
    );
  await assert.rejects(
    verifyMigrations([sqliteCatalog[1]], sha256),
    /MIGRATION_CATALOG_INVALID/,
  );
});
test('migration planner rejects gaps, unknown versions and any unsupported inverse before DDL', () => {
  const history = sqliteCatalog.map(({ version, checksum }) => ({
    version,
    checksum,
  }));
  for (const rows of [
    [history[1]],
    [...history, { version: 3, checksum: '0'.repeat(64) }],
  ])
    assert.throws(
      () => planMigrations(sqliteCatalog, rows, 1),
      /MIGRATION_HISTORY_INVALID/,
    );
  assert.throws(
    () =>
      planMigrations(
        sqliteCatalog,
        [{ ...history[0], checksum: '0'.repeat(64) }],
        2,
      ),
    /MIGRATION_CHECKSUM_MISMATCH/,
  );
  assert.throws(
    () =>
      planMigrations(
        [{ ...sqliteCatalog[0] }, { ...sqliteCatalog[1], down: null }],
        history,
        1,
      ),
    /MIGRATION_DOWN_UNSUPPORTED/,
  );
  assert.deepEqual(
    planMigrations(sqliteCatalog, history, 1).map((item) => [
      item.migration.version,
      item.direction,
    ]),
    [[2, 'down']],
  );
});
test('schema compatibility requires an explicit valid version window', () => {
  assert.doesNotThrow(() =>
    assertSchemaCompatibility(2, { minimum: 1, maximum: 2 }),
  );
  for (const [version, window] of [
    [0, { minimum: 1, maximum: 2 }],
    [3, { minimum: 1, maximum: 2 }],
    [1, { minimum: 2, maximum: 1 }],
    [1.5, { minimum: 1, maximum: 2 }],
  ])
    assert.throws(
      () => assertSchemaCompatibility(version, window),
      /MIGRATION_SCHEMA_INCOMPATIBLE/,
    );
});
test('SQLite upgrades legacy history, downgrades only the derived index and repeats idempotently', async () => {
  const sqlite = openProbeDatabase(':memory:');
  try {
    await migrateSqlite(sqlite.db);
    assert.deepEqual(await migrateSqliteTo(sqlite.db, { sha256 }), {
      from: 1,
      to: 2,
      applied: 1,
    });
    assert.deepEqual(await migrateSqliteTo(sqlite.db, { sha256 }), {
      from: 2,
      to: 2,
      applied: 0,
    });
    await assert.rejects(migrateSqlite(sqlite.db), /SQLITE_MIGRATION_MISMATCH/);
    assert.deepEqual(await migrateSqliteTo(sqlite.db, { sha256, target: 1 }), {
      from: 2,
      to: 1,
      applied: 1,
    });
    assert.equal(await migrateSqlite(sqlite.db), false);
    assert.deepEqual(await migrateSqliteTo(sqlite.db, { sha256 }), {
      from: 1,
      to: 2,
      applied: 1,
    });
  } finally {
    sqlite.close();
  }
});
test('SQLite rolls back DDL and metadata when a later step fails', async () => {
  const sqlite = openProbeDatabase(':memory:');
  try {
    await migrateSqlite(sqlite.db);
    const version3 = {
      version: 3,
      name: 'synthetic-invalid-sql',
      up: 'CREATE TABLE synthetic_partial(id INTEGER); INSERT INTO missing_table VALUES(1);',
      down: 'DROP TABLE synthetic_partial;',
      destructive: false,
    };
    version3.checksum = await sha256(migrationContent(version3));
    await assert.rejects(
      migrateSqliteTo(sqlite.db, {
        sha256,
        catalog: [...sqliteCatalog, version3],
      }),
      /^Error: MIGRATION_FAILED$/,
    );
    assert.equal(
      (await sqlite.db.rows('SELECT version FROM _schema_migration')).length,
      1,
    );
    assert.deepEqual(
      await sqlite.db.rows(
        "SELECT name FROM sqlite_schema WHERE name IN ('balance_reference_lookup','synthetic_partial','_schema_migration_v1')",
      ),
      [],
    );
    await assert.rejects(
      sqlite.db.run('INSERT INTO _schema_migration VALUES(2,?)', [
        '0'.repeat(64),
      ]),
    );
  } finally {
    sqlite.close();
  }
});
test('destructive migration fails before touching the database', async () => {
  const entry = { ...sqliteCatalog[1], destructive: true };
  entry.checksum = await sha256(migrationContent(entry));
  let touched = false;
  const db = {
    exec: async () => {
      touched = true;
    },
    rows: async () => {
      touched = true;
      return [];
    },
    run: async () => {
      touched = true;
    },
  };
  await assert.rejects(
    migrateSqliteTo(db, { sha256, catalog: [sqliteCatalog[0], entry] }),
    /MIGRATION_DESTRUCTIVE_UNSUPPORTED/,
  );
  assert.equal(touched, false);
});
test('migration failures never expose driver errors and discard a failed PostgreSQL rollback', async () => {
  const secret = 'SYNTHETIC_PRIVATE_MIGRATION_CANARY';
  await assert.rejects(
    migratePostgresTo({
      connect: async () => {
        throw new Error(secret);
      },
    }),
    /^Error: MIGRATION_FAILED$/,
  );
  let discarded = false;
  await assert.rejects(
    migratePostgresTo({
      connect: async () => ({
        query: async (sql) => {
          if (sql !== 'BEGIN') throw new Error(secret);
        },
        release: (value) => {
          discarded = value;
        },
      }),
    }),
    /^Error: MIGRATION_FAILED$/,
  );
  assert.equal(discarded, true);
});
test('archived migration evidence binds current sources, interruptions, corpus and cleanup', () => {
  const load = () =>
    JSON.parse(
      readFileSync(
        new URL(
          '../../docs/quality/evidence/us-022-migrations-2026-10-17-us040-core.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  assert.equal(validateMigrationEvidence(load()).passed, true);
  for (const gate of migrationGates) {
    const report = load();
    report.checks[gate] = false;
    assert.throws(
      () => validateMigrationEvidence(report),
      /MIGRATION_EVIDENCE_INVALID/,
    );
  }
  for (const mutate of [
    (r) => {
      r.source_sha256['infra/schema/migration-worker.mjs'] = '0'.repeat(64);
    },
    (r) => {
      r.payload = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (r) => {
      r.interruptions_per_engine = 0;
    },
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
  ]) {
    const report = load();
    mutate(report);
    assert.throws(
      () => validateMigrationEvidence(report),
      /MIGRATION_EVIDENCE_INVALID/,
    );
  }
});
