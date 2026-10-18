/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  categoryDefaults,
  categoryNameKey,
  captureCategoryCommand,
  captureCategories,
  planCategories,
  CategoryError,
} from '../../packages/domain/dist/categories.js';
import { createCategoryService } from '../../packages/finance-ports/dist/categories.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
import {
  createCategoryHarness,
  prepareCategoryTenants,
  request,
  grant,
} from '../categories/harness.mjs';
import {
  runCategoryCases,
  categoryCases,
  id,
  tenants,
  seed,
} from '../categories/protocol.mjs';
import {
  categoryChecks,
  validateCategoryEvidence,
} from '../categories/evidence.mjs';
import { validateDataAccessSource } from './check-data-access.mjs';
const w = tenants.personal;
const create = () => ({
  kind: 'CREATE',
  id: id(990),
  name: 'SYNTHETIC CATEGORY',
  category_scope: 'BOTH',
  sort_order: 0,
});
const seeded = () =>
  planCategories(w, 'PERSONAL', [], seed('PERSONAL', 100)).map((p) => p.after);
const update = (base) => ({
  kind: 'UPDATE',
  base,
  name: base.name,
  sort_order: base.sort_order,
  status: base.status,
});
test('category profiles are purpose-specific immutable suggestions with explicit provenance', () => {
  assert.deepEqual(
    ['PERSONAL', 'BUSINESS', 'OTHER'].map((p) => categoryDefaults(p).length),
    [9, 9, 2],
  );
  const defaults = categoryDefaults('PERSONAL');
  assert.ok(Object.isFrozen(defaults) && Object.isFrozen(defaults[0]));
  assert.ok(seeded().every((r) => r.is_seeded));
  assert.equal(
    planCategories(w, 'PERSONAL', [], create())[0].after.is_seeded,
    false,
  );
  assert.throws(() => categoryDefaults('UNKNOWN'));
  assert.equal(categoryNameKey('  ＳＡＬÁＲＩＯ  '), 'salário');
});
test('category command captures inputs and rejects unknown fields invalid order scope profile or workspace', () => {
  const raw = seed('PERSONAL', 100),
    captured = captureCategoryCommand(raw, w);
  raw.ids[0] = id(999);
  assert.equal(captured.ids[0], id(100));
  assert.ok(Object.isFrozen(captured.ids));
  for (const mutate of [
    (c) => (c.sort_order = 0.1),
    (c) => (c.sort_order = 2147483648),
    (c) => (c.sort_order = -2147483649),
    (c) => (c.sort_order = NaN),
    (c) => (c.name = ''),
    (c) => (c.name = 'x'.repeat(121)),
    (c) => (c.name = 'SYNTHETIC\nPRIVATE'),
    (c) => (c.category_scope = 'UNKNOWN'),
    (c) => (c.status = 'ACTIVE'),
    (c) => delete c.id,
  ]) {
    const c = create();
    mutate(c);
    assert.throws(() => captureCategoryCommand(c, w), {
      code: 'INVALID_CATEGORY_CHANGE',
    });
  }
  for (const value of [
    { ...seed('PERSONAL', 100), profile_version: 2 },
    { ...seed('PERSONAL', 100), ids: Array(9).fill(id(100)) },
    { ...update(seeded()[0]), base: { ...seeded()[0], workspace_id: id(999) } },
  ])
    assert.throws(() => captureCategoryCommand(value, w), {
      code: 'INVALID_CATEGORY_CHANGE',
    });
});
test('seed replay preserves edits archives and user-defined categories instead of resetting defaults', () => {
  const rows = seeded();
  assert.equal(
    planCategories(w, 'PERSONAL', rows, seed('PERSONAL', 100)).length,
    0,
  );
  for (const fields of [
    { name: 'SYNTHETIC RENAMED' },
    { status: 'ARCHIVED' },
    { sort_order: 80 },
  ]) {
    const current = rows.map((r, i) => (i ? r : { ...r, ...fields }));
    assert.throws(
      () => planCategories(w, 'PERSONAL', current, seed('PERSONAL', 100)),
      { code: 'CATEGORY_SEED_CONFLICT' },
    );
  }
  assert.throws(
    () => planCategories(w, 'BUSINESS', [], seed('PERSONAL', 100)),
    { code: 'CATEGORY_SEED_CONFLICT' },
  );
});
test('category update compares complete base and reorder covers all active rows without touching archives', () => {
  const rows = seeded(),
    base = rows[0];
  assert.throws(
    () =>
      planCategories(
        w,
        'PERSONAL',
        rows,
        update({ ...base, is_seeded: false }),
      ),
    { code: 'CATEGORY_BASE_CONFLICT' },
  );
  assert.throws(
    () =>
      planCategories(w, 'PERSONAL', rows, {
        ...update(base),
        name: ' ＳＡＬÁＲＩＯ ',
      }),
    { code: 'CATEGORY_NAME_CONFLICT' },
  );
  const archived = { ...base, status: 'ARCHIVED' },
    current = [archived, ...rows.slice(1)],
    bases = current.filter((r) => r.status === 'ACTIVE'),
    ids = [...bases].reverse().map((r) => r.id),
    plans = planCategories(w, 'PERSONAL', current, {
      kind: 'REORDER',
      bases,
      ids,
    });
  assert.ok(plans.every((p) => p.after.id !== archived.id));
  for (const p of plans)
    assert.equal(p.after.sort_order, ids.indexOf(p.after.id));
  assert.throws(
    () =>
      planCategories(w, 'PERSONAL', current, {
        kind: 'REORDER',
        bases: bases.slice(1),
        ids: ids.filter((i) => i !== bases[0].id),
      }),
    { code: 'CATEGORY_BASE_CONFLICT' },
  );
  assert.throws(() => captureCategories([...rows, rows[0]], w), {
    code: 'INVALID_CATEGORY_STATE',
  });
  assert.throws(() => captureCategories(Array(10001).fill(base), w), {
    code: 'CATEGORY_LIMIT',
  });
});
test('authorization denies category access before storage and invalid apply cannot become a read', async () => {
  let calls = 0,
    auth = 0;
  const service = createCategoryService({
    authorize: async () => {
      auth++;
      return null;
    },
    store: {
      transaction: async () => {
        calls++;
        throw Error('SYNTHETIC PRIVATE');
      },
    },
  });
  await assert.rejects(() => service.apply(request(w), create()), {
    code: 'ACCESS_DENIED',
  });
  await assert.rejects(() => service.apply(request(w), undefined), {
    code: 'INVALID_CATEGORY_CHANGE',
  });
  await assert.rejects(
    () =>
      service.apply(request(w), {
        ...create(),
        id: '0199d044-0000-4000-8000-000000000990',
      }),
    { code: 'INVALID_CATEGORY_CHANGE' },
  );
  assert.equal(calls, 0);
  assert.equal(auth, 1);
  const failure = createCategoryService({
    authorize: async (r) => grant(r),
    store: {
      transaction: async () => {
        throw Error('SYNTHETIC PRIVATE SQL');
      },
    },
  });
  await assert.rejects(
    () => failure.list(request(w)),
    (e) => e.code === 'DATA_ACCESS_FAILED' && !e.message.includes('PRIVATE'),
  );
  assert.equal(
    new CategoryError('SYNTHETIC PRIVATE').message,
    'DATA_ACCESS_FAILED',
  );
});
test('category service captures request and command before awaiting authorization and plans before saves', async () => {
  let release;
  const waiting = new Promise((r) => {
      release = r;
    }),
    saved = [];
  const service = createCategoryService({
    authorize: () => waiting,
    store: {
      transaction: async (_, run) =>
        run({
          workspace: async () => ({
            storage_mode: 'CLOUD',
            purpose: 'PERSONAL',
          }),
          list: async () => [],
          save: async (p) => saved.push(p),
        }),
    },
  });
  const raw = create(),
    req = request(w),
    pending = service.apply(req, raw);
  raw.name = 'SYNTHETIC MUTATED';
  req.workspace_id = id(999);
  release(grant(request(w)));
  await pending;
  assert.equal(saved[0].after.workspace_id, w);
  assert.equal(saved[0].after.name, 'SYNTHETIC CATEGORY');
});
test('SQLite category scenarios use actual constraints rollback isolation and preserve existing financial history', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  for (const workspace of [fixture.workspace_a, fixture.workspace_b])
    await loadFixture(handle.db, 'sqlite', workspace);
  await prepareCategoryTenants(handle);
  const h = createCategoryHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runCategoryCases(h, async (n, fn) => {
      await fn();
      seen.push(n);
    });
    assert.deepEqual(seen, categoryCases);
  } finally {
    await h.close();
    handle.close();
  }
});
test('category data owners cannot query transactions or import drivers and unrelated owners cannot import category API', () => {
  for (const file of [
    'packages/persistence-postgres/src/modules/category-writes.ts',
    'packages/storage-schema/src/revision-adapters/category-writes.ts',
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
      "import {captureCategory} from '@financial-manager/domain/categories'",
    ).length,
  );
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-044-categories-core-2026-10-18-us047-counterparties.json',
    ),
  );
test('category evidence requires every real engine gate cleanup and current source hash', () => {
  assert.equal(validateCategoryEvidence(evidence()).passed, true);
  for (const n of categoryChecks) {
    const r = evidence();
    delete r.checks[n];
    assert.throws(() => validateCategoryEvidence(r));
  }
});
test('category evidence rejects private payloads stale sources and premature desktop or human approval', () => {
  for (const mutate of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) => (r.source_sha256['package.json'] = '0'.repeat(64)),
    (r) => (r.financial_payload = 'SYNTHETIC'),
    (r) => (r.checks.desktop_complete = true),
    (r) => (r.completed_at_utc = 'invalid'),
  ]) {
    const r = structuredClone(evidence());
    mutate(r);
    assert.throws(() => validateCategoryEvidence(r));
  }
});
