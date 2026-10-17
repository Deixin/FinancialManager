// FIN-002 v1: deterministic and entirely synthetic. Golden totals are literal.
const id = (n) => '0199d025-0000-7000-8000-' + n.toString(16).padStart(12, '0');
const at = '2026-10-16T00:00:00.000Z';
const a = id(1),
  b = id(2),
  rows = [];
const add = (table, values) => rows.push({ table, values });
for (const [workspace, mode] of [
  [a, 'CLOUD'],
  [b, 'CLOUD'],
])
  add('workspace', {
    id: workspace,
    display_name: 'SYNTHETIC FIN-002',
    purpose: 'PERSONAL',
    storage_mode: mode,
    default_currency: 'BRL',
    sync_generation: id(workspace === a ? 91 : 92),
    created_at: at,
  });
for (const [n, workspace, kind, nature] of [
  [11, a, 'CHECKING', 'ASSET'],
  [12, a, 'SAVINGS', 'ASSET'],
  [13, a, 'CREDIT_CARD', 'LIABILITY'],
  [14, b, 'OTHER', 'ASSET'],
])
  add('financial_account', {
    id: id(n),
    workspace_id: workspace,
    name: 'SYNTHETIC ACCOUNT ' + n,
    account_kind: kind,
    balance_nature: nature,
    currency_code: 'BRL',
    status: 'ACTIVE',
    created_at: at,
  });
for (const [n, account, workspace, amount, position] of [
  [21, 11, a, '100000', 'START_OF_DAY'],
  [22, 12, a, '20000', 'END_OF_DAY'],
  [23, 13, a, '0', 'START_OF_DAY'],
  [24, 14, b, '0', 'START_OF_DAY'],
])
  add('balance_reference', {
    id: id(n),
    workspace_id: workspace,
    account_id: id(account),
    amount_minor: amount,
    reference_date: '2026-09-01',
    day_position: position,
    source: 'MANUAL',
    status: 'ACTIVE',
    created_at: at,
  });
for (const [n, name] of [
  [31, 'SYNTHETIC ENERGY'],
  [32, 'SYNTHETIC OTHER'],
])
  add('category', {
    id: id(n),
    workspace_id: a,
    name,
    category_scope: 'BOTH',
    sort_order: '0',
    status: 'ACTIVE',
    is_seeded: '0',
  });
add('subcategory', {
  id: id(33),
  workspace_id: a,
  category_id: id(31),
  name: 'SYNTHETIC CHILD',
  sort_order: '0',
  status: 'ACTIVE',
});
add('tag', {
  id: id(34),
  workspace_id: a,
  name: 'SYNTHETIC TAG',
  status: 'ACTIVE',
});
add('counterparty', {
  id: id(35),
  workspace_id: a,
  display_name: 'SYNTHETIC MERCHANT',
  status: 'ACTIVE',
});
for (const [n, kind] of [
  [41, 'TRANSFER'],
  [42, 'CARD_PAYMENT'],
  [43, 'CARD_PAYMENT'],
])
  add('transaction_group', {
    id: id(n),
    workspace_id: a,
    group_type: kind,
    state: 'ACTIVE',
    created_at: at,
  });
const tx = (
  n,
  account,
  date,
  amount,
  kind,
  group = null,
  deleted = false,
  workspace = a,
) =>
  add('financial_transaction', {
    id: id(n),
    workspace_id: workspace,
    account_id: id(account),
    group_id: group === null ? null : id(group),
    counterparty_id: account === 13 && kind === 'EXPENSE' ? id(35) : null,
    financial_date: date,
    account_amount_minor: amount,
    economic_kind: kind,
    display_name: 'SYNTHETIC FIN-002 MOVEMENT',
    original_description: null,
    origin_kind: 'MANUAL',
    version: '1',
    deleted_at: deleted ? at : null,
    created_at: at,
    updated_at: at,
  });
tx(100, 11, '2026-08-31', '-999', 'OTHER');
tx(101, 11, '2026-09-01', '50000', 'INCOME');
tx(102, 11, '2026-09-03', '-20000', 'EXPENSE');
tx(103, 13, '2026-09-10', '12000', 'EXPENSE');
tx(104, 11, '2026-09-15', '-10000', 'TRANSFER', 41);
tx(105, 12, '2026-09-15', '10000', 'TRANSFER', 41);
tx(106, 11, '2026-10-05', '-7000', 'DEBT_SETTLEMENT', 42);
tx(107, 13, '2026-10-05', '-7000', 'DEBT_SETTLEMENT', 42);
tx(108, 13, '2026-10-07', '-2000', 'EXPENSE_REVERSAL');
tx(109, 11, '2026-10-06', '-5000', 'DEBT_SETTLEMENT', 43);
tx(110, 13, '2026-10-06', '-5000', 'DEBT_SETTLEMENT', 43);
tx(111, 11, '2026-09-30', '500', 'ADJUSTMENT');
tx(112, 12, '2026-09-01', '-5000', 'OTHER');
tx(113, 11, '2026-09-05', '-88888', 'EXPENSE', null, true);
for (const [n, amount] of [
  [201, '9223372036854775807'],
  [202, '-9223372036854775808'],
  [203, '9007199254740993'],
  [204, '-9007199254740993'],
])
  tx(n, 14, '2026-09-02', amount, 'OTHER', null, false, b);
for (const [n, transaction, category, amount, child] of [
  [301, 102, 32, '20000', null],
  [302, 103, 31, '2000', 33],
  [303, 103, 32, '10000', null],
])
  add('transaction_allocation', {
    id: id(n),
    workspace_id: a,
    transaction_id: id(transaction),
    category_id: id(category),
    subcategory_id: child === null ? null : id(child),
    amount_minor: amount,
    note: null,
  });
add('transaction_tag', {
  workspace_id: a,
  transaction_id: id(103),
  tag_id: id(34),
});
add('transaction_revision', {
  id: id(401),
  workspace_id: a,
  transaction_id: id(113),
  version: '1',
  snapshot: '{}',
  actor_type: 'SYSTEM',
  actor_id: null,
  device_id: null,
  change_source: 'SYSTEM',
  created_at: at,
});
export const canonical = {
  format_version: 1,
  dataset_id: 'FIN-002',
  dataset_version: 1,
  synthetic_only: true,
  workspace_a: a,
  workspace_b: b,
  seed: rows,
  expected: {
    balances: [
      {
        workspace_id: a,
        account_id: id(11),
        as_of: '2026-09-30',
        amount_minor: '120500',
      },
      {
        workspace_id: a,
        account_id: id(12),
        as_of: '2026-09-30',
        amount_minor: '30000',
      },
      {
        workspace_id: a,
        account_id: id(13),
        as_of: '2026-09-30',
        amount_minor: '12000',
      },
      {
        workspace_id: a,
        account_id: id(11),
        as_of: '2026-10-31',
        amount_minor: '108500',
      },
      {
        workspace_id: a,
        account_id: id(12),
        as_of: '2026-10-31',
        amount_minor: '30000',
      },
      {
        workspace_id: a,
        account_id: id(13),
        as_of: '2026-10-31',
        amount_minor: '-2000',
      },
      {
        workspace_id: b,
        account_id: id(14),
        as_of: '2026-10-31',
        amount_minor: '-1',
      },
    ],
    reports: [
      {
        workspace_id: a,
        from: '2026-09-01',
        to: '2026-09-30',
        totals: {
          currency_code: 'BRL',
          income_minor: '50000',
          expense_minor: '32000',
          expense_reversal_minor: '0',
          net_expense_minor: '32000',
          economic_result_minor: '18000',
          cash_in_minor: '60500',
          cash_out_minor: '35000',
          cash_net_minor: '25500',
        },
      },
      {
        workspace_id: a,
        from: '2026-10-01',
        to: '2026-10-31',
        totals: {
          currency_code: 'BRL',
          income_minor: '0',
          expense_minor: '0',
          expense_reversal_minor: '2000',
          net_expense_minor: '-2000',
          economic_result_minor: '2000',
          cash_in_minor: '0',
          cash_out_minor: '12000',
          cash_net_minor: '-12000',
        },
      },
    ],
    wealth: [
      {
        as_of: '2026-09-30',
        asset_balance_minor: '150500',
        liability_balance_minor: '12000',
        net_worth_minor: '138500',
      },
      {
        as_of: '2026-10-31',
        asset_balance_minor: '138500',
        liability_balance_minor: '-2000',
        net_worth_minor: '140500',
      },
    ],
    allocations: [
      { transaction_id: id(102), amount_minor: '20000' },
      { transaction_id: id(103), amount_minor: '12000' },
    ],
  },
  document_search_vector: {
    synthetic_only: true,
    status: 'VECTOR_ONLY_DOCUMENT_SCHEMA_PENDING',
    document_id: id(501),
    purchase_transaction_id: id(103),
    items: [
      {
        id: id(511),
        description: 'SYNTHETIC ENERGETICO',
        quantity: '2',
        unit_amount_minor: '1000',
        amount_minor: '2000',
        matches: true,
      },
      {
        id: id(512),
        description: 'SYNTHETIC OTHER ITEM',
        quantity: '1',
        unit_amount_minor: '10000',
        amount_minor: '10000',
        matches: false,
      },
    ],
    payments: [
      { transaction_id: id(106), amount_minor: '7000' },
      { transaction_id: id(109), amount_minor: '5000' },
    ],
    expected: {
      document_total_minor: '12000',
      matched_items_minor: '2000',
      payment_total_minor: '12000',
      matching_item_count: 1,
    },
  },
};
