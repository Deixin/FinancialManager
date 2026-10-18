/* global structuredClone */
import assert from 'node:assert/strict';
import {
  createCounterpartyAssociationHarness,
  id,
  workspace as w,
  authorized,
} from './harness.mjs';
import { request, ids, grant } from '../revisions/scenarios.mjs';
import { tenants } from '../categories/harness.mjs';
export const associationCases = Object.freeze([
  'reuse_preserves_original_display_money_allocations_tags_and_history',
  'keep_same_reference_and_clear_are_explicit_noops',
  'archived_existing_reference_retained_cleared_not_reintroduced',
  'foreign_missing_and_archived_new_choices_refused',
  'forged_full_base_and_stale_version_refused',
  'lost_ack_replay_cannot_duplicate_or_erase_later_changes',
  'capture_before_async_authorization',
  'reference_state_checked_after_authorization',
  'second_revision_failure_rolls_back_entire_batch',
  'competing_versions_have_one_winner',
  'transfer_requires_complete_group_and_account_scope',
  'card_payment_preserves_debt_settlement_and_partner_revision',
  'deleted_requires_restore_before_association',
  'authorization_scope_and_storage_authority_enforced',
  'reversal_records_event_and_protects_later_edits',
  'exact_i64_values_and_zero_are_unchanged',
  'catalog_rename_does_not_rewrite_transaction_or_audit',
  'complete_financial_graph_unchanged_except_association_and_revisions',
]);
export const keep = (base) => ({ base, counterparty: { kind: 'KEEP' } });
export const clear = (base) => ({ base, counterparty: { kind: 'CLEAR' } });
export const set = (base, counterparty_id) => ({
  base,
  counterparty: { kind: 'SET', counterparty_id },
});
const financial = (s) => {
  const c = { ...s.content };
  delete c.counterparty_id;
  return c;
};
export async function runAssociationCases(h, step) {
  await h.prepare();
  const req = request(w),
    raw = h.revision(),
    service = h.service(),
    catalog = h.counterparties(),
    cat = h.categories(),
    tax = h.taxonomy(),
    originals = new Map();
  const party = async (n, workspace = w, manager = catalog) => {
    const item = {
      id: id(n),
      workspace_id: workspace,
      display_name: 'SYNTHETIC ASSOCIATION PARTY ' + n,
      identifier_type: null,
      identifier_value: null,
      relationship_hint: 'SUPPLIER',
      status: 'ACTIVE',
    };
    await manager.apply(request(workspace), { kind: 'CREATE', item });
    return item;
  };
  await party(40);
  await party(41);
  await party(42);
  await party(43);
  await cat.apply(req, {
    kind: 'CREATE',
    id: id(10),
    name: 'SYNTHETIC ASSOCIATION CATEGORY',
    category_scope: 'BOTH',
    sort_order: 0,
  });
  await tax.apply(req, {
    kind: 'CREATE',
    item: {
      kind: 'TAG',
      id: id(20),
      workspace_id: w,
      name: 'SYNTHETIC ASSOCIATION TAG',
      status: 'ACTIVE',
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
          financial_date: '2026-10-18',
          account_amount_minor: '-1200',
          economic_kind: 'EXPENSE',
          original_description: 'SYNTHETIC ASSOCIATION IMPORT',
          display_name: 'SYNTHETIC USER DISPLAY ' + n,
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
  const partyRow = async (n) =>
    (await catalog.list(req)).items.find((r) => r.id === id(n));
  const archive = async (n) => {
    const base = await partyRow(n);
    await catalog.apply(req, {
      kind: 'UPDATE',
      base,
      item: { ...base, status: 'ARCHIVED' },
    });
  };
  await step(associationCases[0], async () => {
    for (const n of [100, 101]) {
      const base = await create(n, {
        allocations: [
          {
            id: id(5000 + n),
            category_id: id(10),
            subcategory_id: null,
            amount_minor: '1200',
            note: 'SYNTHETIC NOTE',
          },
        ],
      });
      const result = (await service.apply(req, [set(base, id(40))]))[0];
      assert.equal(result.changed, true);
      assert.equal((await state(n)).content.counterparty_id, id(40));
      assert.deepEqual(financial(await state(n)), financial(base));
      const row = (await history(n)).at(-1);
      assert.equal(row.snapshot.before.content.counterparty_id, null);
      assert.equal(row.snapshot.after.content.counterparty_id, id(40));
      assert.equal(row.actor_type, 'MEMBER');
      assert.equal(row.change_source, 'MANUAL');
    }
  });
  await step(associationCases[1], async () => {
    const base = await state(100),
      before = await history(100);
    for (const c of [keep(base), set(base, id(40))])
      assert.equal((await service.apply(req, [c]))[0].changed, false);
    assert.deepEqual(await history(100), before);
    await service.apply(req, [clear(base)]);
    const cleared = await state(100);
    assert.equal(cleared.content.counterparty_id, null);
    assert.equal(
      (await service.apply(req, [clear(cleared)]))[0].changed,
      false,
    );
  });
  await step(associationCases[2], async () => {
    await archive(40);
    const base = await state(101),
      before = await history(101);
    assert.equal((await service.apply(req, [keep(base)]))[0].changed, false);
    assert.equal(
      (await service.apply(req, [set(base, id(40))]))[0].changed,
      false,
    );
    assert.deepEqual(await history(101), before);
    await service.apply(req, [clear(base)]);
    await unchanged(
      async () => service.apply(req, [set(await state(101), id(40))]),
      'COUNTERPARTY_REFERENCE_UNAVAILABLE',
    );
  });
  await step(associationCases[3], async () => {
    const foreign = h.counterparties(tenants.other);
    await party(49, tenants.other, foreign);
    for (const target of [id(49), id(999999), id(40)])
      await unchanged(
        async () => service.apply(req, [set(await state(100), target)]),
        'COUNTERPARTY_REFERENCE_UNAVAILABLE',
      );
  });
  await step(associationCases[4], async () => {
    const base = await state(100),
      forged = structuredClone(base);
    forged.content.display_name = 'SYNTHETIC FORGED';
    await unchanged(
      () => service.apply(req, [set(forged, id(41))]),
      'COUNTERPARTY_ASSOCIATION_BASE_CONFLICT',
    );
    await service.apply(req, [set(base, id(41))]);
    await unchanged(
      () => service.apply(req, [clear(base)]),
      'VERSION_CONFLICT',
    );
  });
  await step(associationCases[5], async () => {
    const base = await create(102),
      c = set(base, id(41));
    await service.apply(req, [c]);
    await unchanged(() => service.apply(req, [c]), 'VERSION_CONFLICT');
    const next = await state(102);
    await service.apply(req, [set(next, id(42))]);
    await unchanged(() => service.apply(req, [c]), 'VERSION_CONFLICT');
    assert.equal((await state(102)).content.counterparty_id, id(42));
  });
  await step(associationCases[6], async () => {
    let release;
    const wait = new Promise((r) => {
        release = r;
      }),
      svc = h.service(w, { authorize: () => wait }),
      c = set(await create(103), id(41)),
      r = request(w),
      pending = svc.apply(r, [c]);
    c.counterparty.counterparty_id = id(42);
    c.base.content.display_name = 'SYNTHETIC MUTATED';
    r.workspace_id = ids.b;
    release(authorized(request(w)));
    await pending;
    assert.equal((await state(103)).content.counterparty_id, id(41));
    assert.equal(
      (await state(103)).content.display_name,
      'SYNTHETIC USER DISPLAY 103',
    );
  });
  await step(associationCases[7], async () => {
    let release;
    const wait = new Promise((r) => {
        release = r;
      }),
      svc = h.service(w, { authorize: () => wait }),
      base = await create(104),
      pending = svc.apply(req, [set(base, id(43))]);
    await archive(43);
    const before = await h.graph(),
      rejected = assert.rejects(pending, {
        code: 'COUNTERPARTY_REFERENCE_UNAVAILABLE',
      });
    release(authorized(req));
    await rejected;
    assert.deepEqual(await h.graph(), before);
  });
  await step(associationCases[8], async () => {
    const a = await create(105),
      b = await create(106),
      bad = h.service(w, { fail_revision: 2 });
    await unchanged(
      () => bad.apply(req, [set(a, id(41)), set(b, id(42))]),
      'DATA_ACCESS_FAILED',
    );
    assert.equal((await state(105)).content.counterparty_id, null);
    assert.equal((await state(106)).version, '1');
  });
  await step(associationCases[9], async () => {
    const base = await create(107),
      other = h.engine === 'sqlite' ? service : h.service();
    const results = await Promise.allSettled([
      service.apply(req, [set(base, id(41))]),
      other.apply(req, [set(base, id(42))]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'VERSION_CONFLICT',
    );
    const current = await state(107);
    await service.apply(req, [set(current, id(41))]);
  });
  const group = async (kind, groupId, members, accounts) => {
    await raw.applyComposite(
      req,
      members.map((n, i) => ({
        id: id(n),
        base_revision: '0',
        content: {
          ...originals.get(id(100)),
          counterparty_id: null,
          group_id: id(groupId),
          account_id: id(accounts[i]),
          origin_kind: 'MANUAL',
          economic_kind: kind === 'TRANSFER' ? 'TRANSFER' : 'DEBT_SETTLEMENT',
          account_amount_minor: kind === 'TRANSFER' && i ? '1200' : '-1200',
          allocations: [],
          tag_ids: [],
        },
      })),
      { id: id(groupId), group_type: kind },
      () => {},
    );
    const first = await state(members[0]),
      second = await state(members[1]);
    originals.set(first.id, financial(first));
    originals.set(second.id, financial(second));
    return [first, second];
  };
  await step(associationCases[10], async () => {
    const [a, b] = await group('TRANSFER', 400, [201, 202], [1, 2]);
    await unchanged(
      () => service.apply(req, [set(a, id(41))]),
      'COMPOSITE_REQUIRED',
    );
    await unchanged(
      () =>
        h
          .service(w, {
            authorize: async (r) => ({
              ...authorized(r),
              account_ids: [id(1)],
            }),
          })
          .apply(req, [set(a, id(41)), keep(b)]),
      'NOT_FOUND',
    );
    const before = await history(202),
      result = await service.apply(req, [set(a, id(41)), keep(b)]);
    assert.equal(result.filter((r) => r.changed).length, 1);
    assert.deepEqual(await history(202), before);
  });
  await step(associationCases[11], async () => {
    const [a, b] = await group('CARD_PAYMENT', 401, [203, 204], [1, 3]),
      before = await history(204);
    await unchanged(
      () => service.apply(req, [set(a, id(41))]),
      'COMPOSITE_REQUIRED',
    );
    const result = await service.apply(req, [set(a, id(41)), keep(b)]);
    assert.equal(result.filter((r) => r.changed).length, 1);
    assert.deepEqual(await history(204), before);
    assert.equal((await state(203)).content.economic_kind, 'DEBT_SETTLEMENT');
  });
  await step(associationCases[12], async () => {
    const base = await create(108);
    await raw.apply(req, [
      {
        id: base.id,
        base_revision: base.version,
        content: { ...base.content, deleted: true },
      },
    ]);
    await unchanged(
      async () => service.apply(req, [set(await state(108), id(41))]),
      'COUNTERPARTY_ASSOCIATION_DELETED',
    );
    originals.delete(base.id);
  });
  await step(associationCases[13], async () => {
    const base = await create(109);
    await unchanged(
      () =>
        h
          .service(w, { authorize: async () => null })
          .apply(req, [set(base, id(41))]),
      'ACCESS_DENIED',
    );
    await unchanged(
      () =>
        h
          .service(w, {
            authorize: async (r) => ({
              ...authorized(r),
              account_ids: [id(2)],
            }),
          })
          .apply(req, [set(base, id(41))]),
      'NOT_FOUND',
    );
    await unchanged(
      () =>
        h
          .service(w, {
            authorize: async (r) => ({
              ...authorized(r),
              authority: 'LOCAL',
              actor: {
                actor_type: 'LOCAL_USER',
                actor_id: null,
                device_id: null,
              },
            }),
          })
          .apply({ workspace_id: w }, [set(base, id(41))]),
      'ACCESS_DENIED',
    );
    await unchanged(
      () => service.apply(request(tenants.other), [set(base, id(41))]),
      'INVALID_COUNTERPARTY_ASSOCIATION',
    );
  });
  await step(associationCases[14], async () => {
    const base = await create(110);
    await service.apply(req, [set(base, id(41))]);
    const current = await state(110);
    await raw.revert(req, [
      {
        id: current.id,
        base_revision: current.version,
        revision_version: current.version,
      },
    ]);
    assert.deepEqual((await state(110)).content, base.content);
    assert.equal((await history(110)).at(-1).change_source, 'REVERSAL');
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
  await step(associationCases[15], async () => {
    for (const [n, amount] of [
      [111, '-9223372036854775808'],
      [112, '9007199254740993'],
      [113, '0'],
    ]) {
      const base = await create(n, {
        account_amount_minor: amount,
        economic_kind: 'OTHER',
      });
      await service.apply(req, [set(base, id(41))]);
      assert.deepEqual(financial(await state(n)), financial(base));
    }
  });
  await step(associationCases[16], async () => {
    const before = await state(100),
      audit = await history(100),
      base = await partyRow(41);
    await catalog.apply(req, {
      kind: 'UPDATE',
      base,
      item: { ...base, display_name: 'SYNTHETIC RENAMED REUSABLE PARTY' },
    });
    assert.deepEqual(await state(100), before);
    assert.deepEqual(await history(100), audit);
  });
  await step(associationCases[17], async () => {
    for (const [t, before] of originals) {
      const current = await h.state(w, t);
      assert.deepEqual(financial(current), before);
      assert.deepEqual((await h.history(w, t)).at(-1).snapshot.after, current);
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
export async function runAssociationProtocol(sqlite, pools, admin, step) {
  const local = createCounterpartyAssociationHarness('sqlite', {
      sqlite: () => sqlite,
    }),
    cloud = createCounterpartyAssociationHarness('postgresql', {
      pools,
      admin,
    });
  try {
    const a = await runAssociationCases(local, (n, f) =>
        step('sqlite_counterparty_associations_' + n, f),
      ),
      b = await runAssociationCases(cloud, (n, f) =>
        step('postgresql_counterparty_associations_' + n, f),
      );
    await step(
      'counterparty_associations_same_financial_graph_cross_engine',
      () => assert.deepEqual(a, b),
    );
    await step(
      'counterparty_associations_local_anonymous_and_revision_actor',
      async () => {
        const req = { workspace_id: ids.local },
          catalog = local.counterparties(ids.local, {
            authorize: async (r) => ({
              workspace_id: r.workspace_id,
              authority: 'LOCAL',
              can_read: true,
              can_manage: true,
            }),
          });
        await catalog.apply(req, {
          kind: 'CREATE',
          item: {
            id: id(999),
            workspace_id: ids.local,
            display_name: 'SYNTHETIC LOCAL PARTY',
            identifier_type: null,
            identifier_value: null,
            relationship_hint: null,
            status: 'ACTIVE',
          },
        });
        const base = await local.state(ids.local, ids.localTransaction),
          service = local.service(ids.local, {
            authorize: async (r) => grant(r),
          });
        await service.apply(req, [set(base, id(999))]);
        const last = (await local.history(ids.local, ids.localTransaction)).at(
          -1,
        );
        assert.equal(last.actor_type, 'LOCAL_USER');
        assert.equal(last.actor_id, null);
        assert.equal(last.device_id, null);
      },
    );
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
