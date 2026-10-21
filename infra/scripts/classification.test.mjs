import {
  readEvidenceFile as readFileSync,
  currentEvidenceValidator,
} from '../validation/evidence.mjs';
/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureClassification,
  classificationChange,
  validateClassificationPlan,
  captureClassificationFilter,
  filterClassifications,
  ClassificationError,
} from '../../packages/domain/dist/classification.js';
import {
  captureRevisionState,
  planTransactionRevision,
} from '../../packages/domain/dist/revisions.js';
import { createClassificationService } from '../../packages/finance-ports/dist/classification.js';
import { initialState, ids } from '../revisions/scenarios.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { prepareCategoryTenants } from '../categories/harness.mjs';
import { createClassificationHarness, id } from '../classification/harness.mjs';
import {
  runClassificationCases,
  classificationCases,
} from '../classification/protocol.mjs';
import {
  classificationChecks,
  validateClassificationEvidence as rawValidateClassificationEvidence,
} from '../classification/evidence.mjs';

const validateClassificationEvidence = currentEvidenceValidator(
  rawValidateClassificationEvidence,
);

const w = ids.a;
const base = () => {
  const r = initialState(ids.expense);
  return captureRevisionState({
    ...r,
    content: { ...r.content, allocations: [], tag_ids: [] },
  });
};
const command = () => ({
  base: base(),
  classification: {
    kind: 'SET',
    allocation_id: id(5001),
    category_id: id(10),
    subcategory_id: id(30),
  },
  tag_ids: [id(20)],
});
const catalog = () => ({
  categories: [
    {
      id: id(10),
      workspace_id: w,
      name: 'SYNTHETIC CATEGORY',
      category_scope: 'EXPENSE',
      sort_order: 0,
      status: 'ACTIVE',
      is_seeded: false,
    },
  ],
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
    {
      kind: 'TAG',
      id: id(20),
      workspace_id: w,
      name: 'SYNTHETIC TAG',
      status: 'ACTIVE',
    },
  ],
});
const plan = (c) =>
  planTransactionRevision(
    w,
    c.base,
    classificationChange(c),
    '2026-10-18T10:00:00.000Z',
  );
const filter = (fields) => ({
  category_id: null,
  subcategory_id: null,
  tag_ids: [],
  tag_match: 'ANY',
  unclassified_only: false,
  ...fields,
});
test('classification captures immutable intent and changes only labels preserving financial content and provenance', () => {
  const raw = command(),
    captured = captureClassification(raw, w);
  raw.tag_ids[0] = id(9999);
  raw.classification.category_id = id(9999);
  assert.deepEqual(captured.tag_ids, [id(20)]);
  assert.equal(captured.classification.category_id, id(10));
  assert.ok(Object.isFrozen(captured.base.content));
  const p = plan(captured);
  validateClassificationPlan(captured, p, catalog(), w);
  for (const key of Object.keys(captured.base.content).filter(
    (k) => !['allocations', 'tag_ids'].includes(k),
  ))
    assert.deepEqual(p.after.content[key], captured.base.content[key]);
  assert.equal(p.after.content.allocations[0].amount_minor, '20000');
  assert.equal(
    new ClassificationError('UNKNOWN').message,
    'INVALID_CLASSIFICATION',
  );
});
test('classification rejects financial fields malformed references duplicate tags deleted and foreign bases', () => {
  for (const mutate of [
    (c) => {
      c.amount_minor = '100';
    },
    (c) => {
      c.tag_ids = [id(20), id(20)];
    },
    (c) => {
      c.classification.kind = 'SPLIT';
    },
    (c) => {
      c.classification.subcategory_id = undefined;
    },
    (c) => {
      c.base = { ...c.base, workspace_id: ids.b };
    },
  ]) {
    const c = command();
    mutate(c);
    assert.throws(() => captureClassification(c, w), {
      code: 'INVALID_CLASSIFICATION',
    });
  }
  const c = command();
  c.base = captureRevisionState({
    ...c.base,
    deleted_at: '2026-10-18T01:00:00.000Z',
    content: { ...c.base.content, deleted: true },
  });
  assert.throws(() => captureClassification(c, w), {
    code: 'CLASSIFICATION_DELETED',
  });
});
test('classification checks actual bases active references and economic scope rather than trusting caller snapshots', () => {
  const c = command(),
    p = plan(c);
  const forged = structuredClone(c);
  forged.base.content.display_name = 'SYNTHETIC FORGED';
  assert.throws(() => validateClassificationPlan(forged, p, catalog(), w), {
    code: 'CLASSIFICATION_BASE_CONFLICT',
  });
  for (const mutate of [
    (r) => {
      r.items = [];
    },
    (r) => {
      r.categories[0].status = 'ARCHIVED';
    },
    (r) => {
      r.items[0].status = 'ARCHIVED';
    },
    (r) => {
      r.items[1].status = 'ARCHIVED';
    },
  ]) {
    const r = structuredClone(catalog());
    mutate(r);
    assert.throws(() => validateClassificationPlan(c, p, r, w), {
      code: 'CLASSIFICATION_REFERENCE_UNAVAILABLE',
    });
  }
  assert.throws(
    () =>
      validateClassificationPlan(
        c,
        p,
        {
          ...catalog(),
          categories: [
            { ...catalog().categories[0], category_scope: 'INCOME' },
          ],
        },
        w,
      ),
    { code: 'CLASSIFICATION_SCOPE_MISMATCH' },
  );
});
test('classification preserves single allocation IDs notes and exact i64 magnitude while refusing unsupported zero and minimum i64 assignments', () => {
  const c = command(),
    p = plan(c),
    existing = {
      ...p.after,
      content: {
        ...p.after.content,
        allocations: [
          { ...p.after.content.allocations[0], note: 'SYNTHETIC NOTE' },
        ],
      },
    };
  const next = { ...c, base: existing };
  assert.equal(
    classificationChange(next).content.allocations[0].note,
    'SYNTHETIC NOTE',
  );
  assert.throws(() =>
    captureClassification(
      {
        ...next,
        classification: { ...next.classification, allocation_id: id(8888) },
      },
      w,
    ),
  );
  for (const amount of ['0', '-9223372036854775808']) {
    const extreme = {
      ...c,
      base: captureRevisionState({
        ...c.base,
        content: {
          ...c.base.content,
          account_amount_minor: amount,
          economic_kind: 'ADJUSTMENT',
        },
      }),
    };
    assert.throws(() => classificationChange(extreme), {
      code: 'CLASSIFICATION_AMOUNT_UNSUPPORTED',
    });
    assert.equal(
      classificationChange({ ...extreme, classification: { kind: 'KEEP' } })
        .content.account_amount_minor,
      amount,
    );
  }
  const large = {
    ...c,
    base: captureRevisionState({
      ...c.base,
      content: { ...c.base.content, account_amount_minor: '-9007199254740993' },
    }),
  };
  assert.equal(
    classificationChange(large).content.allocations[0].amount_minor,
    '9007199254740993',
  );
});
test('expense reversals use expense category scope while keeping their economic kind and account sign', () => {
  const c = command();
  c.base = captureRevisionState({
    ...c.base,
    content: {
      ...c.base.content,
      account_amount_minor: '20000',
      economic_kind: 'EXPENSE_REVERSAL',
    },
  });
  const p = plan(c);
  validateClassificationPlan(c, p, catalog(), w);
  assert.equal(p.after.content.economic_kind, 'EXPENSE_REVERSAL');
  assert.equal(p.after.content.account_amount_minor, '20000');
  assert.throws(
    () =>
      validateClassificationPlan(
        c,
        p,
        {
          ...catalog(),
          categories: [
            { ...catalog().categories[0], category_scope: 'INCOME' },
          ],
        },
        w,
      ),
    { code: 'CLASSIFICATION_SCOPE_MISMATCH' },
  );
});
test('classification filters deduplicate overlaps reject divergent revisions and do not match category and subcategory across separate allocations', () => {
  const a = plan(command()).after,
    b = captureRevisionState({
      ...a,
      id: id(102),
      content: {
        ...a.content,
        allocations: [
          { ...a.content.allocations[0], amount_minor: '10000' },
          {
            id: id(6002),
            category_id: id(12),
            subcategory_id: id(31),
            amount_minor: '10000',
            note: null,
          },
        ],
      },
    });
  assert.equal(
    filterClassifications(
      w,
      [a, a, b, b],
      filter({ tag_ids: [id(20), id(21)] }),
    ).length,
    2,
  );
  assert.deepEqual(
    filterClassifications(
      w,
      [b],
      filter({ category_id: id(10), subcategory_id: id(31) }),
    ),
    [],
  );
  assert.equal(
    filterClassifications(
      w,
      [b],
      filter({ tag_ids: [id(20), id(21)], tag_match: 'ALL' }),
    ).length,
    0,
  );
  assert.throws(
    () => filterClassifications(w, [a, { ...a, version: '99' }], filter()),
    { code: 'CLASSIFICATION_STATE_CONFLICT' },
  );
  assert.throws(() =>
    filterClassifications(w, [{ ...a, workspace_id: ids.b }], filter()),
  );
  for (const invalid of [
    { ...filter(), unclassified_only: true, category_id: id(10) },
    { ...filter(), tag_match: 'UNKNOWN' },
    { ...filter(), extra: true },
    { ...filter(), tag_ids: ['x'.repeat(4 * 1024 * 1024)] },
  ])
    assert.throws(() => captureClassificationFilter(invalid));
});
test('classification service validates before authorization and refuses an adapter without transactional taxonomy reads', async () => {
  const missing = createClassificationService({
    async applyGuarded(_, changes, guard) {
      await guard({
        plan: planTransactionRevision(
          w,
          base(),
          changes[0],
          '2026-10-18T10:00:00.000Z',
        ),
      });
    },
  });
  await assert.rejects(() => missing.apply({ workspace_id: w }, [command()]), {
    code: 'CONFIGURATION_INVALID',
  });
  let calls = 0;
  const svc = createClassificationService({
    async applyGuarded() {
      calls++;
      throw Error('SYNTHETIC PRIVATE STORAGE');
    },
  });
  await assert.rejects(
    () =>
      svc.apply({ workspace_id: w }, [{ ...command(), tag_ids: ['invalid'] }]),
    { code: 'INVALID_CLASSIFICATION' },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => svc.apply({ workspace_id: w }, [command()]),
    (e) => e.code === 'DATA_ACCESS_FAILED' && !e.message.includes('PRIVATE'),
  );
});
test('SQLite classification scenarios exercise durable revisions rollback concurrency snapshots and balance invariance', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  await prepareCategoryTenants(handle);
  const h = createClassificationHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runClassificationCases(h, async (n, f) => {
      await f();
      seen.push(n);
    });
    assert.deepEqual(seen, classificationCases);
  } finally {
    await h.close();
    handle.close();
  }
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-045-classification-core-2026-10-20-us050-core.json',
    ),
  );
test('classification evidence requires real gates cleanup source hashes and explicit snapshot authorization and platform gates', () => {
  assert.equal(validateClassificationEvidence(evidence()).passed, true);
  for (const key of classificationChecks) {
    const r = evidence();
    delete r.checks[key];
    assert.throws(() => validateClassificationEvidence(r));
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
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
  ]) {
    const r = evidence();
    mutate(r);
    assert.throws(() => validateClassificationEvidence(r));
  }
});
