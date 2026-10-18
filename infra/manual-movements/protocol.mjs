/* global structuredClone */
import assert from 'node:assert/strict';
import { createManualMovementService } from '../../packages/finance-ports/dist/manual-movements.js';
import { createRevisionHarness } from '../revisions/harness.mjs';
import { fixture } from '../fixtures/loader.mjs';
import {
  validateAccount,
  summarizeMovements,
} from '../../packages/domain/dist/index.js';
import { request, grant, ids } from '../revisions/scenarios.mjs';
export const manualCases = Object.freeze([
  'create_signs_scope_and_history',
  'edit_original_and_account_move',
  'delete_restore_and_lost_ack',
  'stale_and_forged_base',
  'archived_and_changed_accounts',
  'single_allocation_atomic_resize',
  'split_amount_requires_review',
  'adjustment_i64_and_economic_separation',
  'failed_revision_rolls_back',
  'authorization_before_storage_and_closed',
  'competing_base_versions',
  'preserve_original_fixture_and_history',
]);
const id = (n) => '0199d041-0000-7000-8000-' + String(n).padStart(12, '0');
const descriptor = (row) =>
  Object.fromEntries(
    [
      'id',
      'workspace_id',
      'currency_code',
      'account_kind',
      'balance_nature',
      'status',
    ].map((k) => [k, row[k]]),
  );
export async function runManualCases(h, step) {
  const w = fixture.workspace_a,
    beforeB = await h.snapshot(fixture.workspace_b),
    original = await h.snapshot(w),
    accounts = original.financial_account,
    bank = descriptor(accounts.find((a) => a.account_kind === 'CHECKING')),
    card = descriptor(accounts.find((a) => a.account_kind === 'CREDIT_CARD'));
  validateAccount(bank, w);
  validateAccount(card, w);
  const unit = h.make(w),
    manual = createManualMovementService(unit),
    req = request(w),
    created = [];
  const create = (n, kind = 'INCOME', account = bank, amount = '1000') => ({
    kind: 'CREATE',
    id: id(n),
    account,
    financial_date: '2026-10-17',
    amount_minor: amount,
    movement_kind: kind,
    display_name: 'SYNTHETIC US041 ' + n,
    original_description: 'SYNTHETIC ORIGINAL ' + n,
  });
  const apply = async (input) => {
    const result = await manual.apply(req, input);
    if (input.kind === 'CREATE' || input.kind === 'ADJUST')
      created.push(input.id);
    return result;
  };
  const state = (n) => h.state(w, id(n));
  const edit = (base, overrides = {}) => ({
    kind: 'EDIT',
    base,
    account: bank,
    financial_date: base.content.financial_date,
    display_name: base.content.display_name,
    amount_minor: (BigInt(base.content.account_amount_minor) < 0n
      ? -BigInt(base.content.account_amount_minor)
      : BigInt(base.content.account_amount_minor)
    ).toString(),
    movement_kind: base.content.economic_kind,
    ...overrides,
  });
  const unchanged = async (operation, code) => {
    const before = await h.snapshot(w);
    await assert.rejects(operation, (e) => e.code === code);
    assert.deepEqual(await h.snapshot(w), before);
  };
  await step('create_signs_scope_and_history', async () => {
    for (const [n, kind, account, expected] of [
      [1, 'INCOME', bank, '1000'],
      [2, 'EXPENSE', bank, '-1000'],
      [3, 'EXPENSE', card, '1000'],
      [4, 'INCOME', card, '-1000'],
    ]) {
      const result = await apply(create(n, kind, account));
      assert.equal(result.version, '1');
      assert.equal((await state(n)).content.account_amount_minor, expected);
      const history = await h.history(w, id(n));
      assert.equal(history.length, 1);
      assert.equal(history[0].snapshot.before, null);
      assert.equal(history[0].actor_type, 'MEMBER');
    }
    assert.deepEqual(await h.snapshot(fixture.workspace_b), beforeB);
  });
  await step('edit_original_and_account_move', async () => {
    const base = await state(2);
    await apply(
      edit(base, {
        account: card,
        display_name: 'SYNTHETIC RENAMED',
        amount_minor: '2000',
      }),
    );
    const next = await state(2);
    assert.equal(next.version, '2');
    assert.equal(next.content.account_id, card.id);
    assert.equal(next.content.account_amount_minor, '2000');
    assert.equal(
      next.content.original_description,
      base.content.original_description,
    );
    assert.deepEqual((await h.history(w, id(2)))[1].snapshot.before, base);
  });
  await step('delete_restore_and_lost_ack', async () => {
    const command = { kind: 'DELETE', base: await state(2) };
    await apply(command);
    assert.equal((await state(2)).content.deleted, true);
    await unchanged(() => apply(command), 'VERSION_CONFLICT');
    await apply({ kind: 'RESTORE', base: await state(2) });
    assert.equal((await state(2)).content.deleted, false);
    assert.equal((await state(2)).version, '4');
    await unchanged(() => apply(create(1)), 'VERSION_CONFLICT');
  });
  await step('stale_and_forged_base', async () => {
    const old = await state(1);
    await apply(edit(old, { display_name: 'SYNTHETIC UPDATED' }));
    await unchanged(
      () => apply(edit(old, { display_name: 'SYNTHETIC STALE' })),
      'VERSION_CONFLICT',
    );
    const forged = structuredClone(await state(1));
    forged.content.counterparty_id = original.counterparty[0].id;
    await unchanged(() => apply(edit(forged)), 'MANUAL_BASE_CONFLICT');
    const grouped = original.financial_transaction.find(
      (row) => row.group_id !== null,
    );
    assert.ok(grouped);
    await unchanged(
      async () => apply({ kind: 'DELETE', base: await h.state(w, grouped.id) }),
      'MANUAL_MOVEMENT_READ_ONLY',
    );
  });
  await step('archived_and_changed_accounts', async () => {
    const altered = {
      ...create(5),
      account: { ...bank, balance_nature: 'LIABILITY' },
    };
    await unchanged(() => apply(altered), 'MANUAL_ACCOUNT_CHANGED');
    await apply({ kind: 'DELETE', base: await state(1) });
    await h.sql(
      w,
      h.engine === 'sqlite'
        ? "UPDATE financial_account SET status='ARCHIVED' WHERE workspace_id=? AND id=? RETURNING id"
        : "UPDATE fm.financial_account SET status='ARCHIVED' WHERE workspace_id=$1 AND id=$2 RETURNING id",
      [w, bank.id],
    );
    try {
      await unchanged(() => apply(create(6)), 'MANUAL_ACCOUNT_ARCHIVED');
      await unchanged(
        async () => apply({ kind: 'RESTORE', base: await state(1) }),
        'MANUAL_ACCOUNT_ARCHIVED',
      );
    } finally {
      await h.sql(
        w,
        h.engine === 'sqlite'
          ? "UPDATE financial_account SET status='ACTIVE' WHERE workspace_id=? AND id=? RETURNING id"
          : "UPDATE fm.financial_account SET status='ACTIVE' WHERE workspace_id=$1 AND id=$2 RETURNING id",
        [w, bank.id],
      );
    }
    await apply({ kind: 'RESTORE', base: await state(1) });
  });
  await step('single_allocation_atomic_resize', async () => {
    await apply(create(7, 'EXPENSE'));
    let base = await state(7);
    const category = original.category[0].id;
    await unit.apply(req, [
      {
        id: base.id,
        base_revision: base.version,
        content: {
          ...base.content,
          allocations: [
            {
              id: id(107),
              category_id: category,
              subcategory_id: null,
              amount_minor: '1000',
              note: 'SYNTHETIC NOTE',
            },
          ],
        },
      },
    ]);
    base = await state(7);
    await apply(edit(base, { amount_minor: '2500' }));
    const next = await state(7);
    assert.equal(next.content.allocations[0].amount_minor, '2500');
    assert.equal(next.content.allocations[0].note, 'SYNTHETIC NOTE');
    await apply({ kind: 'DELETE', base: next });
    await apply({ kind: 'RESTORE', base: await state(7) });
    assert.deepEqual(
      (await state(7)).content.allocations,
      next.content.allocations,
    );
  });
  await step('split_amount_requires_review', async () => {
    await apply(create(8, 'EXPENSE'));
    const base = await state(8),
      category = original.category[0].id;
    await unit.apply(req, [
      {
        id: base.id,
        base_revision: base.version,
        content: {
          ...base.content,
          allocations: [
            {
              id: id(108),
              category_id: category,
              subcategory_id: null,
              amount_minor: '400',
              note: null,
            },
            {
              id: id(208),
              category_id: category,
              subcategory_id: null,
              amount_minor: '600',
              note: null,
            },
          ],
        },
      },
    ]);
    await unchanged(
      async () => apply(edit(await state(8), { amount_minor: '2500' })),
      'ALLOCATION_REVIEW_REQUIRED',
    );
    await unchanged(
      async () => apply(edit(await state(8), { movement_kind: 'INCOME' })),
      'ALLOCATION_REVIEW_REQUIRED',
    );
  });
  await step('adjustment_i64_and_economic_separation', async () => {
    const report = async () => {
      const snapshot = await h.snapshot(w);
      return summarizeMovements({
        workspace_id: w,
        accounts: snapshot.financial_account,
        movements: snapshot.financial_transaction.map((row) => ({
          ...row,
          posting_state: row.deleted_at === null ? 'CONFIRMED' : 'DELETED',
        })),
        period: { from: '2026-10-17', to: '2026-10-17' },
      });
    };
    const before = await report();
    await apply({
      kind: 'ADJUST',
      id: id(15),
      account: bank,
      financial_date: '2026-10-17',
      delta_minor: '123',
      reason: 'SYNTHETIC SMALL RECONCILIATION',
    });
    const small = await report();
    for (const key of [
      'income_minor',
      'expense_minor',
      'expense_reversal_minor',
      'net_expense_minor',
      'economic_result_minor',
    ])
      assert.equal(small[key], before[key]);
    assert.equal(
      small.cash_net_minor,
      (BigInt(before.cash_net_minor) + 123n).toString(),
    );
    await apply({ kind: 'DELETE', base: await state(15) });
    for (const [n, delta] of [
      [9, '9223372036854775807'],
      [10, '-9223372036854775808'],
      [11, '9007199254740993'],
    ]) {
      await apply({
        kind: 'ADJUST',
        id: id(n),
        account: bank,
        financial_date: '2026-10-17',
        delta_minor: delta,
        reason: 'SYNTHETIC RECONCILIATION',
      });
      const current = await state(n);
      assert.equal(current.content.account_amount_minor, delta);
      assert.equal(current.content.economic_kind, 'ADJUSTMENT');
      assert.equal(
        current.content.display_name,
        'Ajuste de saldo: SYNTHETIC RECONCILIATION',
      );
      await apply({ kind: 'DELETE', base: current });
    }
    assert.deepEqual(await report(), before);
  });
  await step('failed_revision_rolls_back', async () => {
    const broken = h.make(w, { fail_revision: true }),
      writer = createManualMovementService(broken);
    try {
      await unchanged(
        () => writer.apply(req, create(12)),
        'DATA_ACCESS_FAILED',
      );
    } finally {
      await broken.close();
    }
    const resize = h.make(w, { fail_revision: true });
    try {
      await unchanged(
        async () =>
          createManualMovementService(resize).apply(
            req,
            edit(await state(7), { amount_minor: '777' }),
          ),
        'DATA_ACCESS_FAILED',
      );
    } finally {
      await resize.close();
    }
  });
  await step('authorization_before_storage_and_closed', async () => {
    const denied = h.make(w, {
      authorize: async () => ({ ...grant(req), can_write: false }),
    });
    try {
      await unchanged(
        () => createManualMovementService(denied).apply(req, create(13)),
        'ACCESS_DENIED',
      );
    } finally {
      await denied.close();
    }
    const closed = h.make(w),
      writer = createManualMovementService(closed);
    await closed.close();
    await assert.rejects(() => writer.apply(req, create(14)), {
      code: 'CLOSED',
    });
  });
  await step('competing_base_versions', async () => {
    const current = await state(1),
      results = await Promise.allSettled([
        apply(edit(current, { display_name: 'SYNTHETIC CONCURRENT A' })),
        apply(edit(current, { display_name: 'SYNTHETIC CONCURRENT B' })),
      ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'VERSION_CONFLICT',
    );
  });
  // Preserve FIN-002's original balances/reports while retaining complete new history.
  for (const transaction of created) {
    const current = await h.state(w, transaction);
    if (!current.content.deleted)
      await manual.apply(req, { kind: 'DELETE', base: current });
  }
  await step('preserve_original_fixture_and_history', async () => {
    const next = await h.snapshot(w),
      ours = new Set(created);
    for (const table of Object.keys(original))
      assert.deepEqual(
        next[table].filter(
          (row) =>
            !ours.has(
              table === 'financial_transaction' ? row.id : row.transaction_id,
            ),
        ),
        original[table],
      );
  });
  return {
    created: created.length,
    history: await Promise.all(
      created.map((transaction) => h.history(w, transaction)),
    ),
  };
}
export async function runManualProtocol(sqlite, pools, admin, step) {
  const local = createRevisionHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createRevisionHarness('postgresql', { pools, admin });
  try {
    const a = await runManualCases(
        { ...local, engine: 'sqlite' },
        (name, run) => step('sqlite_manual_' + name, run),
      ),
      b = await runManualCases(
        { ...cloud, engine: 'postgresql' },
        (name, run) => step('postgresql_manual_' + name, run),
      );
    await step('manual_same_versions_and_snapshots_cross_engine', () => {
      const normalize = (history) =>
        history.map((rows) =>
          rows.map((row) => ({
            version: row.version,
            source: row.change_source,
            before: row.snapshot.before?.content ?? null,
            after: row.snapshot.after.content,
          })),
        );
      assert.deepEqual(normalize(a.history), normalize(b.history));
      assert.equal(a.created, b.created);
    });
    await step('manual_local_without_cloud_identity', async () => {
      const [raw] = await local.sql(
          ids.local,
          'SELECT id,workspace_id,currency_code,account_kind,balance_nature,status FROM financial_account WHERE workspace_id=? AND id=?',
          [ids.local, ids.localAccount],
        ),
        service = createManualMovementService(local.make(ids.local));
      const result = await service.apply(
        { workspace_id: ids.local },
        {
          kind: 'CREATE',
          id: id(900),
          account: descriptor(raw),
          financial_date: '2026-10-17',
          amount_minor: '123',
          movement_kind: 'INCOME',
          display_name: 'SYNTHETIC ANONYMOUS MANUAL',
          original_description: null,
        },
      );
      assert.equal(result.version, '1');
      const rows = await local.history(ids.local, id(900));
      assert.equal(rows[0].actor_type, 'LOCAL_USER');
      assert.equal(rows[0].actor_id, null);
      assert.equal(rows[0].device_id, null);
    });
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
