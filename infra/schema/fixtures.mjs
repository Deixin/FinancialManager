// Entirely synthetic. Stable UUIDs are vectors, not production ID generation.
export const id = (number) =>
  '0199c111-0000-7000-8000-' + number.toString(16).padStart(12, '0');
export const tables = Object.freeze([
  'workspace',
  'financial_account',
  'balance_reference',
  'transaction_group',
  'counterparty',
  'category',
  'subcategory',
  'tag',
  'financial_transaction',
  'transaction_allocation',
  'transaction_tag',
  'transaction_revision',
]);
export const sentinels = Object.freeze([
  'SYNTHETIC_FINANCIAL_DESCRIPTION_US020',
  'SYNTHETIC_TAX_0000A123',
  '9007199254740993',
]);
export function createPool(pg, user, password, max = 1) {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: 43220,
    database: 'us020',
    user,
    password,
    max,
    options: '-c search_path=pg_catalog -c timezone=UTC',
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 1000,
    query_timeout: 10000,
    // Keep dates/instants exact in the harness; don't round them through JS Date.
    types: {
      getTypeParser(oid, format) {
        return [1082, 1184].includes(oid)
          ? (value) => value
          : pg.types.getTypeParser(oid, format);
      },
    },
  });
  pool.on('error', () => {});
  pool.on('connect', (client) => client.on('error', () => {}));
  return pool;
}
export async function inWorkspace(pool, workspace, operation) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id',$1,true)", [
      workspace,
    ]);
    await client.query(
      "SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'",
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    // No financial/error message/SQL values leave the fixture transaction port.
    const safe = new Error('SYNTHETIC_DATABASE_REJECTED');
    safe.sqlState = error?.code;
    throw safe;
  } finally {
    client.release(discard);
  }
}
export const account = (tx, workspace, accountId, card = false) =>
  tx.query(
    `INSERT INTO fm.financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status)
   VALUES ($1,$2,'Synthetic account',$3,$4,'BRL','ACTIVE')`,
    [
      accountId,
      workspace,
      card ? 'CREDIT_CARD' : 'CHECKING',
      card ? 'LIABILITY' : 'ASSET',
    ],
  );
export const movement = (
  tx,
  workspace,
  accountId,
  movementId,
  amount = '-100',
  extra = {},
) => {
  const columns = [
    'id',
    'workspace_id',
    'account_id',
    'account_amount_minor',
    'financial_date',
    'economic_kind',
    'display_name',
    'origin_kind',
    'version',
    ...Object.keys(extra),
  ];
  const values = [
    movementId,
    workspace,
    accountId,
    amount,
    '2026-10-16',
    'EXPENSE',
    sentinels[0],
    'MANUAL',
    '1',
    ...Object.values(extra),
  ];
  // Extra column names come only from this closed, trusted synthetic protocol.
  if (
    Object.keys(extra).some(
      (key) =>
        ![
          'group_id',
          'counterparty_id',
          'created_at',
          'updated_at',
          'deleted_at',
        ].includes(key),
    )
  )
    throw new Error('FIXTURE_COLUMN_INVALID');
  return tx.query(
    `INSERT INTO fm.financial_transaction(${columns.join(',')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(',')})`,
    values,
  );
};
export const category = (
  tx,
  workspace,
  categoryId,
  name = 'Synthetic category',
  status = 'ACTIVE',
) =>
  tx.query(
    `INSERT INTO fm.category(id,workspace_id,name,category_scope,sort_order,status,is_seeded) VALUES ($1,$2,$3,'BOTH',0,$4,false)`,
    [categoryId, workspace, name, status],
  );
export const split = (
  tx,
  workspace,
  movementId,
  categoryId,
  splitId,
  amount,
  subcategoryId = null,
) =>
  tx.query(
    `INSERT INTO fm.transaction_allocation(id,workspace_id,transaction_id,category_id,amount_minor,subcategory_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [splitId, workspace, movementId, categoryId, amount, subcategoryId],
  );
