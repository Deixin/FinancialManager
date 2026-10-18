/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  TaxonomyError,
  captureTaxonomyCatalog,
  captureTaxonomyCommand,
  captureTaxonomyQuery,
  planTaxonomy,
  filterTaxonomy,
} from '../../packages/domain/dist/taxonomy.js';
import { createTaxonomyService } from '../../packages/finance-ports/dist/taxonomy.js';
import { createSqliteTaxonomyService } from '../../packages/storage-schema/dist/taxonomy-changes.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
import {
  prepareCategoryTenants,
  createCategoryHarness,
} from '../categories/harness.mjs';
import { runCategoryCases } from '../categories/protocol.mjs';
import {
  createTaxonomyHarness,
  id,
  tenants,
  request,
  grant,
} from '../taxonomy/harness.mjs';
import { runTaxonomyCases, taxonomyCases } from '../taxonomy/protocol.mjs';
import {
  taxonomyChecks,
  validateTaxonomyEvidence,
} from '../taxonomy/evidence.mjs';
import { validateDataAccessSource } from './check-data-access.mjs';
const w = tenants.personal;
const category = {
  id: id(100),
  workspace_id: w,
  name: 'SYNTHETIC PARENT',
  category_scope: 'BOTH',
  sort_order: 0,
  status: 'ACTIVE',
  is_seeded: false,
};
const tag = {
    kind: 'TAG',
    id: id(800),
    workspace_id: w,
    name: 'SYNTHETIC TAG',
    status: 'ACTIVE',
  },
  sub = {
    kind: 'SUBCATEGORY',
    id: id(801),
    workspace_id: w,
    name: 'SYNTHETIC CHILD',
    status: 'ACTIVE',
    category_id: category.id,
    sort_order: 0,
  };
const catalog = () => ({ categories: [category], items: [tag, sub] });
const command = (item = tag) => ({ kind: 'CREATE', item: { ...item } });
const update = (base, item = base) => ({ kind: 'UPDATE', base, item });
const all = { kind: 'ALL', status: 'ALL', category_id: null, search: '' };
test('taxonomy captures immutable catalogs and commands without inventing user structures', () => {
  const raw = catalog(),
    capture = captureTaxonomyCatalog(raw, w);
  raw.items.length = 0;
  assert.equal(capture.items.length, 2);
  assert.ok(Object.isFrozen(capture.items[0]));
  const c = command(),
    captured = captureTaxonomyCommand(c, w);
  c.item.name = 'SYNTHETIC MUTATED';
  assert.equal(captured.item.name, tag.name);
  assert.ok(Object.isFrozen(captured.item));
  assert.deepEqual(
    planTaxonomy(w, { categories: [category], items: [] }, command())[0].after,
    tag,
  );
  assert.deepEqual(planTaxonomy(w, catalog(), command()), []);
  assert.equal(new TaxonomyError('UNEXPECTED').message, 'DATA_ACCESS_FAILED');
});
test('taxonomy rejects unknown fields money parent changes malformed names order status and foreign workspaces', () => {
  for (const mutate of [
    (c) => {
      c.item.amount_minor = '100';
    },
    (c) => {
      c.item.name = '';
    },
    (c) => {
      c.item.name = 'x'.repeat(121);
    },
    (c) => {
      c.item.name = 'SYNTHETIC\nPRIVATE';
    },
    (c) => {
      c.item.workspace_id = id(999);
    },
    (c) => {
      c.item.status = 'ARCHIVED';
    },
    (c) => {
      c.item.kind = 'UNKNOWN';
    },
    (c) => {
      delete c.item.id;
    },
  ]) {
    const c = command();
    mutate(c);
    assert.throws(() => captureTaxonomyCommand(c, w), {
      code: 'INVALID_TAXONOMY_CHANGE',
    });
  }
  assert.throws(() =>
    captureTaxonomyCommand(update(sub, { ...sub, category_id: id(999) }), w),
  );
  for (const sort_order of [0.1, NaN, Infinity, 2147483648, -2147483649])
    assert.throws(() =>
      captureTaxonomyCommand(command({ ...sub, sort_order }), w),
    );
  assert.throws(
    () => captureTaxonomyCatalog({ ...catalog(), items: [sub, sub] }, w),
    { code: 'INVALID_TAXONOMY_STATE' },
  );
  assert.throws(
    () => captureTaxonomyCatalog({ categories: [], items: [sub] }, w),
    { code: 'INVALID_TAXONOMY_STATE' },
  );
  assert.throws(
    () =>
      captureTaxonomyCatalog(
        { ...catalog(), items: Array(10001).fill(tag) },
        w,
      ),
    { code: 'TAXONOMY_LIMIT' },
  );
});
test('taxonomy retains legacy labels on archive while normalizing new names and refusing active aliases', () => {
  const legacy = { ...tag, name: 'SYNTHETIC ' + 'x'.repeat(130) };
  assert.equal(
    planTaxonomy(
      w,
      { categories: [category], items: [legacy] },
      update(legacy, { ...legacy, status: 'ARCHIVED' }),
    )[0].after.name,
    legacy.name,
  );
  assert.throws(
    () =>
      planTaxonomy(
        w,
        catalog(),
        command({ ...tag, id: id(802), name: ' synthetic  tag ' }),
      ),
    { code: 'TAXONOMY_NAME_CONFLICT' },
  );
  const long = {
    ...tag,
    name: ' '.repeat(5) + 'SYNTHETIC CLEAN' + ' '.repeat(5),
  };
  assert.equal(
    captureTaxonomyCommand(command(long), w).item.name,
    'SYNTHETIC CLEAN',
  );
});
test('legacy duplicate subcategory names remain readable and can be archived incrementally', () => {
  const items = [sub, { ...sub, id: id(802) }, { ...sub, id: id(803) }];
  assert.equal(
    captureTaxonomyCatalog({ categories: [category], items }, w).items.length,
    3,
  );
  assert.equal(
    planTaxonomy(
      w,
      { categories: [category], items },
      update(sub, { ...sub, status: 'ARCHIVED' }),
    ).length,
    1,
  );
});
test('taxonomy searches normalized labels and composes parent status and kind filters without modifying the source', () => {
  const raw = catalog(),
    before = structuredClone(raw);
  assert.deepEqual(
    filterTaxonomy(w, raw, {
      ...all,
      kind: 'TAG',
      search: ' synthetic   tag ',
    }),
    [tag],
  );
  assert.deepEqual(
    filterTaxonomy(w, raw, { ...all, category_id: category.id }),
    [sub],
  );
  assert.deepEqual(filterTaxonomy(w, raw, { ...all, status: 'ARCHIVED' }), []);
  assert.deepEqual(raw, before);
  for (const q of [
    { ...all, kind: 'TAG', category_id: category.id },
    { ...all, search: 'x'.repeat(121) },
    { ...all, unexpected: true },
  ])
    assert.throws(() => captureTaxonomyQuery(q));
});
test('taxonomy authorizes before opening persistence and captures every caller-owned input before awaiting', async () => {
  let entered = 0,
    release;
  const waiting = new Promise((r) => {
    release = r;
  });
  const service = createTaxonomyService({
    authorize: () => waiting,
    store: {
      async transaction(scope, run) {
        entered++;
        assert.equal(scope.workspace_id, w);
        return run({
          workspace: async () => ({ storage_mode: 'CLOUD' }),
          catalog: async () => catalog(),
          save: async () => {
            throw Error('SYNTHETIC UNEXPECTED WRITE');
          },
        });
      },
    },
  });
  const req = request(w),
    q = { ...all },
    pending = service.list(req, q);
  req.workspace_id = id(999);
  q.kind = 'UNKNOWN';
  release(grant(request(w)));
  assert.equal((await pending).items.length, 2);
  assert.equal(entered, 1);
  const denied = createTaxonomyService({
    authorize: async () => null,
    store: {
      transaction: () => {
        throw Error('SYNTHETIC STORE TOUCHED');
      },
    },
  });
  await assert.rejects(() => denied.apply(request(w), command()), {
    code: 'ACCESS_DENIED',
  });
  await assert.rejects(() => denied.apply(request(w), undefined), {
    code: 'INVALID_TAXONOMY_CHANGE',
  });
});
test('taxonomy sanitizes storage errors validates authority and rejects malformed persisted IDs', async () => {
  for (const setup of [
    {
      workspace: async () => ({ storage_mode: 'LOCAL' }),
      catalog: async () => catalog(),
      code: 'ACCESS_DENIED',
    },
    {
      workspace: async () => ({ storage_mode: 'CLOUD' }),
      catalog: async () => {
        throw Error('SYNTHETIC PRIVATE CANARY');
      },
      code: 'DATA_ACCESS_FAILED',
    },
    {
      workspace: async () => ({ storage_mode: 'CLOUD' }),
      catalog: async () => ({
        categories: [],
        items: [{ ...tag, id: 'synthetic-invalid' }],
      }),
      code: 'DATA_ACCESS_FAILED',
    },
  ]) {
    const svc = createTaxonomyService({
      authorize: async (r) => grant(r),
      store: {
        transaction: async (_, run) => run({ ...setup, save: async () => {} }),
      },
    });
    await assert.rejects(
      () => svc.list(request(w)),
      (e) =>
        e instanceof TaxonomyError &&
        e.code === setup.code &&
        !e.message.includes('PRIVATE'),
    );
  }
});
test('SQLite taxonomy protocol exercises constraints rollback used associations concurrency and authorization', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  for (const workspace of [fixture.workspace_a, fixture.workspace_b])
    await loadFixture(handle.db, 'sqlite', workspace);
  await prepareCategoryTenants(handle);
  const categories = createCategoryHarness('sqlite', { sqlite: () => handle }),
    h = createTaxonomyHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runCategoryCases(categories, async (_, fn) => fn());
    await runTaxonomyCases(h, async (n, fn) => {
      await fn();
      seen.push(n);
    });
    assert.deepEqual(seen, taxonomyCases);
  } finally {
    await categories.close();
    await h.close();
    handle.close();
  }
});
test('SQLite taxonomy refuses reuse after rollback failure and keeps errors sanitized', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  await prepareCategoryTenants(handle);
  const raw = handle.db;
  let calls = 0;
  const unit = createSqliteTaxonomyService({
    authorize: async (r) => grant(r),
    connection: {
      ...raw,
      async exec(sql) {
        calls++;
        await raw.exec(sql);
        if (sql === 'ROLLBACK') throw Error('SYNTHETIC PRIVATE ROLLBACK');
      },
      async rows(sql, values) {
        calls++;
        if (sql.startsWith('INSERT INTO tag'))
          throw Error('SYNTHETIC PRIVATE WRITE');
        return raw.rows(sql, values);
      },
    },
  });
  try {
    await assert.rejects(() => unit.apply(request(w), command()), {
      code: 'DATA_ACCESS_FAILED',
    });
    const before = calls;
    await assert.rejects(() => unit.list(request(w)), {
      code: 'DATA_ACCESS_FAILED',
    });
    assert.equal(calls, before);
  } finally {
    await unit.close();
    handle.close();
  }
});
test('taxonomy data owners cannot cross into finance and other owners cannot import taxonomy policies', () => {
  for (const file of [
    'packages/persistence-postgres/src/modules/taxonomy-writes.ts',
    'packages/storage-schema/src/revision-adapters/taxonomy-writes.ts',
  ])
    for (const source of [
      "db.selectFrom('financial_transaction')",
      "import pg from 'pg'",
      "import {x} from '../internal/driver.js'",
    ])
      assert.ok(validateDataAccessSource(file, source).length);
  assert.ok(
    validateDataAccessSource(
      'packages/persistence-postgres/src/modules/accounts.ts',
      "import {planTaxonomy} from '@financial-manager/domain/taxonomy'",
    ).length,
  );
});
const evidence = () =>
  JSON.parse(
    readFileSync('docs/quality/evidence/us-045-taxonomy-core-2026-10-18.json'),
  );
test('taxonomy evidence requires every real engine gate cleanup current sources and explicit pending integration', () => {
  assert.equal(validateTaxonomyEvidence(evidence()).passed, true);
  for (const n of taxonomyChecks) {
    const r = evidence();
    delete r.checks[n];
    assert.throws(() => validateTaxonomyEvidence(r));
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
    const r = evidence();
    mutate(r);
    assert.throws(() => validateTaxonomyEvidence(r));
  }
});
