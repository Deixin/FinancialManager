// FIN-SCHEMA-001: synthetic persisted corpus. Every runtime consumes these vectors.
const id = (n) => '0199d021-0000-7000-8000-' + n.toString(16).padStart(12, '0');
export const workspaceA = id(1),
  workspaceB = id(2);
const seed = [];
const add = (table, values) => seed.push({ table, values });
for (const [workspace, account] of [
  [workspaceA, id(11)],
  [workspaceB, id(12)],
]) {
  add('workspace', {
    id: workspace,
    display_name: 'Synthetic US021',
    purpose: 'PERSONAL',
    storage_mode: 'CLOUD',
    default_currency: 'BRL',
    sync_generation: id(90),
    created_at: '2026-10-16T00:00:00.000Z',
  });
  add('financial_account', {
    id: account,
    workspace_id: workspace,
    name: 'Synthetic bank',
    account_kind: 'CHECKING',
    balance_nature: 'ASSET',
    currency_code: 'BRL',
    status: 'ACTIVE',
  });
  add('category', {
    id: workspace === workspaceA ? id(21) : id(22),
    workspace_id: workspace,
    name: 'Synthetic category',
    category_scope: 'BOTH',
    sort_order: '0',
    status: 'ACTIVE',
    is_seeded: '0',
  });
}
for (const [n, kind, nature] of [
  [13, 'SAVINGS', 'ASSET'],
  [14, 'CREDIT_CARD', 'LIABILITY'],
  [15, 'OTHER', 'ASSET'],
])
  add('financial_account', {
    id: id(n),
    workspace_id: workspaceA,
    name: 'Synthetic ' + kind,
    account_kind: kind,
    balance_nature: nature,
    currency_code: 'BRL',
    status: 'ACTIVE',
  });
for (const [n, group_type] of [
  [51, 'TRANSFER'],
  [52, 'CARD_PAYMENT'],
])
  add('transaction_group', {
    id: id(n),
    workspace_id: workspaceA,
    group_type,
    state: 'ACTIVE',
  });
add('subcategory', {
  id: id(31),
  workspace_id: workspaceA,
  category_id: id(21),
  name: 'Synthetic child',
  sort_order: '0',
  status: 'ACTIVE',
});
add('category', {
  id: id(23),
  workspace_id: workspaceA,
  name: 'Synthetic alternate',
  category_scope: 'BOTH',
  sort_order: '0',
  status: 'ACTIVE',
  is_seeded: '0',
});
add('tag', {
  id: id(41),
  workspace_id: workspaceA,
  name: 'Synthetic tag',
  status: 'ACTIVE',
});
add('balance_reference', {
  id: id(71),
  workspace_id: workspaceA,
  account_id: id(11),
  amount_minor: '100000',
  reference_date: '2026-09-01',
  day_position: 'START_OF_DAY',
  source: 'MANUAL',
  status: 'ACTIVE',
});
const tx = (
  n,
  account,
  amount,
  kind = 'EXPENSE',
  date = '2026-10-16',
  group = null,
) => ({
  id: id(n),
  workspace_id: workspaceA,
  account_id: id(account),
  account_amount_minor: amount,
  economic_kind: kind,
  financial_date: date,
  group_id: group === null ? null : id(group),
  display_name: 'SYNTHETIC_US021_MOVEMENT',
  origin_kind: 'MANUAL',
  version: '1',
  created_at: '2026-10-16T00:00:00.000Z',
  updated_at: '2026-10-16T00:00:00.000Z',
});
for (const values of [
  tx(101, 11, '50000', 'INCOME', '2026-09-02'),
  tx(102, 11, '-20000', 'EXPENSE', '2026-09-03'),
  tx(103, 14, '12000', 'EXPENSE', '2026-09-10'),
  tx(104, 11, '-10000', 'TRANSFER', '2026-09-15', 51),
  tx(105, 13, '10000', 'TRANSFER', '2026-09-15', 51),
  tx(106, 11, '-12000', 'DEBT_SETTLEMENT', '2026-10-05', 52),
  tx(107, 14, '-12000', 'DEBT_SETTLEMENT', '2026-10-05', 52),
  tx(108, 14, '-2000', 'EXPENSE_REVERSAL', '2026-10-07'),
  tx(201, 15, '9223372036854775807'),
  tx(202, 15, '-9223372036854775808'),
  tx(203, 15, '9007199254740993'),
  tx(204, 15, '-100'),
  tx(205, 15, '-4294967297'),
])
  add('financial_transaction', values);
const cases = [];
const query = (name, sql, parameters, rows) =>
  cases.push({ name, statements: [], query: { sql, parameters, rows } });
const statement = (sql, parameters = []) => ({ sql, parameters });
const reject = (name, sql, parameters = []) =>
  cases.push({ name, statements: [statement(sql, parameters)], reject: true });
const write = (name, statements, sql, parameters, rows) =>
  cases.push({ name, statements, query: { sql, parameters, rows } });
const insert = (table, values) =>
  statement(
    `INSERT INTO ${table}(${Object.keys(values).join(',')}) VALUES (${Object.keys(
      values,
    )
      .map(() => '?')
      .join(',')})`,
    Object.values(values),
  );
const allocation = (n, movement, amount, category = 21, subcategory = null) =>
  insert('transaction_allocation', {
    id: id(n),
    workspace_id: workspaceA,
    transaction_id: id(movement),
    category_id: id(category),
    subcategory_id: subcategory === null ? null : id(subcategory),
    amount_minor: amount,
  });
query(
  'bank_balance_exact',
  'SELECT CAST(100000+sum(account_amount_minor) AS TEXT) AS balance FROM financial_transaction WHERE account_id=? AND deleted_at IS NULL',
  [id(11)],
  [{ balance: '108000' }],
);
query(
  'savings_balance_exact',
  'SELECT CAST(sum(account_amount_minor) AS TEXT) AS balance FROM financial_transaction WHERE account_id=?',
  [id(13)],
  [{ balance: '10000' }],
);
query(
  'card_debt_signed',
  'SELECT CAST(sum(account_amount_minor) AS TEXT) AS balance FROM financial_transaction WHERE account_id=?',
  [id(14)],
  [{ balance: '-2000' }],
);
query(
  'consumption_excludes_transfers_and_settlement',
  "SELECT CAST(sum(CASE WHEN economic_kind='EXPENSE' THEN abs(account_amount_minor) WHEN economic_kind='EXPENSE_REVERSAL' THEN -abs(account_amount_minor) ELSE 0 END) AS TEXT) AS consumed FROM financial_transaction WHERE account_id IN(?,?,?)",
  [id(11), id(13), id(14)],
  [{ consumed: '30000' }],
);
query(
  'i64_limits_and_precision_neighbors',
  'SELECT CAST(account_amount_minor AS TEXT) AS amount FROM financial_transaction WHERE id IN(?,?,?) ORDER BY id',
  [id(201), id(202), id(203)],
  [
    { amount: '9223372036854775807' },
    { amount: '-9223372036854775808' },
    { amount: '9007199254740993' },
  ],
);
query(
  'keyset_same_day_tie_break',
  'SELECT id FROM financial_transaction WHERE financial_date=? AND id<? ORDER BY financial_date DESC,id DESC LIMIT 1',
  ['2026-10-05', id(108)],
  [{ id: id(107) }],
);
reject(
  'fractional_money_rejected',
  'UPDATE financial_transaction SET account_amount_minor=? WHERE id=?',
  ['1.5', id(204)],
);
reject(
  'i64_overflow_rejected',
  'UPDATE financial_transaction SET account_amount_minor=? WHERE id=?',
  ['9223372036854775808', id(204)],
);
reject(
  'cross_workspace_account_fk',
  'UPDATE financial_transaction SET account_id=? WHERE id=?',
  [id(12), id(204)],
);
reject(
  'cross_workspace_category_fk',
  allocation(301, 204, '100', 22).sql,
  allocation(301, 204, '100', 22).parameters,
);
reject(
  'subcategory_must_match_category',
  allocation(301, 204, '100', 23, 31).sql,
  allocation(301, 204, '100', 23, 31).parameters,
);
reject(
  'impossible_financial_date',
  'UPDATE financial_transaction SET financial_date=? WHERE id=?',
  ['2025-02-29', id(204)],
);
reject(
  'submillisecond_instant_rejected',
  'UPDATE financial_transaction SET updated_at=? WHERE id=?',
  ['2026-10-16T00:00:00.123456Z', id(204)],
);
reject(
  'nonfinite_instant_rejected',
  'UPDATE financial_transaction SET updated_at=? WHERE id=?',
  ['infinity', id(204)],
);
reject(
  'identity_immutable',
  'UPDATE financial_transaction SET id=? WHERE id=?',
  [id(999), id(204)],
);
reject(
  'card_cannot_be_asset',
  'UPDATE financial_account SET balance_nature=? WHERE id=?',
  ['ASSET', id(14)],
);
reject(
  'positive_allocations_required',
  allocation(301, 204, '0').sql,
  allocation(301, 204, '0').parameters,
);
write(
  'complete_split_at_commit',
  [allocation(302, 204, '40'), allocation(303, 204, '60')],
  'SELECT CAST(sum(amount_minor) AS TEXT) AS total FROM transaction_allocation WHERE transaction_id=?',
  [id(204)],
  [{ total: '100' }],
);
reject(
  'partial_split_rolls_back_at_commit',
  'UPDATE transaction_allocation SET amount_minor=? WHERE id=?',
  ['39', id(302)],
);
write(
  'amount_and_split_change_atomically',
  [
    statement(
      'UPDATE financial_transaction SET account_amount_minor=? WHERE id=?',
      ['-101', id(204)],
    ),
    statement('UPDATE transaction_allocation SET amount_minor=? WHERE id=?', [
      '61',
      id(303),
    ]),
  ],
  'SELECT CAST(sum(amount_minor) AS TEXT) AS total FROM transaction_allocation WHERE transaction_id=?',
  [id(204)],
  [{ total: '101' }],
);
write(
  'int64_min_magnitude_without_overflow',
  [allocation(304, 202, '9223372036854775807'), allocation(305, 202, '1')],
  'SELECT CAST(amount_minor AS TEXT) AS amount FROM transaction_allocation WHERE transaction_id=? ORDER BY id',
  [id(202)],
  [{ amount: '9223372036854775807' }, { amount: '1' }],
);
write(
  'low_limb_carry_is_exact',
  [allocation(306, 205, '4294967295'), allocation(307, 205, '2')],
  'SELECT CAST(account_amount_minor AS TEXT) AS amount FROM financial_transaction WHERE id=?',
  [id(205)],
  [{ amount: '-4294967297' }],
);
cases.push({
  name: 'oversized_split_total_rejected_without_float',
  statements: [
    allocation(308, 201, '9223372036854775807'),
    allocation(309, 201, '9223372036854775807'),
    allocation(310, 201, '1'),
  ],
  reject: true,
});
const revision = insert('transaction_revision', {
  id: id(401),
  workspace_id: workspaceA,
  transaction_id: id(204),
  version: '1',
  snapshot: '{"synthetic_only":true,"account_amount_minor":"-101"}',
  actor_type: 'SYSTEM',
  change_source: 'SYSTEM',
});
write(
  'revision_persists_exact_snapshot',
  [revision],
  'SELECT CAST(version AS TEXT) AS version FROM transaction_revision WHERE id=?',
  [id(401)],
  [{ version: '1' }],
);
reject(
  'revision_cannot_be_updated',
  'UPDATE transaction_revision SET snapshot=? WHERE id=?',
  ['{}', id(401)],
);
reject(
  'revision_cannot_be_deleted',
  'DELETE FROM transaction_revision WHERE id=?',
  [id(401)],
);
reject(
  'revision_number_unique',
  insert('transaction_revision', {
    id: id(402),
    workspace_id: workspaceA,
    transaction_id: id(204),
    version: '1',
    snapshot: '{}',
    actor_type: 'SYSTEM',
    change_source: 'SYSTEM',
  }).sql,
  insert('transaction_revision', {
    id: id(402),
    workspace_id: workspaceA,
    transaction_id: id(204),
    version: '1',
    snapshot: '{}',
    actor_type: 'SYSTEM',
    change_source: 'SYSTEM',
  }).parameters,
);
write(
  'soft_delete_preserves_revision',
  [
    statement('UPDATE financial_transaction SET deleted_at=? WHERE id=?', [
      '2026-10-16T01:00:00.000Z',
      id(204),
    ]),
  ],
  'SELECT CAST(count(*) AS TEXT) AS count FROM transaction_revision WHERE transaction_id=?',
  [id(204)],
  [{ count: '1' }],
);
reject(
  'referenced_transaction_cannot_be_deleted',
  'DELETE FROM financial_transaction WHERE id=?',
  [id(204)],
);
// Names are normalized at the storage port; PostgreSQL also derives the column.
const nameRow = (n, name, status = 'ACTIVE') => ({
  id: id(n),
  workspace_id: workspaceA,
  name,
  normalized_name: name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase(),
  category_scope: 'BOTH',
  sort_order: '0',
  status,
  is_seeded: '0',
});
write(
  'unicode_name_normalization',
  [insert('category', nameRow(501, '  CAFÉ   Mensal  '))],
  'SELECT normalized_name FROM category WHERE id=?',
  [id(501)],
  [{ normalized_name: 'café mensal' }],
);
reject(
  'normalized_active_name_unique',
  insert('category', nameRow(502, 'café mensal')).sql,
  insert('category', nameRow(502, 'café mensal')).parameters,
);
write(
  'archived_name_does_not_reserve_active_key',
  [insert('category', nameRow(503, 'CAFÉ MENSAL', 'ARCHIVED'))],
  'SELECT CAST(count(*) AS TEXT) AS count FROM category WHERE normalized_name=?',
  ['café mensal'],
  [{ count: '2' }],
);
query(
  'utc_millisecond_roundtrip',
  'SELECT CAST(count(*) AS TEXT) AS count FROM financial_transaction WHERE created_at=?',
  ['2026-10-16T00:00:00.000Z'],
  [{ count: '13' }],
);
for (const row of seed)
  if (['category', 'tag'].includes(row.table))
    row.values.normalized_name = row.values.name
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLowerCase();
export const corpus = Object.freeze({
  format_version: 1,
  synthetic_only: true,
  workspace_a: workspaceA,
  workspace_b: workspaceB,
  seed,
  cases,
});
