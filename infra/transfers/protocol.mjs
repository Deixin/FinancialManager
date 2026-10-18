/* global structuredClone */
import assert from 'node:assert/strict';
import { createTransferService } from '../../packages/finance-ports/dist/transfers.js';
import { createRevisionHarness } from '../revisions/harness.mjs';
import { fixture } from '../fixtures/loader.mjs';
import { request, grant, ids } from '../revisions/scenarios.mjs';
import { transferAccount } from '../../packages/domain/dist/transfers.js';
import { summarizeMovements } from '../../packages/domain/dist/index.js';
export const transferCases = Object.freeze([
  'create_group_pair_and_conservation',
  'edit_pair_preserves_original_and_accounts',
  'delete_restore_and_lost_ack',
  'forged_base_and_partial_group',
  'archived_and_changed_accounts',
  'allocation_and_tags_preserved_atomically',
  'split_resize_requires_review',
  'failed_second_revision_rolls_back_group_and_pair',
  'authorization_scope_and_closed',
  'competing_pair_versions',
  'i64_precision_and_consumption_exclusion',
  'preserve_original_fixture_and_history',
]);
export const id = (n) =>
  '0199d042-0000-7000-8000-' + String(n).padStart(12, '0');
export async function runTransferCases(h, step) {
  const w = fixture.workspace_a,
    original = await h.snapshot(w),
    other = await h.snapshot(fixture.workspace_b),
    assets = original.financial_account.filter(
      (a) => a.balance_nature === 'ASSET' && a.status === 'ACTIVE',
    ),
    a = transferAccount(assets[0]),
    b = transferAccount(assets[1]),
    unit = h.make(w),
    service = createTransferService(unit),
    req = request(w),
    created = [];
  assert.ok(a.id !== b.id);
  const create = (n, amount = '1000') => ({
    kind: 'CREATE',
    id: id(100 + n * 3),
    source_entry_id: id(101 + n * 3),
    target_entry_id: id(102 + n * 3),
    source_account: a,
    target_account: b,
    financial_date: '2026-10-18',
    amount_minor: amount,
    display_name: 'SYNTHETIC US042 ' + n,
    original_description: 'SYNTHETIC TRANSFER ORIGINAL',
  });
  const apply = async (c) => {
    const r = await service.apply(req, c);
    if (c.kind === 'CREATE') created.push(c);
    return r;
  };
  const base = async (n) => ({
    group_id: create(n).id,
    source: await h.state(w, create(n).source_entry_id),
    target: await h.state(w, create(n).target_entry_id),
  });
  const edit = (base, delta = {}) => ({
    kind: 'EDIT',
    base,
    source_account: a,
    target_account: b,
    financial_date: '2026-10-18',
    amount_minor: (-BigInt(
      base.source.content.account_amount_minor,
    )).toString(),
    display_name: base.source.content.display_name,
    ...delta,
  });
  const unchanged = async (operation, code) => {
    const before = await h.snapshot(w);
    await assert.rejects(operation, (e) => e.code === code);
    assert.deepEqual(await h.snapshot(w), before);
  };
  const sql = (text, values = []) =>
    h.sql(
      w,
      h.engine === 'sqlite'
        ? text
        : text
            .replaceAll(
              /\b(financial_account|transaction_group|transaction_allocation|transaction_tag)\b/g,
              'fm.$1',
            )
            .replaceAll('?', () => '$' + ++sql.index),
      values,
    );
  sql.index = 0;
  const write = async (text, values = []) => {
    sql.index = 0;
    return sql(text, values);
  };
  await step('create_group_pair_and_conservation', async () => {
    const results = await apply(create(1));
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.changed && r.version === '1'));
    const pair = await base(1);
    assert.equal(pair.source.content.account_amount_minor, '-1000');
    assert.equal(pair.target.content.account_amount_minor, '1000');
    const groups = (await h.snapshot(w)).transaction_group;
    assert.equal(groups.filter((g) => g.id === pair.group_id).length, 1);
    for (const s of [pair.source, pair.target])
      assert.equal((await h.history(w, s.id)).length, 1);
    assert.deepEqual(await h.snapshot(fixture.workspace_b), other);
  });
  await step('edit_pair_preserves_original_and_accounts', async () => {
    await apply(
      edit(await base(1), {
        source_account: b,
        target_account: a,
        amount_minor: '250',
        display_name: 'SYNTHETIC TRANSFER EDIT',
      }),
    );
    const pair = await base(1);
    assert.equal(pair.source.content.account_id, b.id);
    assert.equal(pair.target.content.account_id, a.id);
    for (const s of [pair.source, pair.target]) {
      assert.equal(s.version, '2');
      assert.equal(
        s.content.original_description,
        'SYNTHETIC TRANSFER ORIGINAL',
      );
    }
  });
  await step('delete_restore_and_lost_ack', async () => {
    const before = await base(1);
    await apply({ kind: 'DELETE', base: before });
    let pair = await base(1);
    assert.ok(pair.source.content.deleted && pair.target.content.deleted);
    const n = await apply({ kind: 'DELETE', base: pair });
    assert.ok(n.every((r) => !r.changed && r.revision_id === null));
    await unchanged(
      () => apply({ kind: 'RESTORE', base: before }),
      'VERSION_CONFLICT',
    );
    await apply({ kind: 'RESTORE', base: pair });
    pair = await base(1);
    assert.ok(!pair.source.content.deleted && !pair.target.content.deleted);
    await unchanged(() => apply(create(1)), 'VERSION_CONFLICT');
  });
  await step('forged_base_and_partial_group', async () => {
    const pair = structuredClone(await base(1));
    pair.target.content.display_name = 'SYNTHETIC FORGED';
    await unchanged(() => apply(edit(pair)), 'TRANSFER_BASE_CONFLICT');
    const live = await base(1);
    await unchanged(
      () =>
        unit.apply(req, [
          {
            id: live.source.id,
            base_revision: live.source.version,
            content: { ...live.source.content, display_name: 'SYNTHETIC HALF' },
          },
        ]),
      'COMPOSITE_REQUIRED',
    );
    await write(
      "UPDATE transaction_group SET state='BROKEN' WHERE workspace_id=? AND id=? RETURNING id",
      [w, live.group_id],
    );
    await unchanged(() => apply(edit(live)), 'COMPOSITE_REQUIRED');
    await write(
      "UPDATE transaction_group SET state='ACTIVE' WHERE workspace_id=? AND id=? RETURNING id",
      [w, live.group_id],
    );
  });
  await step('archived_and_changed_accounts', async () => {
    await write(
      "UPDATE financial_account SET status='ARCHIVED' WHERE workspace_id=? AND id=? RETURNING id",
      [w, b.id],
    );
    await unchanged(() => apply(create(2)), 'TRANSFER_ACCOUNT_ARCHIVED');
    await write(
      "UPDATE financial_account SET status='ACTIVE',account_kind=? WHERE workspace_id=? AND id=? RETURNING id",
      [b.account_kind === 'CASH' ? 'DIGITAL' : 'CASH', w, b.id],
    );
    await unchanged(() => apply(create(2)), 'TRANSFER_ACCOUNT_CHANGED');
    await write(
      'UPDATE financial_account SET account_kind=? WHERE workspace_id=? AND id=? RETURNING id',
      [b.account_kind, w, b.id],
    );
  });
  await step('allocation_and_tags_preserved_atomically', async () => {
    await apply(create(6, '500'));
    await write(
      "INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,NULL,500,'SYNTHETIC TRANSFER NOTE') RETURNING id",
      [id(600), w, create(6).source_entry_id, original.category[0].id],
    );
    await write(
      'INSERT INTO transaction_tag(workspace_id,transaction_id,tag_id) VALUES(?,?,?) RETURNING tag_id',
      [w, create(6).source_entry_id, original.tag[0].id],
    );
    await apply(edit(await base(6), { amount_minor: '750' }));
    const pair = await base(6);
    assert.equal(pair.source.content.allocations[0].amount_minor, '750');
    assert.equal(
      pair.source.content.allocations[0].note,
      'SYNTHETIC TRANSFER NOTE',
    );
    assert.deepEqual(pair.source.content.tag_ids, [original.tag[0].id]);
    assert.equal(pair.target.content.account_amount_minor, '750');
  });
  await step('split_resize_requires_review', async () => {
    await apply(create(7, '500'));
    await write(
      'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,NULL,250,NULL),(?,?,?,?,NULL,250,NULL) RETURNING id',
      [
        id(701),
        w,
        create(7).source_entry_id,
        original.category[0].id,
        id(702),
        w,
        create(7).source_entry_id,
        original.category[0].id,
      ],
    );
    await unchanged(
      async () => apply(edit(await base(7), { amount_minor: '1000' })),
      'ALLOCATION_REVIEW_REQUIRED',
    );
  });
  await step('failed_second_revision_rolls_back_group_and_pair', async () => {
    for (const c of [create(9), edit(await base(6), { amount_minor: '123' })]) {
      const broken = h.make(w, { fail_revision: 2 });
      try {
        await unchanged(
          () => createTransferService(broken).apply(req, c),
          'DATA_ACCESS_FAILED',
        );
      } finally {
        await broken.close();
      }
    }
  });
  await step('authorization_scope_and_closed', async () => {
    for (const override of [
      { authorize: async () => null },
      { authorize: async () => ({ ...grant(req), account_ids: [a.id] }) },
    ]) {
      const restricted = h.make(w, override);
      try {
        await unchanged(
          () => createTransferService(restricted).apply(req, create(10)),
          'ACCESS_DENIED',
        );
      } finally {
        await restricted.close();
      }
    }
    const closed = h.make(w),
      writer = createTransferService(closed);
    await closed.close();
    await assert.rejects(() => writer.apply(req, create(10)), {
      code: 'CLOSED',
    });
  });
  await step('competing_pair_versions', async () => {
    const live = await base(1);
    const results = await Promise.allSettled([
      apply(edit(live, { display_name: 'SYNTHETIC CONCURRENT A' })),
      apply(edit(live, { display_name: 'SYNTHETIC CONCURRENT B' })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'VERSION_CONFLICT',
    );
  });
  await step('i64_precision_and_consumption_exclusion', async () => {
    for (const [n, amount] of [
      [20, '9007199254740993'],
      [21, '9223372036854775807'],
    ]) {
      await apply(create(n, amount));
      const pair = await base(n);
      assert.equal(pair.source.content.account_amount_minor, '-' + amount);
      assert.equal(pair.target.content.account_amount_minor, amount);
      const totals = summarizeMovements({
        workspace_id: w,
        accounts: [a, b],
        movements: [pair.source, pair.target].map((s) => ({
          id: s.id,
          workspace_id: w,
          ...s.content,
          posting_state: 'CONFIRMED',
        })),
        period: { from: '2026-10-18', to: '2026-10-18' },
      });
      assert.equal(totals.income_minor, '0');
      assert.equal(totals.net_expense_minor, '0');
      assert.equal(totals.cash_net_minor, '0');
    }
  });
  for (const c of created) {
    const current = {
      group_id: c.id,
      source: await h.state(w, c.source_entry_id),
      target: await h.state(w, c.target_entry_id),
    };
    if (!current.source.content.deleted)
      await service.apply(req, { kind: 'DELETE', base: current });
  }
  await step('preserve_original_fixture_and_history', async () => {
    const next = await h.snapshot(w),
      ours = new Set(
        created.flatMap((c) => [c.id, c.source_entry_id, c.target_entry_id]),
      );
    for (const table of Object.keys(original))
      assert.deepEqual(
        next[table].filter(
          (r) =>
            !ours.has(
              table === 'transaction_group' || table === 'financial_transaction'
                ? r.id
                : r.transaction_id,
            ),
        ),
        original[table],
      );
    assert.deepEqual(await h.snapshot(fixture.workspace_b), other);
  });
  return Promise.all(
    created
      .flatMap((c) => [c.source_entry_id, c.target_entry_id])
      .map((t) => h.history(w, t)),
  );
}
export async function runTransferProtocol(sqlite, pools, admin, step) {
  const local = createRevisionHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createRevisionHarness('postgresql', { pools, admin });
  try {
    const a = await runTransferCases({ ...local, engine: 'sqlite' }, (n, run) =>
        step('sqlite_transfer_' + n, run),
      ),
      b = await runTransferCases({ ...cloud, engine: 'postgresql' }, (n, run) =>
        step('postgresql_transfer_' + n, run),
      );
    await step('transfer_same_versions_and_snapshots_cross_engine', () => {
      const normalize = (history) =>
        history.map((rows) =>
          rows.map((r) => ({
            version: r.version,
            source: r.change_source,
            before: r.snapshot.before?.content ?? null,
            after: r.snapshot.after.content,
          })),
        );
      assert.deepEqual(normalize(a), normalize(b));
    });
    await step('transfer_local_without_cloud_identity', async () => {
      await local.sql(
        ids.local,
        "INSERT INTO financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status) VALUES(?,?,'SYNTHETIC LOCAL TARGET','CASH','ASSET','BRL','ACTIVE') RETURNING id",
        [id(901), ids.local],
      );
      const accounts = await local.sql(
        ids.local,
        'SELECT id,workspace_id,currency_code,account_kind,balance_nature,status FROM financial_account WHERE workspace_id=? ORDER BY id',
        [ids.local],
      );
      const writer = createTransferService(local.make(ids.local));
      await writer.apply(
        { workspace_id: ids.local },
        {
          kind: 'CREATE',
          id: id(910),
          source_entry_id: id(911),
          target_entry_id: id(912),
          source_account: transferAccount(accounts[0]),
          target_account: transferAccount(accounts[1]),
          financial_date: '2026-10-18',
          amount_minor: '123',
          display_name: 'SYNTHETIC LOCAL TRANSFER',
          original_description: null,
        },
      );
      for (const n of [911, 912]) {
        const row = (await local.history(ids.local, id(n)))[0];
        assert.equal(row.actor_type, 'LOCAL_USER');
        assert.equal(row.actor_id, null);
        assert.equal(row.device_id, null);
      }
    });
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
