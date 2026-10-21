import {
  readEvidenceFile as readFileSync,
  currentEvidenceValidator,
} from '../validation/evidence.mjs';
/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureAllocation,
  allocationChange,
  validateAllocationPlan,
  AllocationError,
} from '../../packages/domain/dist/classification.js';
import {
  captureRevisionState,
  planTransactionRevision,
} from '../../packages/domain/dist/revisions.js';
import { createAllocationService } from '../../packages/finance-ports/dist/classification.js';
import { initialState, ids } from '../revisions/scenarios.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { prepareCategoryTenants } from '../categories/harness.mjs';
import { createAllocationHarness, id } from '../allocations/harness.mjs';
import {
  allocationCases,
  runAllocationCases,
  replace,
  clear,
  parcel,
} from '../allocations/protocol.mjs';
import {
  allocationChecks,
  validateAllocationEvidence as rawValidateAllocationEvidence,
} from '../allocations/evidence.mjs';

const validateAllocationEvidence = currentEvidenceValidator(
  rawValidateAllocationEvidence,
);

const w = ids.a;
const base = (patch) => {
  const r = initialState(ids.expense);
  return captureRevisionState({
    ...r,
    content: { ...r.content, allocations: [], tag_ids: [], ...patch },
  });
};
const command = () =>
  replace(base(), [
    parcel(5001, 10, '12000', 30, 'SYNTHETIC NOTE'),
    parcel(5002, 13, '8000'),
  ]);
const catalog = () => ({
  categories: [10, 11, 12, 13].map((n) => ({
    id: id(n),
    workspace_id: w,
    name: 'SYNTHETIC CATEGORY ' + n,
    category_scope: n === 11 ? 'INCOME' : n === 12 ? 'BOTH' : 'EXPENSE',
    sort_order: n,
    status: 'ACTIVE',
    is_seeded: false,
  })),
  items: [
    {
      kind: 'SUBCATEGORY',
      id: id(30),
      workspace_id: w,
      category_id: id(10),
      name: 'SYNTHETIC SUB',
      sort_order: 0,
      status: 'ACTIVE',
    },
  ],
});
const plan = (c) =>
  planTransactionRevision(
    w,
    c.base,
    allocationChange(c),
    '2026-10-18T12:00:00.000Z',
  );
test('allocation intent freezes exact parcels and preserves every other financial field and tags', () => {
  const input = command(),
    c = captureAllocation(input, w);
  input.allocation.allocations[0].note = 'SYNTHETIC MUTATED';
  input.allocation.allocations[0].amount_minor = '1';
  assert.equal(c.allocation.allocations[0].note, 'SYNTHETIC NOTE');
  assert.ok(Object.isFrozen(c.allocation.allocations[0]));
  const p = plan(c);
  validateAllocationPlan(c, p, catalog(), w);
  for (const key of Object.keys(c.base.content).filter(
    (k) => k !== 'allocations',
  ))
    assert.deepEqual(p.after.content[key], c.base.content[key]);
  assert.equal(p.after.version, '2');
  assert.deepEqual(p.snapshot.before, c.base);
});
test('allocation uses wider exact intermediates for i64 minimum and rejects a one-cent difference and floats', () => {
  const c = replace(base({ account_amount_minor: '-9223372036854775808' }), [
    parcel(5101, 10, '9223372036854775807'),
    parcel(5102, 13, '1'),
  ]);
  assert.equal(allocationChange(c).content.allocations[1].amount_minor, '1');
  for (const amount of ['7999', '8001'])
    assert.throws(
      () =>
        captureAllocation(
          replace(base(), [
            parcel(5001, 10, '12000'),
            parcel(5002, 13, amount),
          ]),
          w,
        ),
      { code: 'ALLOCATION_TOTAL_MISMATCH' },
    );
  for (const amount of ['0', '-1', '01', '1.0', 1, '9223372036854775808'])
    assert.throws(
      () => captureAllocation(replace(base(), [parcel(5001, 10, amount)]), w),
      { code: 'INVALID_ALLOCATION_CHANGE' },
    );
});
test('allocation validates catalog workspace scope parent and retained archived references', () => {
  const c = command();
  for (const mutate of [
    (r) => {
      r.categories[0].status = 'ARCHIVED';
    },
    (r) => {
      r.items[0].status = 'ARCHIVED';
    },
    (r) => {
      r.items[0].category_id = id(13);
    },
    (r) => {
      r.categories[0].workspace_id = ids.b;
    },
  ]) {
    const raw = catalog();
    mutate(raw);
    assert.throws(() => validateAllocationPlan(c, plan(c), raw, w));
  }
  const wrong = replace(base(), [parcel(5001, 11, '20000')]);
  assert.throws(
    () => validateAllocationPlan(wrong, plan(wrong), catalog(), w),
    { code: 'ALLOCATION_SCOPE_MISMATCH' },
  );
  const existing = plan(c).after,
    kept = replace(existing, [
      parcel(5001, 10, '11000', 30, 'SYNTHETIC REVISED'),
      parcel(5002, 13, '9000'),
    ]),
    archived = catalog();
  archived.categories[0].status = 'ARCHIVED';
  archived.items[0].status = 'ARCHIVED';
  validateAllocationPlan(kept, plan(kept), archived, w);
  const moved = replace(existing, [parcel(5003, 10, '20000', 30)]);
  assert.throws(() => validateAllocationPlan(moved, plan(moved), archived, w), {
    code: 'ALLOCATION_REFERENCE_UNAVAILABLE',
  });
});
test('allocation rejects forged bases and plans with unrelated financial or tag changes', () => {
  const c = command(),
    p = plan(c),
    forged = structuredClone(c);
  forged.base.content.display_name = 'SYNTHETIC FORGED';
  assert.throws(() => validateAllocationPlan(forged, p, catalog(), w), {
    code: 'ALLOCATION_BASE_CONFLICT',
  });
  for (const content of [
    { ...p.after.content, display_name: 'SYNTHETIC CHANGED' },
    { ...p.after.content, tag_ids: [id(20)] },
  ])
    assert.throws(
      () =>
        validateAllocationPlan(
          c,
          { ...p, after: { ...p.after, content } },
          catalog(),
          w,
        ),
      { code: 'INVALID_ALLOCATION_CHANGE' },
    );
});
test('allocation requires explicit clear and bounded complete shapes and refuses deleted movements', () => {
  const c = command();
  for (const invalid of [
    { ...c, tag_ids: [] },
    { ...c, allocation: { kind: 'KEEP', extra: true } },
    replace(base(), []),
    replace(base(), [parcel(5001, 10, '10000'), parcel(5001, 13, '10000')]),
    { ...c, base: { ...base(), workspace_id: ids.b } },
    replace(
      base(),
      Array.from({ length: 1001 }, (_, n) => parcel(7000 + n, 10, '1')),
    ),
  ])
    assert.throws(() => captureAllocation(invalid, w), {
      code: 'INVALID_ALLOCATION_CHANGE',
    });
  const b = plan(c).after;
  assert.deepEqual(allocationChange(clear(b)).content.allocations, []);
  const deleted = captureRevisionState({
    ...b,
    deleted_at: b.updated_at,
    content: { ...b.content, deleted: true },
  });
  assert.throws(() => captureAllocation(clear(deleted), w), {
    code: 'ALLOCATION_DELETED',
  });
  assert.equal(
    new AllocationError('SYNTHETIC_PRIVATE').message,
    'INVALID_ALLOCATION_CHANGE',
  );
});
test('allocation service rejects malformed new IDs duplicate batches and oversized input before authorization', async () => {
  let calls = 0;
  const svc = createAllocationService({
      async applyGuarded() {
        calls++;
      },
    }),
    c = command(),
    bad = structuredClone(c);
  bad.allocation.allocations[0].id = '0199d046-0000-4000-8000-000000005001';
  for (const input of [
    [],
    [bad],
    [c, c],
    Array(257).fill(c),
    [{ ...c, extra: 'SYNTHETIC' }],
    [
      replace(base(), [
        parcel(5001, 10, '20000', null, 'x'.repeat(4 * 1024 * 1024)),
      ]),
    ],
  ])
    await assert.rejects(() => svc.apply({ workspace_id: w }, input), {
      code: 'INVALID_ALLOCATION_CHANGE',
    });
  assert.equal(calls, 0);
});
test('allocation service requires transactional catalog capability and sanitizes storage failures', async () => {
  const missing = createAllocationService({
    async applyGuarded(_, changes, guard) {
      await guard({
        plan: planTransactionRevision(
          w,
          base(),
          changes[0],
          '2026-10-18T12:00:00.000Z',
        ),
      });
    },
  });
  await assert.rejects(() => missing.apply({ workspace_id: w }, [command()]), {
    code: 'CONFIGURATION_INVALID',
  });
  const failed = createAllocationService({
    async applyGuarded() {
      throw Error('SYNTHETIC PRIVATE STORAGE');
    },
  });
  await assert.rejects(
    () => failed.apply({ workspace_id: w }, [command()]),
    (e) => e.code === 'DATA_ACCESS_FAILED' && !e.message.includes('PRIVATE'),
  );
});
test('allocation batch reads one authorized transactional catalog and checks every plan before returning', async () => {
  let reads = 0,
    guards = 0;
  const one = command(),
    two = structuredClone(one);
  two.base.id = id(1002);
  two.allocation.allocations[0].id = id(5101);
  two.allocation.allocations[1].id = id(5102);
  const svc = createAllocationService({
    async applyGuarded(_, changes, guard) {
      for (const [n, c] of changes.entries()) {
        await guard({
          plan: planTransactionRevision(
            w,
            [one, two][n].base,
            c,
            '2026-10-18T12:00:00.000Z',
          ),
          readTaxonomy: async () => {
            reads++;
            return catalog();
          },
        });
        guards++;
      }
      return [];
    },
  });
  await svc.apply({ workspace_id: w }, [one, two]);
  assert.equal(reads, 1);
  assert.equal(guards, 2);
});
test('SQLite allocation scenarios exercise durable multi-category edits concurrency rollback reversal and complete groups', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  await prepareCategoryTenants(handle);
  const h = createAllocationHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runAllocationCases(h, async (n, f) => {
      await f();
      seen.push(n);
    });
    assert.deepEqual(seen, allocationCases);
  } finally {
    await h.close();
    handle.close();
  }
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-046-allocations-core-2026-10-20-us050-core.json',
    ),
  );
test('allocation evidence requires real cross-engine gates current source hashes and closed synthetic resources', () => {
  assert.equal(validateAllocationEvidence(evidence()).passed, true);
  for (const key of allocationChecks) {
    const r = evidence();
    delete r.checks[key];
    assert.throws(() => validateAllocationEvidence(r));
  }
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.private_payload = 'SYNTHETIC';
    },
    (r) => {
      r.source_sha256['packages/domain/src/allocations.ts'] = '0'.repeat(64);
    },
  ]) {
    const r = evidence();
    mutate(r);
    assert.throws(() => validateAllocationEvidence(r));
  }
});
