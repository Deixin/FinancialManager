import { createSqliteCounterpartyService } from '../../packages/storage-schema/dist/counterparty-changes.js';
import { createPostgresCounterpartyService } from '../../packages/persistence-postgres/dist/counterparty-changes.js';
import {
  fixture,
  postgresFixtureConnection,
  readSnapshot,
} from '../fixtures/loader.mjs';
import { id, tenants, request, grant } from '../categories/harness.mjs';
export { id, tenants, request, grant };
export function createCounterpartyHarness(engine, { sqlite, pools, admin }) {
  const units = [];
  const db = () => sqlite().db;
  function make(w, overrides = {}) {
    let writes = 0;
    const options = {
      authorize: overrides.authorize ?? (async (r) => grant(r)),
    };
    let unit;
    if (engine === 'sqlite') {
      const raw = db(),
        connection = overrides.fail_write
          ? {
              ...raw,
              async rows(text, values) {
                if (
                  /^(INSERT INTO counterparty|UPDATE counterparty)\b/i.test(
                    text,
                  ) &&
                  ++writes === overrides.fail_write
                ) {
                  await raw.rows(text, values);
                  throw Error('SYNTHETIC_PRIVATE_COUNTERPARTY_CANARY');
                }
                return raw.rows(text, values);
              },
            }
          : raw;
      unit = createSqliteCounterpartyService({ ...options, connection });
    } else {
      const role = w === fixture.workspace_b && !overrides.as_a ? 'b' : 'a',
        pool = pools[role];
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
                    overrides.fail_write &&
                    /^(insert into|update) "fm"\."counterparty"/i.test(text) &&
                    ++writes === overrides.fail_write
                  ) {
                    await target.query(text, values);
                    throw Error('SYNTHETIC_PRIVATE_COUNTERPARTY_CANARY');
                  }
                  return target.query(text, values);
                };
              if (key === 'release')
                return (discard) => target.release(discard);
              return Reflect.get(target, key, target);
            },
          });
        },
      };
      unit = createPostgresCounterpartyService({
        ...options,
        pool: guarded,
        expected_role: 'us021_' + role,
      });
    }
    units.push(unit);
    return unit;
  }
  async function snapshot(w) {
    if (engine === 'sqlite')
      return (await readSnapshot(db(), 'sqlite', w)).snapshot;
    const c = await postgresFixtureConnection(
      w === fixture.workspace_b ? pools.b : pools.a,
      w,
    );
    try {
      return (await readSnapshot(c, 'postgresql', w)).snapshot;
    } finally {
      await c.close();
    }
  }
  return {
    engine,
    make,
    snapshot,
    db,
    admin,
    pools,
    async close() {
      const r = await Promise.allSettled(units.map((u) => u.close()));
      if (r.some((v) => v.status === 'rejected'))
        throw Error('COUNTERPARTY_UNITS_CLEANUP_FAILED');
    },
  };
}
