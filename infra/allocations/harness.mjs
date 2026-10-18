import { createRevisionHarness } from '../revisions/harness.mjs';
import { createCategoryHarness, tenants } from '../categories/harness.mjs';
import { createTaxonomyHarness } from '../taxonomy/harness.mjs';
import { createAllocationService } from '../../packages/finance-ports/dist/classification.js';
import { grant, request, ids } from '../revisions/scenarios.mjs';
export const id = (n) =>
  '0199d046-0000-7000-8000-' + String(n).padStart(12, '0');
export const workspace = tenants.personal;
export const authorized = (r) => ({
  ...grant(request()),
  workspace_id: r.workspace_id,
});
export function createAllocationHarness(engine, options) {
  const h = createRevisionHarness(engine, options),
    categories = createCategoryHarness(engine, options),
    taxonomy = createTaxonomyHarness(engine, options);
  const table = (n) => (engine === 'sqlite' ? '' : 'fm.') + n;
  const params = (sql) =>
    engine === 'sqlite'
      ? sql
      : sql.replace(
          /\?/g,
          (() => {
            let n = 0;
            return () => '$' + ++n;
          })(),
        );
  async function sql(w, text, values = []) {
    if (engine === 'sqlite') return options.sqlite().db.rows(text, values);
    const client = await options.pools[w === ids.b ? 'b' : 'a'].connect();
    let active = false,
      discard = false;
    try {
      await client.query('BEGIN');
      active = true;
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [w]);
      const rows = (await client.query(params(text), values)).rows;
      await client.query('COMMIT');
      active = false;
      return rows;
    } catch (error) {
      if (active)
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
  async function history(w, t) {
    const text =
      engine === 'sqlite'
        ? 'SELECT id,CAST(version AS TEXT) AS version,snapshot,actor_type,actor_id,device_id,change_source,created_at FROM transaction_revision WHERE workspace_id=? AND transaction_id=? ORDER BY transaction_revision.version'
        : `SELECT id::text,version::text,snapshot::text,actor_type,actor_id,device_id::text,change_source,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at FROM fm.transaction_revision WHERE workspace_id=? AND transaction_id=? ORDER BY transaction_revision.version`;
    return (await sql(w, text, [w, t])).map((row) => ({
      ...row,
      snapshot: JSON.parse(row.snapshot),
    }));
  }
  const revision = (w = workspace, overrides = {}) =>
    h.make(w, {
      clock: '2026-10-18T09:00:00.000Z',
      authorize: async (r) => authorized(r),
      ...overrides,
    });
  return {
    engine,
    sql,
    revision,
    service: (w = workspace, overrides = {}) =>
      createAllocationService(revision(w, overrides)),
    categories: (w = workspace, overrides = {}) =>
      categories.make(w, overrides),
    taxonomy: (w = workspace, overrides = {}) => taxonomy.make(w, overrides),
    async prepare() {
      for (const n of [1, 2])
        await sql(
          workspace,
          `INSERT INTO ${table('financial_account')}(id,workspace_id,name,account_kind,balance_nature,currency_code,status) VALUES(?,?,'SYNTHETIC ALLOCATION ACCOUNT','CHECKING','ASSET','BRL','ACTIVE') RETURNING id`,
          [id(n), workspace],
        );
    },
    state: async (w, t) => (await history(w, t)).at(-1)?.snapshot.after ?? null,
    history,
    async graph(w = workspace) {
      return {
        transactions: await sql(
          w,
          `SELECT id,account_id,group_id,CAST(financial_date AS TEXT) AS financial_date,CAST(account_amount_minor AS TEXT) AS account_amount_minor,economic_kind,original_description,display_name,origin_kind,CAST(version AS TEXT) AS version,deleted_at FROM ${table('financial_transaction')} WHERE workspace_id=? ORDER BY id`,
          [w],
        ),
        allocations: await sql(
          w,
          `SELECT id,transaction_id,category_id,subcategory_id,CAST(amount_minor AS TEXT) AS amount_minor,note FROM ${table('transaction_allocation')} WHERE workspace_id=? ORDER BY id`,
          [w],
        ),
        tags: await sql(
          w,
          `SELECT transaction_id,tag_id FROM ${table('transaction_tag')} WHERE workspace_id=? ORDER BY transaction_id,tag_id`,
          [w],
        ),
        history: await sql(
          w,
          `SELECT transaction_id,CAST(version AS TEXT) AS version FROM ${table('transaction_revision')} WHERE workspace_id=? ORDER BY transaction_id,version`,
          [w],
        ),
      };
    },
    async close() {
      await Promise.all([h.close(), categories.close(), taxonomy.close()]);
    },
  };
}
