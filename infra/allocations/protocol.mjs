/* global structuredClone */
import assert from 'node:assert/strict';
import {
  createAllocationHarness,
  id,
  workspace as w,
  authorized,
} from './harness.mjs';
import { request, ids, grant } from '../revisions/scenarios.mjs';
import { tenants } from '../categories/harness.mjs';

export const allocationCases = Object.freeze([
  'multiple_categories_preserve_money_origin_tags_and_history',
  'edit_add_remove_and_collapse_parcels_with_stable_ids',
  'mismatch_invalid_money_duplicate_ids_and_payload_refused',
  'wide_exact_totals_min_i64_and_zero',
  'category_scope_subcategory_parent_and_workspace',
  'archived_existing_references_retained_not_reintroduced',
  'explicit_clear_and_noop_without_revision',
  'stale_forged_base_and_lost_ack_preserve_later_edits',
  'second_revision_failure_rolls_back_every_parcel_and_audit',
  'competing_versions_have_one_winner',
  'capture_before_async_authorization',
  'transfer_and_card_pairs_require_complete_scope',
  'deleted_and_unauthorized_changes_refused',
  'reversal_restores_parcels_and_refuses_later_revision',
  'allocation_ids_cannot_be_stolen_between_transactions',
  'financial_graph_balances_and_economic_kind_unchanged',
]);
export const keep = (base) => ({ base, allocation: { kind: 'KEEP' } });
export const clear = (base) => ({ base, allocation: { kind: 'CLEAR' } });
export const replace = (base, allocations) => ({
  base,
  allocation: { kind: 'REPLACE', allocations },
});
export const parcel = (
  n,
  category = 10,
  amount = '1200',
  subcategory = null,
  note = null,
) => ({
  id: id(n),
  category_id: id(category),
  subcategory_id: subcategory === null ? null : id(subcategory),
  amount_minor: amount,
  note,
});
const financial = (s) => {
  const c = { ...s.content };
  delete c.allocations;
  return c;
};
export async function runAllocationCases(h, step) {
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
    [13, 'EXPENSE'],
  ])
    await cat.apply(req, {
      kind: 'CREATE',
      id: id(n),
      name: 'SYNTHETIC ALLOCATION CATEGORY ' + n,
      category_scope,
      sort_order: n,
    });
  for (const [n, parent] of [
    [30, 10],
    [31, 13],
  ])
    await tax.apply(req, {
      kind: 'CREATE',
      item: {
        kind: 'SUBCATEGORY',
        id: id(n),
        workspace_id: w,
        name: 'SYNTHETIC ALLOCATION SUB ' + n,
        status: 'ACTIVE',
        category_id: id(parent),
        sort_order: 0,
      },
    });
  await tax.apply(req, {
    kind: 'CREATE',
    item: {
      kind: 'TAG',
      id: id(20),
      workspace_id: w,
      name: 'SYNTHETIC ALLOCATION TAG',
      status: 'ACTIVE',
    },
  });
  const state = (n) => h.state(w, id(n)),
    history = (n) => h.history(w, id(n)),
    originals = new Map();
  const create = async (n, patch = {}) => {
    await raw.apply(req, [
      {
        id: id(n),
        base_revision: '0',
        content: {
          account_id: id(1),
          group_id: null,
          counterparty_id: null,
          financial_date: '2026-10-18',
          account_amount_minor: '-1200',
          economic_kind: 'EXPENSE',
          original_description: 'SYNTHETIC ALLOCATION IMPORT',
          display_name: 'SYNTHETIC ALLOCATION ' + n,
          origin_kind: 'IMPORT',
          deleted: false,
          allocations: [],
          tag_ids: [id(20)],
          ...patch,
        },
      },
    ]);
    const s = await state(n);
    originals.set(s.id, financial(s));
    return s;
  };
  const unchanged = async (op, code) => {
    const before = await h.graph();
    await assert.rejects(op, { code });
    assert.deepEqual(await h.graph(), before);
  };
  await step(allocationCases[0], async () => {
    const base = await create(100),
      rows = [
        parcel(5001, 10, '700', 30, 'SYNTHETIC PARCEL NOTE'),
        parcel(5002, 13, '500', 31),
      ];
    const result = (await service.apply(req, [replace(base, rows)]))[0],
      current = await state(100),
      audit = (await history(100)).at(-1);
    assert.equal(result.version, '2');
    assert.deepEqual(current.content.allocations, rows);
    assert.deepEqual(financial(current), financial(base));
    assert.equal(audit.change_source, 'MANUAL');
    assert.deepEqual(audit.snapshot.before, base);
    assert.deepEqual(audit.snapshot.after, current);
  });
  await step(allocationCases[1], async () => {
    await service.apply(req, [
      replace(await state(100), [
        parcel(5001, 10, '600', 30, 'SYNTHETIC REVISED NOTE'),
        parcel(5003, 13, '600', 31),
      ]),
    ]);
    await service.apply(req, [
      replace(await state(100), [
        parcel(5001, 10, '1200', 30, 'SYNTHETIC REVISED NOTE'),
      ]),
    ]);
    assert.equal((await state(100)).content.allocations.length, 1);
    assert.equal((await state(100)).content.allocations[0].id, id(5001));
  });
  await step(allocationCases[2], async () => {
    const base = await state(100);
    for (const amount of ['1199', '1201'])
      await unchanged(
        () => service.apply(req, [replace(base, [parcel(5010, 10, amount)])]),
        'ALLOCATION_TOTAL_MISMATCH',
      );
    for (const rows of [
      [parcel(5010, 10, '0')],
      [parcel(5010, 10, '-1')],
      [parcel(5010, 10, '01')],
      [parcel(5010, 10, 1200)],
      [parcel(5010, 10, '600'), parcel(5010, 10, '600')],
      [],
    ])
      await unchanged(
        () => service.apply(req, [replace(base, rows)]),
        'INVALID_ALLOCATION_CHANGE',
      );
    await unchanged(
      () => service.apply(req, [{ ...clear(base), tag_ids: [] }]),
      'INVALID_ALLOCATION_CHANGE',
    );
  });
  await step(allocationCases[3], async () => {
    const minimum = await create(101, {
      account_amount_minor: '-9223372036854775808',
    });
    await service.apply(req, [
      replace(minimum, [
        parcel(5101, 10, '9223372036854775807'),
        parcel(5102, 13, '1'),
      ]),
    ]);
    const wide = await create(102, {
      account_amount_minor: '-9007199254740993',
    });
    await service.apply(req, [
      replace(wide, [
        parcel(5201, 10, '9007199254740992'),
        parcel(5202, 13, '1'),
      ]),
    ]);
    assert.equal(
      (await state(102)).content.allocations.reduce(
        (s, a) => s + BigInt(a.amount_minor),
        0n,
      ),
      9007199254740993n,
    );
    const zero = await create(103, {
      account_amount_minor: '0',
      economic_kind: 'ADJUSTMENT',
    });
    await unchanged(
      () => service.apply(req, [replace(zero, [parcel(5301, 12, '1')])]),
      'ALLOCATION_TOTAL_MISMATCH',
    );
    assert.equal((await service.apply(req, [clear(zero)]))[0].changed, false);
  });
  await step(allocationCases[4], async () => {
    await h.categories(tenants.business).apply(request(tenants.business), {
      kind: 'CREATE',
      id: id(9998),
      name: 'SYNTHETIC OTHER WORKSPACE ALLOCATION',
      category_scope: 'BOTH',
      sort_order: 0,
    });
    const base = await create(104, {
      account_amount_minor: '1200',
      economic_kind: 'INCOME',
    });
    await unchanged(
      () => service.apply(req, [replace(base, [parcel(5401, 10)])]),
      'ALLOCATION_SCOPE_MISMATCH',
    );
    const expense = await state(100);
    for (const row of [
      parcel(5402, 10, '1200', 31),
      parcel(5402, 9999),
      parcel(5402, 9998),
    ])
      await unchanged(
        () => service.apply(req, [replace(expense, [row])]),
        'ALLOCATION_REFERENCE_UNAVAILABLE',
      );
    await service.apply(req, [replace(base, [parcel(5401, 11)])]);
  });
  await step(allocationCases[5], async () => {
    const category = (await cat.list(req)).categories.find(
        (c) => c.id === id(10),
      ),
      sub = (await tax.list(req)).items.find(
        (s) => s.kind === 'SUBCATEGORY' && s.id === id(30),
      );
    await cat.apply(req, {
      kind: 'UPDATE',
      base: category,
      name: category.name,
      sort_order: category.sort_order,
      status: 'ARCHIVED',
    });
    await tax.apply(req, {
      kind: 'UPDATE',
      base: sub,
      item: { ...sub, status: 'ARCHIVED' },
    });
    await service.apply(req, [
      replace(await state(100), [
        parcel(5001, 10, '500', 30, 'SYNTHETIC ARCHIVED KEPT'),
        parcel(5502, 13, '700', 31),
      ]),
    ]);
    await unchanged(
      async () =>
        service.apply(req, [
          replace(await state(100), [parcel(5503, 10, '1200', 30)]),
        ]),
      'ALLOCATION_REFERENCE_UNAVAILABLE',
    );
    await cat.apply(req, {
      kind: 'UPDATE',
      base: { ...category, status: 'ARCHIVED' },
      name: category.name,
      sort_order: category.sort_order,
      status: 'ACTIVE',
    });
    await unchanged(
      async () =>
        service.apply(req, [
          replace(await state(100), [parcel(5503, 10, '1200', 30)]),
        ]),
      'ALLOCATION_REFERENCE_UNAVAILABLE',
    );
    await tax.apply(req, {
      kind: 'UPDATE',
      base: { ...sub, status: 'ARCHIVED' },
      item: sub,
    });
  });
  await step(allocationCases[6], async () => {
    let base = await state(100),
      count = (await history(100)).length;
    assert.equal(
      (
        await service.apply(req, [
          replace(base, [...base.content.allocations].reverse()),
        ])
      )[0].changed,
      false,
    );
    assert.equal((await history(100)).length, count);
    await service.apply(req, [clear(base)]);
    base = await state(100);
    assert.deepEqual(base.content.allocations, []);
    assert.deepEqual(base.content.tag_ids, [id(20)]);
    count = (await history(100)).length;
    assert.equal((await service.apply(req, [keep(base)]))[0].changed, false);
    assert.equal((await history(100)).length, count);
  });
  await step(allocationCases[7], async () => {
    const base = await create(106),
      c = replace(base, [parcel(5601)]);
    await service.apply(req, [c]);
    await unchanged(() => service.apply(req, [c]), 'VERSION_CONFLICT');
    const current = await state(106),
      forged = structuredClone(current);
    forged.content.display_name = 'SYNTHETIC FORGED';
    await unchanged(
      () => service.apply(req, [clear(forged)]),
      'ALLOCATION_BASE_CONFLICT',
    );
    await service.apply(req, [replace(current, [parcel(5601, 13)])]);
    await unchanged(
      () => service.apply(req, [clear(current)]),
      'VERSION_CONFLICT',
    );
  });
  await step(allocationCases[8], async () => {
    const commands = [
      replace(await create(107), [parcel(5701)]),
      replace(await create(108), [parcel(5801)]),
    ];
    await unchanged(
      () => h.service(w, { fail_revision: 2 }).apply(req, commands),
      'DATA_ACCESS_FAILED',
    );
    await service.apply(req, commands);
    assert.equal((await history(107)).length, 2);
    assert.equal((await history(108)).length, 2);
  });
  await step(allocationCases[9], async () => {
    const base = await create(109),
      other = h.engine === 'sqlite' ? service : h.service();
    const results = await Promise.allSettled([
      service.apply(req, [replace(base, [parcel(5901)])]),
      other.apply(req, [replace(base, [parcel(5902, 13)])]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'VERSION_CONFLICT',
    );
    await service.apply(req, [clear(await state(109))]);
  });
  await step(allocationCases[10], async () => {
    let release;
    const waiting = new Promise((r) => {
        release = r;
      }),
      svc = h.service(w, { authorize: () => waiting }),
      c = replace(await create(110), [parcel(6001)]),
      r = request(w),
      pending = svc.apply(r, [c]);
    c.allocation.allocations[0].amount_minor = '1';
    c.base.content.display_name = 'SYNTHETIC MUTATED';
    r.workspace_id = ids.b;
    release(authorized(request(w)));
    await pending;
    assert.equal(
      (await state(110)).content.allocations[0].amount_minor,
      '1200',
    );
  });
  await step(allocationCases[11], async () => {
    const table = h.engine === 'sqlite' ? '' : 'fm.';
    await h.sql(
      w,
      `INSERT INTO ${table}financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status) VALUES(?,?,'SYNTHETIC ALLOCATION CARD','CREDIT_CARD','LIABILITY','BRL','ACTIVE') RETURNING id`,
      [id(3), w],
    );
    for (const [kind, group, members, accounts] of [
      ['TRANSFER', 400, [201, 202], [1, 2]],
      ['CARD_PAYMENT', 401, [203, 204], [1, 3]],
    ]) {
      await raw.applyComposite(
        req,
        members.map((n, i) => ({
          id: id(n),
          base_revision: '0',
          content: {
            ...originals.get(id(100)),
            allocations: [],
            tag_ids: [],
            group_id: id(group),
            account_id: id(accounts[i]),
            origin_kind: 'MANUAL',
            economic_kind: kind === 'TRANSFER' ? 'TRANSFER' : 'DEBT_SETTLEMENT',
            account_amount_minor: kind === 'TRANSFER' && i ? '1200' : '-1200',
          },
        })),
        { id: id(group), group_type: kind },
        () => {},
      );
      const first = await state(members[0]),
        second = await state(members[1]);
      originals.set(first.id, financial(first));
      originals.set(second.id, financial(second));
      const c = replace(first, [
        parcel(7000 + members[0], 12, '500'),
        parcel(8000 + members[0], 12, '700'),
      ]);
      await unchanged(() => service.apply(req, [c]), 'COMPOSITE_REQUIRED');
      await unchanged(
        () =>
          h
            .service(w, {
              authorize: async (r) => ({
                ...authorized(r),
                account_ids: [id(1)],
              }),
            })
            .apply(req, [c, keep(second)]),
        'NOT_FOUND',
      );
      const results = await service.apply(req, [c, keep(second)]);
      assert.equal(results.filter((r) => r.changed).length, 1);
      assert.equal((await state(members[1])).version, second.version);
    }
  });
  await step(allocationCases[12], async () => {
    const s = await create(111);
    await raw.apply(req, [
      {
        id: s.id,
        base_revision: s.version,
        content: { ...s.content, deleted: true },
      },
    ]);
    await unchanged(
      async () => service.apply(req, [clear(await state(111))]),
      'ALLOCATION_DELETED',
    );
    await unchanged(
      async () =>
        h
          .service(w, { authorize: async () => null })
          .apply(req, [clear(await state(100))]),
      'ACCESS_DENIED',
    );
    originals.delete(s.id);
  });
  await step(allocationCases[13], async () => {
    const base = await create(112);
    await service.apply(req, [
      replace(base, [parcel(6201, 10, '600'), parcel(6202, 13, '600')]),
    ]);
    const current = await state(112);
    await raw.revert(req, [
      {
        id: current.id,
        base_revision: current.version,
        revision_version: current.version,
      },
    ]);
    assert.deepEqual((await state(112)).content, base.content);
    assert.equal((await history(112)).at(-1).change_source, 'REVERSAL');
    await unchanged(
      () =>
        raw.revert(req, [
          {
            id: current.id,
            base_revision: current.version,
            revision_version: current.version,
          },
        ]),
      'REVERSAL_CONFLICT',
    );
  });
  await step(allocationCases[14], async () => {
    const source = await state(107),
      target = await create(113);
    await unchanged(
      () =>
        service.apply(req, [
          replace(target, [{ ...source.content.allocations[0] }]),
        ]),
      'DATA_ACCESS_FAILED',
    );
  });
  await step(allocationCases[15], async () => {
    for (const [transaction, before] of originals) {
      const s = await h.state(w, transaction);
      assert.deepEqual(financial(s), before);
      const rows = await h.history(w, transaction);
      assert.deepEqual(rows.at(-1).snapshot.after, s);
    }
    const graph = await h.graph();
    for (const s of graph.transactions.filter((t) => originals.has(t.id))) {
      const expected = originals.get(s.id);
      assert.equal(s.account_amount_minor, expected.account_amount_minor);
      assert.equal(s.economic_kind, expected.economic_kind);
    }
  });
  const graph = await h.graph();
  return {
    transactions: graph.transactions.map((r) => {
      const t = { ...r };
      delete t.version;
      if (t.deleted_at instanceof Date)
        t.deleted_at = t.deleted_at.toISOString();
      return t;
    }),
    allocations: graph.allocations,
    tags: graph.tags,
  };
}
export async function runAllocationProtocol(sqlite, pools, admin, step) {
  const local = createAllocationHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createAllocationHarness('postgresql', { pools, admin });
  try {
    const a = await runAllocationCases(local, (n, f) =>
        step('sqlite_allocations_' + n, f),
      ),
      b = await runAllocationCases(cloud, (n, f) =>
        step('postgresql_allocations_' + n, f),
      );
    await step('allocations_same_financial_graph_cross_engine', () =>
      assert.deepEqual(a, b),
    );
    await step('allocations_local_anonymous_and_revision_actor', async () => {
      const req = { workspace_id: ids.local },
        service = local.service(ids.local, {
          authorize: async (r) => grant(r),
        }),
        cat = local.categories(ids.local, {
          authorize: async (r) => ({
            workspace_id: r.workspace_id,
            authority: 'LOCAL',
            can_read: true,
            can_manage: true,
          }),
        });
      await cat.apply(req, {
        kind: 'CREATE',
        id: id(999),
        name: 'SYNTHETIC LOCAL ALLOCATION',
        category_scope: 'BOTH',
        sort_order: 0,
      });
      const base = await local.state(ids.local, ids.localTransaction),
        value = BigInt(base.content.account_amount_minor),
        amount = (value < 0n ? -value : value).toString();
      await service.apply(req, [replace(base, [parcel(9999, 999, amount)])]);
      const last = (await local.history(ids.local, ids.localTransaction)).at(
        -1,
      );
      assert.equal(last.actor_type, 'LOCAL_USER');
      assert.equal(last.actor_id, null);
      assert.equal(last.device_id, null);
    });
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
