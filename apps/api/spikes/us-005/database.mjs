import pg from 'pg';
import { createHash } from 'node:crypto';
import { SyncError, uuid } from './protocol.mjs';
export function createPool({ password, user = 'us005_runtime', max = 6 }) {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: 43186,
    database: 'us005',
    user,
    password,
    max,
    ssl: false,
    options: '-c search_path=pg_catalog',
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    query_timeout: 10000,
    application_name: 'us005-synthetic-spike',
  });
  pool.on('error', () => {});
  pool.on('connect', (client) => client.on('error', () => {}));
  return pool;
}
export async function ownerTransaction(pool, action) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE us005_owner');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
export async function migrate(pool, sql) {
  const checksum = createHash('sha256').update(sql).digest('hex');
  await ownerTransaction(pool, async (client) => {
    const existing = await client.query(
      "SELECT to_regclass('us005.schema_version') AS name",
    );
    if (existing.rows[0].name) {
      const rows = (await client.query('SELECT * FROM us005.schema_version'))
        .rows;
      if (
        rows.length !== 1 ||
        rows[0].version !== 1 ||
        rows[0].checksum !== checksum
      )
        throw new SyncError('MIGRATION_MISMATCH');
    } else {
      await client.query(sql);
      await client.query('INSERT INTO us005.schema_version VALUES(1,$1)', [
        checksum,
      ]);
    }
  });
  return checksum;
}
// Identity comes from the transport's trusted synthetic session, never the body.
export async function inWorkspace(pool, context, workspaceId, action) {
  if (!uuid(workspaceId) || !uuid(context?.userId) || !uuid(context?.deviceId))
    throw new SyncError('REJECTED_PERMISSION');
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)",
      [workspaceId, context.userId],
    );
    // One stream lock serializes authorization, receipt, revision and cursor COMMIT order.
    const workspace = (
      await client.query(
        'SELECT * FROM us005.workspace WHERE id=$1 FOR UPDATE',
        [workspaceId],
      )
    ).rows[0];
    if (!workspace) throw new SyncError('REJECTED_PERMISSION');
    const member = (
      await client.query(
        'SELECT * FROM us005.membership WHERE workspace_id=$1 AND user_id=$2 FOR SHARE',
        [workspaceId, context.userId],
      )
    ).rows[0];
    const device = (
      await client.query(
        'SELECT * FROM us005.device WHERE workspace_id=$1 AND user_id=$2 AND id=$3 FOR SHARE',
        [workspaceId, context.userId, context.deviceId],
      )
    ).rows[0];
    if (!member?.active || !device?.active)
      throw new SyncError('REJECTED_PERMISSION');
    await client.query(
      'SELECT account_id FROM us005.account_scope WHERE workspace_id=$1 AND user_id=$2 FOR SHARE',
      [workspaceId, context.userId],
    );
    const result = await action(client, workspace, member);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    if (error instanceof SyncError) throw error;
    throw new SyncError('REQUEST_FAILED');
  } finally {
    client.release(broken);
  }
}
