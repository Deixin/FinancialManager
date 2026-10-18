import { createSqliteCategoryService } from '../../packages/storage-schema/dist/category-changes.js';
import { createPostgresCategoryService } from '../../packages/persistence-postgres/dist/category-changes.js';
import {
  fixture,
  postgresFixtureConnection,
  readSnapshot,
} from '../fixtures/loader.mjs';
export const id = (n) =>
  '0199d044-0000-7000-8000-' + String(n).padStart(12, '0');
export const tenants = Object.freeze({
  personal: id(1),
  business: id(2),
  other: id(3),
  local: id(4),
  rollback: id(5),
});
export const request = (w) => ({
  workspace_id: w,
  principal_id: 'synthetic-member',
});
export const grant = (r) => ({
  workspace_id: r.workspace_id,
  authority: r.workspace_id === tenants.local ? 'LOCAL' : 'CLOUD',
  can_read: true,
  can_manage: true,
});
export async function prepareCategoryTenants(sqlite, admin) {
  for (const [key, w] of Object.entries(tenants)) {
    const purpose =
        key === 'business'
          ? 'BUSINESS'
          : key === 'other'
            ? 'OTHER'
            : 'PERSONAL',
      mode = key === 'local' ? 'LOCAL' : 'CLOUD';
    await sqlite.db.run(
      "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation) VALUES(?,'SYNTHETIC US044',?,?,'BRL',?)",
      [w, purpose, mode, id(9000 + Object.values(tenants).indexOf(w))],
    );
    if (admin && mode === 'CLOUD') {
      await admin.query(
        "INSERT INTO fm.workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation) VALUES($1,'SYNTHETIC US044',$2,$3,'BRL',$4)",
        [w, purpose, mode, id(9000 + Object.values(tenants).indexOf(w))],
      );
      await admin.query('INSERT INTO us021_test.access VALUES($1,$2)', [
        'us021_a',
        w,
      ]);
    }
  }
}
export function createCategoryHarness(engine, { sqlite, pools, admin }) {
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
                  /^(INSERT INTO category|UPDATE category)\b/i.test(text) &&
                  ++writes === overrides.fail_write
                )
                  throw Error('SYNTHETIC_PRIVATE_CATEGORY_CANARY');
                return raw.rows(text, values);
              },
            }
          : raw;
      unit = createSqliteCategoryService({ ...options, connection });
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
                    /^(insert into|update) "fm"\."category"/i.test(text) &&
                    ++writes === overrides.fail_write
                  )
                    throw Error('SYNTHETIC_PRIVATE_CATEGORY_CANARY');
                  return target.query(text, values);
                };
              if (key === 'release')
                return (discard) => target.release(discard);
              return Reflect.get(target, key, target);
            },
          });
        },
      };
      unit = createPostgresCategoryService({
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
        throw Error('CATEGORY_UNITS_CLEANUP_FAILED');
    },
  };
}
