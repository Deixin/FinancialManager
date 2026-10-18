/* global structuredClone */
import assert from 'node:assert/strict';
import {
  createClassificationHarness,
  id,
  workspace as w,
  authorized,
} from './harness.mjs';
import { request, ids, grant } from '../revisions/scenarios.mjs';
import { filterClassifications } from '../../packages/domain/dist/classification.js';
export const classificationCases = Object.freeze([
  'single_classification_preserves_financial_content_and_history',
  'tags_multiple_scope_and_reference_validation',
  'inactive_references_retained_but_not_newly_assigned',
  'stale_and_forged_base_and_lost_ack',
  'split_tags_preserved_and_classification_requires_review',
  'clear_and_noop_keep_import_provenance',
  'paired_operations_require_all_members_and_account_scope',
  'second_revision_failure_rolls_back_entire_batch',
  'competing_base_versions',
  'input_capture_before_authorization',
  'overlapping_tag_filters_and_same_allocation_matching',
  'financial_rows_balances_and_economic_kind_unchanged',
]);
const query = (fields = {}) => ({
  category_id: null,
  subcategory_id: null,
  tag_ids: [],
  tag_match: 'ANY',
  unclassified_only: false,
  ...fields,
});
const keep = (base, tag_ids = base.content.tag_ids) => ({
  base,
  classification: { kind: 'KEEP' },
  tag_ids,
});
const set = (base, category_id, subcategory_id = null) => ({
  base,
  classification: {
    kind: 'SET',
    allocation_id:
      base.content.allocations[0]?.id ?? id(5000 + Number(base.id.slice(-3))),
    category_id,
    subcategory_id,
  },
  tag_ids: base.content.tag_ids,
});
const financial = (r) => {
  const c = { ...r };
  delete c.version;
  return c;
};
export async function runClassificationCases(h, step) {
  await h.prepare();
  const req = request(w),
    raw = h.revision(),
    service = h.service(),
    cat = h.categories(),
    tax = h.taxonomy();
  for (const [n, category_scope] of [
    [10, 'EXPENSE'],
    [11, 'INCOME'],
    [12, 'BOTH'],
  ])
    await cat.apply(req, {
      kind: 'CREATE',
      id: id(n),
      name: 'SYNTHETIC CLASSIFICATION ' + n,
      category_scope,
      sort_order: n,
    });
  for (const n of [20, 21, 22])
    await tax.apply(req, {
      kind: 'CREATE',
      item: {
        kind: 'TAG',
        id: id(n),
        workspace_id: w,
        name: 'SYNTHETIC TAG ' + n,
        status: 'ACTIVE',
      },
    });
  for (const [n, category_id] of [
    [30, id(10)],
    [31, id(12)],
  ])
    await tax.apply(req, {
      kind: 'CREATE',
      item: {
        kind: 'SUBCATEGORY',
        id: id(n),
        workspace_id: w,
        name: 'SYNTHETIC SUB ' + n,
        status: 'ACTIVE',
        category_id,
        sort_order: 0,
      },
    });
  const state = (n) => h.state(w, id(n)),
    history = (n) => h.history(w, id(n));
  const create = async (n, patch = {}) => {
    await raw.apply(req, [
      {
        id: id(n),
        base_revision: '0',
        content: {
          account_id: id(1),
          group_id: null,
          counterparty_id: null,
          financial_date: '2026-10-17',
          account_amount_minor: '-1200',
          economic_kind: 'EXPENSE',
          original_description: 'SYNTHETIC IMPORT ORIGINAL',
          display_name: 'SYNTHETIC CLASSIFICATION ' + n,
          origin_kind: 'IMPORT',
          deleted: false,
          allocations: [],
          tag_ids: [],
          ...patch,
        },
      },
    ]);
    return state(n);
  };
  const unchanged = async (op, code) => {
    const before = await h.graph();
    await assert.rejects(op, { code });
    assert.deepEqual(await h.graph(), before);
  };
  const editTag = async (n, status) => {
    const base = (await tax.list(req)).items.find(
      (r) => r.kind === 'TAG' && r.id === id(n),
    );
    await tax.apply(req, { kind: 'UPDATE', base, item: { ...base, status } });
  };
  let original;
  await step(
    'single_classification_preserves_financial_content_and_history',
    async () => {
      const base = await create(100),
        c = set(base, id(10), id(30));
      original = base.content;
      const result = (await service.apply(req, [c]))[0];
      assert.equal(result.version, '2');
      const current = await state(100),
        audit = (await history(100)).at(-1);
      assert.equal(current.content.allocations[0].amount_minor, '1200');
      assert.equal(audit.change_source, 'MANUAL');
      assert.deepEqual(audit.snapshot.before, base);
      assert.deepEqual(audit.snapshot.after, current);
      for (const k of Object.keys(original).filter(
        (k) => !['allocations', 'tag_ids'].includes(k),
      ))
        assert.deepEqual(current.content[k], original[k]);
    },
  );
  await step('tags_multiple_scope_and_reference_validation', async () => {
    let base = await state(100);
    await service.apply(req, [keep(base, [id(20), id(21)])]);
    base = await state(100);
    await unchanged(
      () => service.apply(req, [set(base, id(11))]),
      'CLASSIFICATION_SCOPE_MISMATCH',
    );
    await unchanged(
      () => service.apply(req, [set(base, id(10), id(31))]),
      'CLASSIFICATION_REFERENCE_UNAVAILABLE',
    );
    await unchanged(
      () => service.apply(req, [keep(base, [id(9999)])]),
      'CLASSIFICATION_REFERENCE_UNAVAILABLE',
    );
    const income = await create(101, {
      account_amount_minor: '1200',
      economic_kind: 'INCOME',
    });
    await unchanged(
      () => service.apply(req, [set(income, id(10))]),
      'CLASSIFICATION_SCOPE_MISMATCH',
    );
    await service.apply(req, [set(income, id(11))]);
  });
  await step(
    'inactive_references_retained_but_not_newly_assigned',
    async () => {
      await editTag(20, 'ARCHIVED');
      let base = await state(100);
      await service.apply(req, [keep(base, [id(20), id(22)])]);
      await service.apply(req, [keep(await state(100), [id(22)])]);
      base = await state(100);
      await unchanged(
        () => service.apply(req, [keep(base, [id(20), id(22)])]),
        'CLASSIFICATION_REFERENCE_UNAVAILABLE',
      );
      await editTag(20, 'ACTIVE');
      const category = (await cat.list(req)).categories.find(
        (r) => r.id === id(10),
      );
      await cat.apply(req, {
        kind: 'UPDATE',
        base: category,
        name: category.name,
        sort_order: category.sort_order,
        status: 'ARCHIVED',
      });
      await service.apply(req, [keep(await state(100), [id(20), id(21)])]);
      const empty = await create(102);
      await unchanged(
        () => service.apply(req, [set(empty, id(10), id(30))]),
        'CLASSIFICATION_REFERENCE_UNAVAILABLE',
      );
      await cat.apply(req, {
        kind: 'UPDATE',
        base: { ...category, status: 'ARCHIVED' },
        name: category.name,
        sort_order: category.sort_order,
        status: 'ACTIVE',
      });
      const sub = (await tax.list(req)).items.find(
        (r) => r.kind === 'SUBCATEGORY' && r.id === id(30),
      );
      await tax.apply(req, {
        kind: 'UPDATE',
        base: sub,
        item: { ...sub, status: 'ARCHIVED' },
      });
      await unchanged(
        () => service.apply(req, [set(empty, id(10), id(30))]),
        'CLASSIFICATION_REFERENCE_UNAVAILABLE',
      );
      await service.apply(req, [keep(await state(100), [id(21)])]);
      await tax.apply(req, {
        kind: 'UPDATE',
        base: { ...sub, status: 'ARCHIVED' },
        item: sub,
      });
    },
  );
  await step('stale_and_forged_base_and_lost_ack', async () => {
    const base = await state(100),
      c = keep(base, [id(20), id(21)]);
    await service.apply(req, [c]);
    await unchanged(() => service.apply(req, [c]), 'VERSION_CONFLICT');
    const current = await state(100),
      forged = structuredClone(current);
    forged.content.display_name = 'SYNTHETIC FORGED';
    await unchanged(
      () => service.apply(req, [keep(forged, [id(20)])]),
      'CLASSIFICATION_BASE_CONFLICT',
    );
    const noOp = await service.apply(req, [keep(current)]);
    assert.equal(noOp[0].changed, false);
    assert.equal(noOp[0].revision_id, null);
  });
  await step(
    'split_tags_preserved_and_classification_requires_review',
    async () => {
      const base = await create(103, {
        allocations: [
          {
            id: id(6001),
            category_id: id(10),
            subcategory_id: id(30),
            amount_minor: '500',
            note: 'SYNTHETIC SPLIT A',
          },
          {
            id: id(6002),
            category_id: id(12),
            subcategory_id: id(31),
            amount_minor: '700',
            note: 'SYNTHETIC SPLIT B',
          },
        ],
      });
      await service.apply(req, [keep(base, [id(20), id(21)])]);
      const current = await state(103);
      assert.deepEqual(current.content.allocations, base.content.allocations);
      await unchanged(
        () => service.apply(req, [set(current, id(12))]),
        'CLASSIFICATION_SPLIT_REVIEW_REQUIRED',
      );
      await unchanged(
        () =>
          service.apply(req, [
            { ...keep(current), classification: { kind: 'CLEAR' } },
          ]),
        'CLASSIFICATION_SPLIT_REVIEW_REQUIRED',
      );
    },
  );
  await step('clear_and_noop_keep_import_provenance', async () => {
    const base = await create(104);
    await service.apply(req, [set(base, id(12), id(31))]);
    const current = await state(104);
    await service.apply(req, [
      { ...keep(current, [id(22)]), classification: { kind: 'CLEAR' } },
    ]);
    const cleared = await state(104);
    assert.deepEqual(cleared.content.allocations, []);
    assert.deepEqual(cleared.content.tag_ids, [id(22)]);
    for (const k of [
      'origin_kind',
      'original_description',
      'account_amount_minor',
      'economic_kind',
    ])
      assert.equal(cleared.content[k], base.content[k]);
    await raw.revert(req, [
      {
        id: cleared.id,
        base_revision: cleared.version,
        revision_version: cleared.version,
      },
    ]);
    assert.deepEqual((await state(104)).content, current.content);
    assert.equal((await history(104)).at(-1).change_source, 'REVERSAL');
  });
  await step(
    'paired_operations_require_all_members_and_account_scope',
    async () => {
      const group = id(400),
        members = [201, 202];
      await raw.applyComposite(
        req,
        members.map((n, i) => ({
          id: id(n),
          base_revision: '0',
          content: {
            ...original,
            allocations: [],
            tag_ids: [],
            group_id: group,
            account_id: id(i + 1),
            economic_kind: 'TRANSFER',
            origin_kind: 'MANUAL',
            account_amount_minor: i ? '1000' : '-1000',
          },
        })),
        { id: group, group_type: 'TRANSFER' },
        () => {},
      );
      const first = await state(201),
        second = await state(202);
      await unchanged(
        () => service.apply(req, [keep(first, [id(20)])]),
        'COMPOSITE_REQUIRED',
      );
      const restricted = h.service(w, {
        authorize: async (r) => ({ ...authorized(r), account_ids: [id(1)] }),
      });
      await unchanged(
        () => restricted.apply(req, [keep(first, [id(20)]), keep(second)]),
        'NOT_FOUND',
      );
      await unchanged(
        () => service.apply(req, [set(first, id(10)), keep(second)]),
        'CLASSIFICATION_SCOPE_MISMATCH',
      );
      const result = await service.apply(req, [
        { ...set(first, id(12)), tag_ids: [id(20)] },
        keep(second),
      ]);
      assert.equal(result.filter((r) => r.changed).length, 1);
      assert.equal((await state(202)).version, second.version);
      assert.equal((await state(201)).content.economic_kind, 'TRANSFER');
    },
  );
  await step('second_revision_failure_rolls_back_entire_batch', async () => {
    const a = await state(100),
      b = await state(101),
      failing = h.service(w, { fail_revision: 2 });
    await unchanged(
      () => failing.apply(req, [keep(a, [id(22)]), keep(b, [id(22)])]),
      'DATA_ACCESS_FAILED',
    );
  });
  await step('competing_base_versions', async () => {
    const base = await state(100),
      other = h.engine === 'sqlite' ? service : h.service();
    const results = await Promise.allSettled([
      service.apply(req, [keep(base, [id(20)])]),
      other.apply(req, [keep(base, [id(22)])]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'VERSION_CONFLICT',
    );
    await service.apply(req, [keep(await state(100), [id(20), id(21)])]);
  });
  await step('input_capture_before_authorization', async () => {
    let release;
    const waiting = new Promise((r) => {
        release = r;
      }),
      s = h.service(w, { authorize: () => waiting }),
      base = await state(101),
      c = keep(base, [id(20)]),
      captured = request(w),
      pending = s.apply(captured, [c]);
    c.tag_ids[0] = id(9999);
    captured.workspace_id = ids.b;
    release(authorized(request(w)));
    await pending;
    assert.deepEqual((await state(101)).content.tag_ids, [id(20)]);
  });
  await step(
    'overlapping_tag_filters_and_same_allocation_matching',
    async () => {
      const states = await Promise.all(
        [100, 101, 102, 103, 104, 201, 202].map(state),
      );
      const matched = filterClassifications(
        w,
        [...states, states[0], states[3]],
        query({ tag_ids: [id(20), id(21)] }),
      );
      assert.equal(new Set(matched.map((r) => r.id)).size, matched.length);
      assert.ok(matched.some((r) => r.id === id(100)));
      assert.ok(
        filterClassifications(
          w,
          states,
          query({ tag_ids: [id(20), id(21)], tag_match: 'ALL' }),
        ).every((r) => [100, 103].some((n) => r.id === id(n))),
      );
      assert.deepEqual(
        filterClassifications(
          w,
          [states[3]],
          query({ category_id: id(10), subcategory_id: id(31) }),
        ),
        [],
      );
      assert.equal(
        filterClassifications(
          w,
          [states[3]],
          query({ category_id: id(10), subcategory_id: id(30) }),
        ).length,
        1,
      );
      assert.ok(
        filterClassifications(
          w,
          states,
          query({ unclassified_only: true }),
        ).some((r) => r.id === id(102)),
      );
    },
  );
  await step(
    'financial_rows_balances_and_economic_kind_unchanged',
    async () => {
      const graph = await h.graph();
      for (const n of [100, 101, 102, 103, 104, 201, 202]) {
        const history = await h.history(w, id(n)),
          initial = history[0].snapshot.after,
          current = await state(n),
          actual = graph.transactions.find((r) => r.id === id(n));
        assert.equal(
          actual.account_amount_minor,
          initial.content.account_amount_minor,
        );
        assert.equal(actual.economic_kind, initial.content.economic_kind);
        for (const key of Object.keys(initial.content).filter(
          (k) => !['allocations', 'tag_ids'].includes(k),
        ))
          assert.deepEqual(current.content[key], initial.content[key]);
        assert.equal(actual.version, current.version);
      }
      assert.equal(
        graph.transactions.reduce(
          (sum, r) => sum + BigInt(r.account_amount_minor),
          0n,
        ),
        -3600n,
      );
      assert.equal(
        graph.transactions
          .filter((r) => r.economic_kind === 'EXPENSE')
          .reduce((sum, r) => sum - BigInt(r.account_amount_minor), 0n),
        4800n,
      );
    },
  );
  const graph = await h.graph();
  return {
    transactions: graph.transactions.map(financial),
    allocations: graph.allocations,
    tags: graph.tags,
  };
}
export async function runClassificationProtocol(sqlite, pools, admin, step) {
  const local = createClassificationHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createClassificationHarness('postgresql', { pools, admin });
  try {
    const a = await runClassificationCases(local, (n, f) =>
        step('sqlite_classification_' + n, f),
      ),
      b = await runClassificationCases(cloud, (n, f) =>
        step('postgresql_classification_' + n, f),
      );
    await step('classification_same_financial_graph_cross_engine', () =>
      assert.deepEqual(a, b),
    );
    await step(
      'classification_local_anonymous_and_revision_actor',
      async () => {
        const tax = local.taxonomy(ids.local, {
            authorize: async (r) => ({
              workspace_id: r.workspace_id,
              authority: 'LOCAL',
              can_read: true,
              can_manage: true,
            }),
          }),
          req = { workspace_id: ids.local };
        await tax.apply(req, {
          kind: 'CREATE',
          item: {
            kind: 'TAG',
            id: id(999),
            workspace_id: ids.local,
            name: 'SYNTHETIC LOCAL TAG',
            status: 'ACTIVE',
          },
        });
        const base = await local.state(ids.local, ids.localTransaction),
          svc = local.service(ids.local, { authorize: async (r) => grant(r) });
        await svc.apply(req, [keep(base, [id(999)])]);
        const rows = await local.history(ids.local, ids.localTransaction),
          last = rows.at(-1);
        assert.equal(last.actor_type, 'LOCAL_USER');
        assert.equal(last.actor_id, null);
        assert.equal(last.device_id, null);
      },
    );
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
