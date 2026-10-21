/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  CounterpartyError,
  captureCounterparty,
  captureCounterparties,
  captureCounterpartyCommand,
  planCounterparty,
  filterCounterparties,
} from '../../packages/domain/dist/counterparties.js';
import { createCounterpartyService } from '../../packages/finance-ports/dist/counterparties.js';
import { createSqliteCounterpartyService } from '../../packages/storage-schema/dist/counterparty-changes.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { prepareCategoryTenants } from '../categories/harness.mjs';
import {
  createCounterpartyHarness,
  tenants,
  id,
  request,
  grant,
} from '../counterparties/harness.mjs';
import {
  item,
  create,
  query,
  update,
  runCounterpartyCases,
  counterpartyCases,
} from '../counterparties/protocol.mjs';
import {
  counterpartiesChecks,
  validateCounterpartyEvidence,
} from '../counterparties/evidence.mjs';
import { validateDataAccessSource } from './check-data-access.mjs';
const w = tenants.personal;
test('counterparties capture detached immutable records commands and exact replay', () => {
  const raw = create(47001),
    copy = captureCounterpartyCommand(raw, w);
  raw.item.display_name = 'SYNTHETIC MUTATED';
  assert.equal(copy.item.display_name, 'SYNTHETIC Comércio');
  assert.ok(Object.isFrozen(copy.item));
  assert.ok(Object.isFrozen(copy));
  const rows = [item(47001)],
    catalog = captureCounterparties(rows, w);
  rows.length = 0;
  assert.equal(catalog.length, 1);
  assert.ok(Object.isFrozen(catalog));
  assert.equal(planCounterparty(w, catalog, copy), null);
  assert.equal(new CounterpartyError('PRIVATE').message, 'DATA_ACCESS_FAILED');
});
test('counterparties reject malformed fields identity unknown payload and incomplete identifiers', () => {
  for (const fields of [
    { display_name: '' },
    { display_name: 'x'.repeat(121) },
    { display_name: ' SYNTHETIC' },
    { display_name: 'SYNTHETIC\nPRIVATE' },
    { status: 'DELETED' },
    { relationship_hint: 'EMPLOYEE' },
    { identifier_type: 'CPF', identifier_value: null },
    { identifier_type: null, identifier_value: 'SYNTHETIC' },
    { identifier_type: 'CPF', identifier_value: '000.000.000-00' },
    { identifier_type: 'CNPJ', identifier_value: '0'.repeat(13) },
    { identifier_type: 'UNKNOWN', identifier_value: 'SYNTHETIC' },
    { identifier_type: 'OTHER', identifier_value: 'x'.repeat(121) },
    { workspace_id: id(999) },
    { id: '' },
    { amount_minor: '100' },
    { original_description: 'SYNTHETIC PRIVATE' },
  ])
    assert.throws(
      () => captureCounterpartyCommand(create(47001, w, fields), w),
      { code: 'INVALID_COUNTERPARTY_CHANGE' },
    );
  assert.throws(() =>
    captureCounterpartyCommand(create(47001, w, { status: 'ARCHIVED' }), w),
  );
  assert.throws(() =>
    captureCounterpartyCommand(update(item(47001), { id: id(47002) }), w),
  );
  assert.throws(() => captureCounterparties([item(1), item(1)], w), {
    code: 'INVALID_COUNTERPARTY_STATE',
  });
  assert.throws(() => captureCounterparties(Array(10001).fill(item(1)), w), {
    code: 'COUNTERPARTY_LIMIT',
  });
  assert.throws(() => captureCounterparty({ ...item(1), extra: true }, w));
  assert.throws(() => captureCounterparties(Array(1), w), {
    code: 'INVALID_COUNTERPARTY_STATE',
  });
});
test('counterparties support homonyms explicit reuse canonical search and immutable identity', () => {
  const rows = [
    item(1),
    item(2, w, { display_name: 'SYNTHETIC COMÉRCIO', status: 'ARCHIVED' }),
  ];
  assert.ok(planCounterparty(w, rows, create(3)));
  assert.equal(
    filterCounterparties(w, rows, query({ search: 'comercio' })).length,
    2,
  );
  assert.deepEqual(
    filterCounterparties(w, rows, query({ status: 'ACTIVE' })).map((r) => r.id),
    [id(1)],
  );
  for (const q of [
    { ...query(), search: 'x'.repeat(121) },
    { ...query(), status: 'UNKNOWN' },
    { ...query(), extra: true },
  ])
    assert.throws(() => filterCounterparties(w, rows, q));
});
test('counterparty service rejects invalid configuration and grants before storage', async () => {
  assert.throws(() => createCounterpartyService({}), {
    code: 'CONFIGURATION_INVALID',
  });
  let calls = 0;
  const store = {
    transaction() {
      calls++;
      throw Error('SYNTHETIC PRIVATE');
    },
  };
  for (const authorize of [
    async () => null,
    async () => {
      throw Error('SYNTHETIC PRIVATE');
    },
    async (r) => ({ ...grant(r), workspace_id: tenants.other }),
    async (r) => ({ ...grant(r), can_manage: 1 }),
  ]) {
    const u = createCounterpartyService({ authorize, store });
    await assert.rejects(() => u.apply(request(w), create(1)), {
      code: 'ACCESS_DENIED',
    });
  }
  const u = createCounterpartyService({
    authorize: async (r) => grant(r),
    store,
  });
  for (const c of [
    null,
    undefined,
    { ...create(1), extra: true },
    create(1, w, { id: '00000000-0000-4000-8000-000000000001' }),
  ])
    await assert.rejects(() => u.apply(request(w), c), {
      code: 'INVALID_COUNTERPARTY_CHANGE',
    });
  await assert.rejects(() => u.list({ ...request(w), extra: true }), {
    code: 'INVALID_COUNTERPARTY_CHANGE',
  });
  assert.equal(calls, 0);
});
test('counterparty catalog limit is enforced before saving the planned result', async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => item(50000 + i));
  let saves = 0;
  const u = createCounterpartyService({
    authorize: async (r) => grant(r),
    store: {
      transaction: async (_, run) =>
        run({
          workspace: async () => ({ storage_mode: 'CLOUD' }),
          catalog: async () => rows,
          save: async () => {
            saves++;
          },
        }),
    },
  });
  await assert.rejects(() => u.apply(request(w), create(49999)), {
    code: 'COUNTERPARTY_LIMIT',
  });
  assert.equal(saves, 0);
});
test('counterparties execute every catalog regression against real SQLite', async () => {
  const sqlite = openProbeDatabase(':memory:');
  let h;
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    for (const workspace of [fixture.workspace_a, fixture.workspace_b])
      await loadFixture(sqlite.db, 'sqlite', workspace);
    await prepareCategoryTenants(sqlite);
    h = createCounterpartyHarness('sqlite', { sqlite: () => sqlite });
    const checks = [];
    await runCounterpartyCases(h, async (n, f) => {
      await f();
      checks.push(n);
    });
    assert.deepEqual(checks, [...counterpartyCases]);
    const u = h.make(tenants.local);
    assert.equal(
      (
        await u.apply(
          { workspace_id: tenants.local },
          create(47999, tenants.local),
        )
      ).changed,
      true,
    );
  } finally {
    await h?.close();
    sqlite.close();
  }
});
test('counterparty SQLite connection is poisoned after rollback failure and errors are sanitized', async () => {
  const sqlite = openProbeDatabase(':memory:');
  await migrateSqliteTo(sqlite.db, { sha256 });
  await prepareCategoryTenants(sqlite);
  let calls = 0;
  const raw = sqlite.db,
    u = createSqliteCounterpartyService({
      authorize: async (r) => grant(r),
      connection: {
        ...raw,
        async exec(sql) {
          calls++;
          await raw.exec(sql);
          if (sql === 'ROLLBACK') throw Error('SYNTHETIC PRIVATE');
        },
        async rows(sql, v) {
          calls++;
          if (sql.startsWith('INSERT INTO counterparty'))
            throw Error('SYNTHETIC PRIVATE');
          return raw.rows(sql, v);
        },
      },
    });
  try {
    await assert.rejects(() => u.apply(request(w), create(1)), {
      code: 'DATA_ACCESS_FAILED',
    });
    const before = calls;
    await assert.rejects(() => u.list(request(w)), {
      code: 'DATA_ACCESS_FAILED',
    });
    assert.equal(calls, before);
  } finally {
    await u.close();
    sqlite.close();
  }
});
test('counterparty owners reject financial writes and unapproved cross owner imports', () => {
  for (const f of [
    'packages/persistence-postgres/src/modules/counterparty-writes.ts',
    'packages/storage-schema/src/revision-adapters/counterparty-writes.ts',
  ]) {
    for (const s of [
      "db.selectFrom('financial_transaction')",
      "import pg from 'pg'",
      "import {x} from '@financial-manager/domain/taxonomy'",
    ])
      assert.ok(validateDataAccessSource(f, s).length);
    assert.deepEqual(validateDataAccessSource(f, readFileSync(f, 'utf8')), []);
  }
  assert.ok(
    validateDataAccessSource(
      'packages/persistence-postgres/src/modules/accounts.ts',
      "import {x} from '@financial-manager/domain/counterparties'",
    ).length,
  );
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-047-counterparties-core-2026-10-20-us050-core.json',
    ),
  );
test('counterparty evidence requires every real engine gate current sources cleanup and integration pending', () => {
  assert.equal(validateCounterpartyEvidence(evidence()).passed, true);
  for (const n of counterpartiesChecks) {
    const r = evidence();
    delete r.checks[n];
    assert.throws(() => validateCounterpartyEvidence(r));
  }
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.financial_payload = 'SYNTHETIC';
    },
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
  ]) {
    const r = structuredClone(evidence());
    mutate(r);
    assert.throws(() => validateCounterpartyEvidence(r));
  }
});
