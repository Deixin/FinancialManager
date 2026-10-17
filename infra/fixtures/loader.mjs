import { canonicalFixture as fixture } from '../../packages/test-fixtures/dist/canonical.js';
import { normalizedName } from '../../packages/storage-schema/dist/index.js';
export { fixture };
export const tables = Object.freeze([
  'workspace',
  'financial_account',
  'balance_reference',
  'category',
  'subcategory',
  'tag',
  'counterparty',
  'transaction_group',
  'financial_transaction',
  'transaction_allocation',
  'transaction_tag',
  'transaction_revision',
]);
const identifier = /^[a-z_]+$/;
export function fixtureRows(workspace) {
  if (![fixture.workspace_a, fixture.workspace_b].includes(workspace))
    throw Error('FIXTURE_WORKSPACE_INVALID');
  return fixture.seed.filter(
    (row) =>
      (row.table === 'workspace' ? row.values.id : row.values.workspace_id) ===
      workspace,
  );
}
function engineName(engine) {
  if (!['postgresql', 'sqlite'].includes(engine))
    throw Error('FIXTURE_ENGINE_INVALID');
  return engine === 'postgresql' ? 'fm.' : '';
}
export function fixtureStatements(engine, workspace) {
  const prefix = engineName(engine);
  return fixtureRows(workspace).map((row) => {
    if (!tables.includes(row.table)) throw Error('FIXTURE_TABLE_INVALID');
    const values = { ...row.values };
    if (engine === 'sqlite' && ['category', 'tag'].includes(row.table))
      values.normalized_name = normalizedName(values.name);
    const fields = Object.keys(values);
    if (fields.some((name) => !identifier.test(name)))
      throw Error('FIXTURE_COLUMN_INVALID');
    return {
      sql: `INSERT INTO ${prefix}${row.table}(${fields.join(',')}) VALUES (${fields.map((_, i) => (engine === 'postgresql' ? '$' + (i + 1) : '?')).join(',')})`,
      parameters: Object.values(values),
    };
  });
}
// Test tooling only: exclusive connection, known synthetic workspaces, no HTTP/IPC entrypoint.
export async function loadFixture(db, engine, workspace) {
  const statements = fixtureStatements(engine, workspace);
  let active = false;
  try {
    await db.exec('BEGIN IMMEDIATE');
    active = true;
    for (const statement of statements)
      await db.run(statement.sql, statement.parameters);
    await db.exec('COMMIT');
    active = false;
  } catch {
    if (active)
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* caller disposes the connection */
      }
    throw Error('FIXTURE_LOAD_FAILED');
  }
}
export function expectedSnapshot(workspace) {
  return Object.fromEntries(
    tables.map((table) => [
      table,
      fixtureRows(workspace)
        .filter((row) => row.table === table)
        .map((row) => ({ ...row.values }))
        .sort((x, y) =>
          (x.id ?? x.transaction_id).localeCompare(y.id ?? y.transaction_id),
        ),
    ]),
  );
}
export async function readSnapshot(db, engine, workspace) {
  const prefix = engineName(engine),
    expected = expectedSnapshot(workspace),
    snapshot = {};
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) {
      const sample = fixture.seed.find((row) => row.table === table);
      const fields = Object.keys(sample.values);
      const columns = fields.map((name) => {
        if (
          engine === 'postgresql' &&
          /^(created_at|updated_at|deleted_at)$/.test(name)
        )
          return `to_char(${name} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${name}`;
        if (engine === 'postgresql' && name === 'is_seeded')
          return `CASE WHEN ${name} THEN '1' ELSE '0' END AS ${name}`;
        return `CAST(${name} AS TEXT) AS ${name}`;
      });
      const key = table === 'workspace' ? 'id' : 'workspace_id',
        order = table === 'transaction_tag' ? 'transaction_id,tag_id' : 'id';
      snapshot[table] = await db.rows(
        `SELECT ${columns.join(',')} FROM ${prefix}${table} WHERE ${key}=${engine === 'postgresql' ? '$1' : '?'} ORDER BY ${order}`,
        [workspace],
      );
    }
    await db.exec('COMMIT');
    return { snapshot, expected };
  } catch {
    try {
      await db.exec('ROLLBACK');
    } catch {
      /* caller disposes */
    }
    throw Error('FIXTURE_SNAPSHOT_FAILED');
  }
}
export async function postgresFixtureConnection(pool, workspace) {
  fixtureRows(workspace);
  const client = await pool.connect();
  let active = false,
    discard = false;
  return {
    async exec(sql) {
      if (sql === 'BEGIN IMMEDIATE') {
        await client.query('BEGIN');
        active = true;
        await client.query("SELECT set_config('app.workspace_id',$1,true)", [
          workspace,
        ]);
      } else {
        await client.query(sql);
        if (sql === 'COMMIT' || sql === 'ROLLBACK') active = false;
      }
    },
    async run(sql, parameters) {
      await client.query(sql, parameters);
    },
    async rows(sql, parameters = []) {
      return (await client.query(sql, parameters)).rows;
    },
    async close() {
      if (active)
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      client.release(discard);
    },
  };
}
