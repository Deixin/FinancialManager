// Synthetic operator fixture only. Product access always uses the service below.
import { createSqliteImportCentralService } from '../../packages/storage-schema/dist/import-central.js';
import { createPostgresImportCentralService } from '../../packages/persistence-postgres/dist/import-central.js';
import {
  fixture,
  readSnapshot,
  postgresFixtureConnection,
} from '../fixtures/loader.mjs';
export const id = (n) =>
  '0199d050-0000-7000-8000-' + String(n).padStart(12, '0');
export const at = '2026-10-20T12:00:00.000Z';
export const request = (w) => ({
  workspace_id: w,
  principal_id: 'synthetic-import-member',
});
export const grant = (r) => ({
  workspace_id: r.workspace_id,
  authority: 'CLOUD',
  can_read: true,
  can_prepare: true,
  account_ids: null,
  member_id: id(90),
});
const tables = [
  'workspace',
  'financial_account',
  'financial_transaction',
  'transaction_revision',
  'import_batch',
  'import_source',
  'import_item',
  'import_effect',
];
export function createImportHarness(engine, { sqlite, pools, admin }) {
  const services = [];
  function make(w, overrides = {}) {
    const options = {
      authorize: overrides.authorize ?? (async (r) => grant(r)),
      now: overrides.now ?? (() => at),
    };
    let service;
    const after = async (text, rows) => {
      if (
        overrides.fail_after_insert &&
        /^insert into ["\w.]*import_batch\b/i.test(text.replaceAll('"', ''))
      )
        throw Error('SYNTHETIC_PRIVATE_IMPORT_CANARY');
      await overrides.after_query?.(text);
      return rows;
    };
    if (engine === 'sqlite') {
      const raw = sqlite.db;
      service = createSqliteImportCentralService({
        ...options,
        connection: {
          ...raw,
          async exec(text) {
            if (overrides.fail_rollback && text === 'ROLLBACK')
              throw Error('SYNTHETIC_ROLLBACK_CANARY');
            return raw.exec(text);
          },
          async rows(text, values) {
            return after(text, await raw.rows(text, values));
          },
        },
      });
    } else {
      const role = overrides.role ?? (w === fixture.workspace_b ? 'b' : 'a'),
        pool = pools[role];
      const guarded = {
        options: pool.options,
        end: () => pool.end(),
        async connect() {
          const client = await pool.connect();
          return new Proxy(client, {
            get(target, key) {
              if (key === 'query')
                return async (text, values) => {
                  const result = await target.query(text, values);
                  await after(text, result.rows);
                  return result;
                };
              if (key === 'release')
                return (discard) => target.release(discard);
              return Reflect.get(target, key, target);
            },
          });
        },
      };
      service = createPostgresImportCentralService({
        ...options,
        pool: guarded,
        expected_role: overrides.expected_role ?? 'us021_' + role,
      });
    }
    services.push(service);
    return service;
  }
  function translate(text) {
    let n = 0;
    return text
      .replace(
        new RegExp('\\b(' + tables.join('|') + ')\\b', 'g'),
        (name) => 'fm.' + name,
      )
      .replace(/\?/g, () => '$' + ++n);
  }
  const query = (text, values = []) =>
    engine === 'sqlite'
      ? sqlite.db.rows(text, values)
      : admin.query(translate(text), values).then((r) => r.rows);
  async function insert(table, row) {
    if (
      !tables.includes(table) ||
      Object.keys(row).some((k) => !/^[a-z_]+$/.test(k))
    )
      throw Error('FIXTURE_TABLE_INVALID');
    const names = Object.keys(row);
    return query(
      'INSERT INTO ' +
        table +
        '(' +
        names.join(',') +
        ') VALUES(' +
        names.map(() => '?').join(',') +
        ') RETURNING id',
      Object.values(row),
    );
  }
  async function snapshot(w) {
    if (engine === 'sqlite')
      return (await readSnapshot(sqlite.db, 'sqlite', w)).snapshot;
    const db = await postgresFixtureConnection(
      w === fixture.workspace_b ? pools.b : pools.a,
      w,
    );
    try {
      return (await readSnapshot(db, 'postgresql', w)).snapshot;
    } finally {
      await db.close();
    }
  }
  return {
    engine,
    make,
    query,
    insert,
    snapshot,
    sqlite,
    pools,
    admin,
    async close() {
      const results = await Promise.allSettled(services.map((s) => s.close()));
      if (results.some((r) => r.status === 'rejected'))
        throw Error('IMPORT_CLEANUP_FAILED');
    },
  };
}
