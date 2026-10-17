import { createApiIdentity } from '../../apps/api/dist/identity.js';
import { createSqliteRevisionService } from '../../packages/storage-schema/dist/revisions.js';
import { createPostgresRevisionService } from '../../packages/persistence-postgres/dist/revisions.js';
import {
  readSnapshot,
  postgresFixtureConnection,
} from '../fixtures/loader.mjs';
import { stateFromSnapshot, grant, ids } from './scenarios.mjs';
export function createRevisionHarness(engine, { sqlite, pools, admin }) {
  const units = [];
  const database = () => sqlite().db;
  async function sql(workspace, text, values = []) {
    if (engine === 'sqlite') return database().rows(text, values);
    const connection = await postgresFixtureConnection(
      workspace === ids.b ? pools.b : pools.a,
      workspace,
    );
    try {
      await connection.exec('BEGIN IMMEDIATE');
      const result = await connection.rows(text, values);
      await connection.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        await connection.exec('ROLLBACK');
      } catch {
        /* caller closes */
      }
      throw error;
    } finally {
      await connection.close();
    }
  }
  function make(workspace, overrides = {}) {
    let revisionWrites = 0;
    const failAt =
      overrides.fail_revision === true ? 1 : overrides.fail_revision;
    const identity = createApiIdentity(),
      options = {
        authorize: overrides.authorize ?? (async (input) => grant(input)),
        identity: overrides.clock
          ? { newId: () => identity.newId(), nowInstant: () => overrides.clock }
          : identity,
        change_source: 'MANUAL',
      };
    let unit;
    if (engine === 'sqlite') {
      const db = database();
      const connection = overrides.fail_revision
        ? {
            ...db,
            async run(text, values) {
              if (
                /^INSERT INTO transaction_revision\b/i.test(text) &&
                ++revisionWrites === failAt
              )
                throw Error('SYNTHETIC_PRIVATE_REVISION_CANARY');
              return db.run(text, values);
            },
          }
        : db;
      unit = createSqliteRevisionService({ ...options, connection });
    } else {
      const pool = workspace === ids.b ? pools.b : pools.a;
      const guarded = {
        options: pool.options,
        end: () => pool.end(),
        async connect() {
          const client = await pool.connect();
          return new Proxy(client, {
            get(target, key) {
              if (key === 'query')
                return async (text, values = []) => {
                  if (
                    overrides.fail_revision &&
                    /^insert into "fm"\."transaction_revision"/i.test(text) &&
                    ++revisionWrites === failAt
                  )
                    throw Error('SYNTHETIC_PRIVATE_REVISION_CANARY');
                  const result = await target.query(text, values);
                  if (
                    overrides.kill_after_update &&
                    /^update "fm"\."financial_transaction"/i.test(text)
                  )
                    await admin.query('SELECT pg_terminate_backend($1)', [
                      client.processID,
                    ]);
                  return result;
                };
              if (key === 'release')
                return (discard) => target.release(discard);
              return Reflect.get(target, key, target);
            },
          });
        },
      };
      unit = createPostgresRevisionService({
        ...options,
        pool: guarded,
        expected_role: workspace === ids.b ? 'us021_b' : 'us021_a',
      });
    }
    units.push(unit);
    return unit;
  }
  async function snapshot(workspace) {
    if (engine === 'sqlite')
      return (await readSnapshot(database(), 'sqlite', workspace)).snapshot;
    const connection = await postgresFixtureConnection(
      workspace === ids.b ? pools.b : pools.a,
      workspace,
    );
    try {
      return (await readSnapshot(connection, 'postgresql', workspace)).snapshot;
    } finally {
      await connection.close();
    }
  }
  return {
    make,
    sql,
    snapshot,
    state: async (workspace, id) =>
      stateFromSnapshot(await snapshot(workspace), id),
    async history(workspace, id) {
      const text =
        engine === 'sqlite'
          ? 'SELECT id,CAST(version AS TEXT) AS version,snapshot,actor_type,actor_id,device_id,change_source,created_at FROM transaction_revision WHERE workspace_id=? AND transaction_id=? ORDER BY transaction_revision.version'
          : `SELECT id::text,version::text,snapshot::text,actor_type,actor_id,device_id::text,change_source,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at FROM fm.transaction_revision WHERE workspace_id=$1 AND transaction_id=$2 ORDER BY transaction_revision.version`;
      return (await sql(workspace, text, [workspace, id])).map((row) => ({
        ...row,
        snapshot: JSON.parse(row.snapshot),
      }));
    },
    async setVersion(workspace, id, version) {
      await sql(
        workspace,
        engine === 'sqlite'
          ? 'UPDATE financial_transaction SET version=? WHERE workspace_id=? AND id=? RETURNING id'
          : 'UPDATE fm.financial_transaction SET version=$1 WHERE workspace_id=$2 AND id=$3 RETURNING id',
        [version, workspace, id],
      );
    },
    async mutateHistory(workspace, id) {
      await sql(
        workspace,
        engine === 'sqlite'
          ? "UPDATE transaction_revision SET snapshot='{}' WHERE workspace_id=? AND id=? RETURNING id"
          : "UPDATE fm.transaction_revision SET snapshot='{}' WHERE workspace_id=$1 AND id=$2 RETURNING id",
        [workspace, id],
      );
    },
    async close() {
      const results = await Promise.allSettled(
        units.map((unit) => unit.close()),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw Error('REVISION_UNITS_CLEANUP_FAILED');
    },
  };
}
