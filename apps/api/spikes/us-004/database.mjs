import pg from 'pg';
import { createHash } from 'node:crypto';

export function createSpikePool({ password, user = 'us004_runtime', max = 1 }) {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: 43184,
    database: 'us004',
    user,
    password,
    max,
    ssl: false,
    options: '-c search_path=pg_catalog',
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    query_timeout: 10_000,
    application_name: 'us004-synthetic-spike',
  });
  pool.on('error', () => {
    /* Failed idle sockets are evicted; never log pg errors. */
  });
  pool.on('connect', (client) =>
    client.on('error', () => {
      /* Active query promises carry connection failures. */
    }),
  );
  return pool;
}

export async function withSchemaOwner(pool, operation) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE us004_owner');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function applySpikeMigration(pool, sql) {
  const checksum = createHash('sha256').update(sql).digest('hex');
  return await withSchemaOwner(pool, async (client) => {
    const existing = await client.query(
      "SELECT to_regclass('us004.schema_version') AS relation",
    );
    if (existing.rows[0].relation) {
      const version = await client.query(
        'SELECT version, checksum FROM us004.schema_version',
      );
      if (
        version.rowCount !== 1 ||
        version.rows[0].version !== 1 ||
        version.rows[0].checksum !== checksum
      )
        throw new Error('SPIKE_MIGRATION_MISMATCH');
      return checksum;
    }
    await client.query(sql);
    await client.query(
      'INSERT INTO us004.schema_version(version, checksum) VALUES (1, $1)',
      [checksum],
    );
    return checksum;
  });
}
