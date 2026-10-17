import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  fixture,
  tables,
  fixtureStatements,
  loadFixture,
  readSnapshot,
  expectedSnapshot,
} from '../fixtures/loader.mjs';
import { verifyTotals, verifyDocumentVector } from '../fixtures/totals.mjs';
import {
  fixtureChecks,
  validateFixtureEvidence,
} from '../fixtures/evidence.mjs';
import { resourceId } from '../../packages/contracts/dist/identity.js';
import { moneyMinor } from '../../packages/domain/dist/index.js';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
test('FIN-002 is deterministic, versioned and shared exactly between JSON and the portable TS export', () => {
  const result = spawnSync(
    process.execPath,
    ['infra/fixtures/generate.mjs', '--check'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL(
          '../../packages/test-fixtures/fixtures/fin-002.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
    fixture,
  );
  assert.equal(fixture.dataset_id, 'FIN-002');
  assert.equal(fixture.dataset_version, 1);
  assert.equal(fixture.synthetic_only, true);
  assert.deepEqual(
    [...new Set(fixture.seed.map((row) => row.table))].sort(),
    [...tables].sort(),
  );
});
test('canonical rows are deeply immutable, explicitly synthetic and use valid portable UUIDs', () => {
  assert.ok(
    Object.isFrozen(fixture) &&
      Object.isFrozen(fixture.seed) &&
      Object.isFrozen(fixture.seed[0].values),
  );
  assert.throws(() => {
    fixture.seed[0].values.display_name = 'MUTATED';
  }, TypeError);
  for (const row of fixture.seed)
    for (const [key, value] of Object.entries(row.values)) {
      if (
        (key === 'id' || key.endsWith('_id') || key === 'sync_generation') &&
        value !== null
      )
        resourceId(value);
      if (['name', 'display_name'].includes(key))
        assert.match(value, /SYNTHETIC/);
    }
});
test('literal goldens verify references, deleted rows, consumption, cash and signed card credit', () => {
  for (const workspace of [fixture.workspace_a, fixture.workspace_b])
    verifyTotals(expectedSnapshot(workspace), workspace);
  assert.equal(fixture.expected.reports[0].totals.net_expense_minor, '32000');
  assert.equal(fixture.expected.reports[1].totals.cash_out_minor, '12000');
  assert.equal(fixture.expected.wealth[1].liability_balance_minor, '-2000');
});
test('composite fixture rows conserve transfers and pair partial card payments without adding consumption', () => {
  for (const group of fixture.seed.filter(
    (row) => row.table === 'transaction_group',
  )) {
    const movements = fixture.seed
      .filter(
        (row) =>
          row.table === 'financial_transaction' &&
          row.values.group_id === group.values.id,
      )
      .map((row) => row.values);
    assert.equal(movements.length, 2);
    assert.ok(
      movements.every((row) => row.workspace_id === group.values.workspace_id),
    );
    if (group.values.group_type === 'TRANSFER')
      assert.equal(
        movements.reduce(
          (sum, row) => sum + BigInt(row.account_amount_minor),
          0n,
        ),
        0n,
      );
    else {
      assert.ok(
        movements.every((row) => row.economic_kind === 'DEBT_SETTLEMENT'),
      );
      assert.equal(
        movements[0].account_amount_minor,
        movements[1].account_amount_minor,
      );
    }
  }
  assert.ok(
    fixture.seed.some(
      (row) =>
        row.table === 'financial_transaction' &&
        row.values.economic_kind === 'ADJUSTMENT',
    ),
  );
});
test('all monetary fields are canonical i64 strings including unsafe-number and signed limits', () => {
  function walk(value) {
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (key.endsWith('_minor')) {
          assert.equal(typeof child, 'string');
          moneyMinor(child);
        } else walk(child);
      }
  }
  walk(fixture);
  const edges = fixture.seed
    .filter(
      (row) =>
        row.table === 'financial_transaction' &&
        row.values.workspace_id === fixture.workspace_b,
    )
    .map((row) => row.values.account_amount_minor);
  assert.deepEqual(edges, [
    '9223372036854775807',
    '-9223372036854775808',
    '9007199254740993',
    '-9007199254740993',
  ]);
});
test('fixed fixture statements bind every value and reject engine or workspace selection before I/O', async () => {
  for (const engine of ['sqlite', 'postgresql'])
    for (const statement of fixtureStatements(engine, fixture.workspace_a)) {
      assert.equal(
        (statement.sql.match(engine === 'sqlite' ? /\?/g : /\$\d+/g) ?? [])
          .length,
        statement.parameters.length,
      );
      assert.equal(statement.sql.includes('SYNTHETIC'), false);
      assert.equal(statement.sql.includes(fixture.workspace_a), false);
    }
  let called = false;
  await assert.rejects(
    loadFixture(
      {
        exec: async () => {
          called = true;
        },
      },
      'sqlite',
      'unknown',
    ),
    { message: 'FIXTURE_WORKSPACE_INVALID' },
  );
  await assert.rejects(
    loadFixture(
      {
        exec: async () => {
          called = true;
        },
      },
      'mysql',
      fixture.workspace_a,
    ),
    { message: 'FIXTURE_ENGINE_INVALID' },
  );
  assert.equal(called, false);
});
test('SQLite loads the whole canonical fixture atomically and a repeated seed never overwrites financial rows', async () => {
  const sqlite = openProbeDatabase(':memory:');
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    let count = 0;
    await assert.rejects(
      loadFixture(
        {
          ...sqlite.db,
          async run(sql, values) {
            if (++count === 3) throw Error('SYNTHETIC_PRIVATE_LOAD_CANARY');
            await sqlite.db.run(sql, values);
          },
        },
        'sqlite',
        fixture.workspace_a,
      ),
      { message: 'FIXTURE_LOAD_FAILED' },
    );
    assert.ok(
      Object.values(
        (await readSnapshot(sqlite.db, 'sqlite', fixture.workspace_a)).snapshot,
      ).every((rows) => rows.length === 0),
    );
    for (const workspace of [fixture.workspace_a, fixture.workspace_b]) {
      await loadFixture(sqlite.db, 'sqlite', workspace);
      const { snapshot, expected } = await readSnapshot(
        sqlite.db,
        'sqlite',
        workspace,
      );
      assert.deepEqual(snapshot, expected);
      verifyTotals(snapshot, workspace);
      await assert.rejects(loadFixture(sqlite.db, 'sqlite', workspace), {
        message: 'FIXTURE_LOAD_FAILED',
      });
      assert.deepEqual(
        (await readSnapshot(sqlite.db, 'sqlite', workspace)).snapshot,
        expected,
      );
    }
  } finally {
    sqlite.close();
  }
});
test('CT-08 vector has independent item, document and two-payment goldens without claiming a document engine', () => {
  verifyDocumentVector();
  assert.equal(
    fixture.document_search_vector.expected.matched_items_minor,
    '2000',
  );
  assert.equal(
    fixture.document_search_vector.expected.document_total_minor,
    '12000',
  );
  assert.equal(
    fixture.document_search_vector.status,
    'VECTOR_ONLY_DOCUMENT_SCHEMA_PENDING',
  );
});
test('current fixture evidence requires real dual-engine gates, source hashes, cleanup and truthful limitations', () => {
  assert.equal(
    validateFixtureEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-025-fixtures-2026-10-16-us026.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      { matchSources: false },
    ).passed,
    true,
  );
  assert.equal(
    validateFixtureEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-025-fixtures-2026-10-16-us027.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      { matchSources: false },
    ).passed,
    true,
  );
  assert.equal(
    validateFixtureEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-025-fixtures-2026-10-16-us030.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      { matchSources: false },
    ).passed,
    true,
  );
  const load = () =>
    JSON.parse(
      readFileSync(
        new URL(
          '../../docs/quality/evidence/us-025-fixtures-2026-10-17-us034.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  const historical = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-025-fixtures-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(
    validateFixtureEvidence(historical, { matchSources: false }).passed,
    true,
  );
  historical.source_sha256['package.json'] = 'invalid-hash';
  assert.throws(
    () => validateFixtureEvidence(historical, { matchSources: false }),
    /FIXTURE_EVIDENCE_INVALID/,
  );
  assert.equal(validateFixtureEvidence(load()).passed, true);
  for (const gate of fixtureChecks) {
    const r = load();
    delete r.checks[gate];
    assert.throws(() => validateFixtureEvidence(r), /FIXTURE_EVIDENCE_INVALID/);
  }
  for (const change of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.dataset_version = 2;
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.payload = 'PRIVATE_CANARY';
    },
  ]) {
    const r = load();
    change(r);
    assert.throws(() => validateFixtureEvidence(r), /FIXTURE_EVIDENCE_INVALID/);
  }
});
