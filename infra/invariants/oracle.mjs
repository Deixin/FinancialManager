import assert from 'node:assert/strict';

// Independent, synthetic-fixture reference reducer. No production Domain imports.
export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export function logicalSnapshot(snapshot) {
  return canonical({
    ...snapshot,
    transaction_revision: snapshot.transaction_revision.map((row) => ({
      ...row,
      snapshot: JSON.parse(row.snapshot),
    })),
  });
}
export function aggregate(snapshot, id) {
  const row = snapshot.financial_transaction.find((item) => item.id === id);
  if (!row) return null;
  const fields = [
    'account_id',
    'group_id',
    'counterparty_id',
    'financial_date',
    'account_amount_minor',
    'economic_kind',
    'original_description',
    'display_name',
    'origin_kind',
  ];
  return {
    workspace_id: row.workspace_id,
    id,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    content: {
      ...Object.fromEntries(fields.map((key) => [key, row[key]])),
      deleted: row.deleted_at !== null,
      allocations: snapshot.transaction_allocation
        .filter((item) => item.transaction_id === id)
        .map((item) =>
          Object.fromEntries(
            ['id', 'category_id', 'subcategory_id', 'amount_minor', 'note'].map(
              (key) => [key, item[key]],
            ),
          ),
        ),
      tag_ids: snapshot.transaction_tag
        .filter((item) => item.transaction_id === id)
        .map((item) => item.tag_id),
    },
  };
}
export function assertAudit(before, after, rejected = false) {
  if (rejected)
    return assert.deepEqual(logicalSnapshot(after), logicalSnapshot(before));
  for (const previous of before.transaction_revision)
    assert.deepEqual(
      after.transaction_revision.find((row) => row.id === previous.id),
      previous,
    );
  let changed = 0;
  for (const row of after.financial_transaction) {
    const previous = aggregate(before, row.id),
      current = aggregate(after, row.id);
    if (
      JSON.stringify(canonical(previous)) === JSON.stringify(canonical(current))
    )
      continue;
    changed++;
    assert.equal(
      current.version,
      (BigInt(previous?.version ?? '0') + 1n).toString(),
    );
    const added = after.transaction_revision.filter(
      (revision) =>
        revision.transaction_id === row.id &&
        !before.transaction_revision.some((item) => item.id === revision.id),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0].version, current.version);
    assert.deepEqual(
      canonical(JSON.parse(added[0].snapshot)),
      canonical({
        format_version: 1,
        base_revision: previous?.version ?? '0',
        before: previous,
        after: current,
      }),
    );
  }
  assert.equal(
    after.financial_transaction.length,
    before.financial_transaction.length,
  );
  assert.equal(
    after.transaction_revision.length - before.transaction_revision.length,
    changed,
  );
}
export function referenceTotals(snapshot, asOf = '2026-10-31') {
  const balances = {};
  let assets = 0n,
    liabilities = 0n;
  for (const account of snapshot.financial_account) {
    const refs = snapshot.balance_reference.filter(
      (row) => row.account_id === account.id && row.status === 'ACTIVE',
    );
    assert.equal(refs.length, 1);
    const ref = refs[0];
    let amount = BigInt(ref.amount_minor);
    for (const tx of snapshot.financial_transaction.filter(
      (row) =>
        row.account_id === account.id &&
        row.deleted_at === null &&
        row.financial_date <= asOf,
    ))
      if (
        tx.financial_date > ref.reference_date ||
        (tx.financial_date === ref.reference_date &&
          ref.day_position === 'START_OF_DAY')
      )
        amount += BigInt(tx.account_amount_minor);
    balances[account.id] = amount.toString();
    if (account.balance_nature === 'ASSET') assets += amount;
    else liabilities += amount;
  }
  const periods = ['09', '10'].map((month) => {
    let income = 0n,
      expense = 0n,
      reversal = 0n,
      cashIn = 0n,
      cashOut = 0n;
    for (const tx of snapshot.financial_transaction.filter(
      (row) =>
        row.deleted_at === null &&
        row.financial_date.startsWith('2026-' + month),
    )) {
      const account = snapshot.financial_account.find(
          (row) => row.id === tx.account_id,
        ),
        delta = BigInt(tx.account_amount_minor),
        economic = account.balance_nature === 'ASSET' ? delta : -delta;
      if (tx.economic_kind === 'INCOME') income += economic;
      if (tx.economic_kind === 'EXPENSE') expense -= economic;
      if (tx.economic_kind === 'EXPENSE_REVERSAL') reversal += economic;
      if (account.balance_nature === 'ASSET') {
        if (delta > 0n) cashIn += delta;
        else cashOut -= delta;
      }
    }
    return Object.fromEntries(
      Object.entries({
        currency_code: 'BRL',
        income_minor: income,
        expense_minor: expense,
        expense_reversal_minor: reversal,
        net_expense_minor: expense - reversal,
        economic_result_minor: income - expense + reversal,
        cash_in_minor: cashIn,
        cash_out_minor: cashOut,
        cash_net_minor: cashIn - cashOut,
      }).map(([key, value]) => [key, String(value)]),
    );
  });
  return {
    balances,
    asset_balance_minor: assets.toString(),
    liability_balance_minor: liabilities.toString(),
    net_worth_minor: (assets - liabilities).toString(),
    periods,
  };
}
