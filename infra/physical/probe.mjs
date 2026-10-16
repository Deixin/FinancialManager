import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { uuidText, dateText, instantText, decimalText } from './types.mjs';

export const migration = readFileSync(
  new URL('./migrations/0001-synthetic-types.sql', import.meta.url),
  'utf8',
);
export const schemaHash = createHash('sha256').update(migration).digest('hex');
export const fixture = {
  workspace: '00000000-0000-4000-8000-000000000001',
  otherWorkspace: '00000000-0000-4000-8000-000000000002',
  // Fixed UUIDv7 vectors. This probe does not generate IDs or test entropy.
  ids: [
    '01890f3e-7c00-7000-8000-000000000001',
    '01890f3e-7c00-7000-8000-000000000002',
    '01890f3e-7c01-7000-8000-000000000001',
  ],
  instants: [
    '2026-10-16T00:00:00.000Z',
    '2026-10-16T00:00:00.001Z',
    '2026-10-16T23:59:59.999Z',
  ],
  decimals: [
    '9007199254740993.000000000000000001',
    '-0.000000000000000001',
    '123456789012345678901234567890.123456789',
  ],
};
function open(filename, sql = migration) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;',
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='schema_version'")
        .get()
    ) {
      const rows = db.prepare('SELECT * FROM schema_version').all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].version, 1);
      assert.equal(rows[0].checksum, checksum);
    } else {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version VALUES(1,?)').run(checksum);
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* Closing releases any transaction. */
    }
    db.close();
    throw error;
  }
}
export function runProbe(filename) {
  const checks = {};
  let db;
  try {
    assert.throws(() =>
      open(filename, migration + '\nSELECT nonexistent_synthetic_function();'),
    );
    db = new DatabaseSync(filename);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
        .get().n,
      0,
    );
    db.close();
    db = undefined;
    db = open(filename);
    db.close();
    db = undefined;
    assert.throws(() => open(filename, migration + '\n-- changed'));
    db = open(filename);
    checks.atomic_migration_and_checksum = true;
    const insert = db.prepare('INSERT INTO sample VALUES(?,?,?,?,?)');
    db.exec('BEGIN IMMEDIATE');
    for (let index = fixture.ids.length - 1; index >= 0; index--)
      insert.run(
        uuidText(fixture.workspace),
        uuidText(fixture.ids[index]),
        dateText('2024-02-29'),
        instantText(fixture.instants[index]),
        decimalText(fixture.decimals[index]),
      );
    db.exec('COMMIT');
    const rows = db
      .prepare('SELECT * FROM sample ORDER BY id COLLATE BINARY')
      .all();
    assert.deepEqual(
      rows.map((row) => row.id),
      fixture.ids,
    );
    for (const row of rows) assert.equal(typeof row.id, 'string');
    assert.equal(JSON.parse(JSON.stringify(rows))[0].id, fixture.ids[0]);
    assert.throws(() =>
      insert.run(
        fixture.workspace,
        fixture.ids[0],
        '2024-02-29',
        fixture.instants[0],
        fixture.decimals[0],
      ),
    );
    checks.uuid_text_roundtrip_uniqueness_and_v7_vector_order = true;
    for (const value of [
      fixture.ids[0].toUpperCase(),
      fixture.ids[0].replaceAll('-', ''),
      'not-a-uuid',
      '00000000-0000-0000-0000-000000000000',
    ]) {
      assert.throws(() => uuidText(value), { code: 'INVALID_UUID' });
      assert.throws(() =>
        insert.run(
          fixture.workspace,
          value,
          '2024-02-29',
          fixture.instants[0],
          fixture.decimals[0],
        ),
      );
    }
    checks.uuid_noncanonical_and_nil_rejected = true;
    db.prepare('INSERT INTO sample_link VALUES(?,?)').run(
      fixture.workspace,
      fixture.ids[0],
    );
    assert.throws(() =>
      db
        .prepare('INSERT INTO sample_link VALUES(?,?)')
        .run(fixture.otherWorkspace, fixture.ids[0]),
    );
    checks.composite_workspace_foreign_key = true;
    const chronological = db
      .prepare(
        'SELECT recorded_at,occurred_on FROM sample ORDER BY recorded_at COLLATE BINARY',
      )
      .all();
    assert.deepEqual(
      chronological.map((row) => row.recorded_at),
      fixture.instants,
    );
    assert.ok(chronological.every((row) => row.occurred_on === '2024-02-29'));
    checks.utc_millisecond_text_roundtrip_and_order = true;
    for (const value of [
      '2026-10-16T00:00:00Z',
      '2026-10-16T00:00:00.000000Z',
      '2026-10-15T21:00:00.000-03:00',
      '2026-02-30T00:00:00.000Z',
      '2026-10-16T24:00:00.000Z',
    ]) {
      assert.throws(() => instantText(value), { code: 'INVALID_INSTANT' });
      assert.throws(() =>
        db.prepare('UPDATE sample SET recorded_at=?').run(value),
      );
    }
    checks.offset_precision_and_invalid_instants_rejected = true;
    for (const value of [
      '2026-02-29',
      '2026-04-31',
      '16/10/2026',
      '0000-01-01',
    ]) {
      assert.throws(() => dateText(value), { code: 'INVALID_DATE' });
      assert.throws(() =>
        db.prepare('UPDATE sample SET occurred_on=?').run(value),
      );
    }
    checks.financial_date_calendar_validation = true;
    assert.deepEqual(
      rows.map((row) => row.exact_value),
      fixture.decimals,
    );
    assert.ok(
      db
        .prepare('SELECT typeof(exact_value) AS storage FROM sample')
        .all()
        .every((row) => row.storage === 'text'),
    );
    for (const value of ['1.0', '1e3', '01', '-0', 1.5])
      assert.throws(() => decimalText(value), {
        code: 'INVALID_DECIMAL_EXACT',
      });
    checks.decimal_exact_text_preserves_precision = true;
    const before = JSON.stringify(rows);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE sample SET recorded_at=?').run(
      '2026-10-17T00:00:00.000Z',
    );
    db.exec('ROLLBACK');
    assert.equal(
      JSON.stringify(
        db.prepare('SELECT * FROM sample ORDER BY id COLLATE BINARY').all(),
      ),
      before,
    );
    db.close();
    db = undefined;
    db = open(filename);
    assert.equal(
      JSON.stringify(
        db.prepare('SELECT * FROM sample ORDER BY id COLLATE BINARY').all(),
      ),
      before,
    );
    checks.rollback_and_persistent_reopen = true;
    return {
      format_version: 1,
      synthetic_only: true,
      scope: 'sqlite-physical-representations',
      passed: true,
      checks,
      schema_sha256: schemaHash,
      sqlite_version: db.prepare('SELECT sqlite_version() AS version').get()
        .version,
    };
  } finally {
    db?.close();
  }
}
