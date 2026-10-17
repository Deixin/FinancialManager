import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createApiIdentity } from '../../apps/api/dist/identity.js';
import { moneyMinor } from '../../packages/domain/dist/index.js';
export const queryGates = Object.freeze([
  'typed_columns_and_values',
  'bigint_strings_and_parameters',
  'same_client_and_local_context',
  'rls_without_where_and_with_check',
  'transaction_rollback',
  'connection_loss_and_pool_recovery',
  'concurrent_workspace_contexts',
  'row_locks',
  'keyset_pagination',
]);
export async function runQueryGate(pool, admin, corpus, step) {
  const borrowed = {
    options: pool.options,
    connect: () => pool.connect(),
    end: async () => {},
  };
  const db = new Kysely({
    dialect: new PostgresDialect({ pool: borrowed }),
  }).withSchema('fm');
  const scoped = (workspace, operation) =>
    db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.workspace_id',${workspace},true)`.execute(
        trx,
      );
      return operation(trx);
    });
  const identity = createApiIdentity();
  const expected = (workspace) =>
    corpus.seed.filter(
      (row) =>
        row.table === 'financial_account' &&
        row.values.workspace_id === workspace,
    ).length;
  const pid = async (trx) =>
    (await sql`SELECT pg_backend_pid() AS pid`.execute(trx)).rows[0].pid;
  try {
    await step('bigint_strings_and_parameters', async () => {
      const values = await scoped(corpus.workspace_a, (trx) =>
        trx
          .selectFrom('financial_transaction')
          .select('account_amount_minor')
          .execute(),
      );
      for (const row of values) {
        assert.equal(typeof row.account_amount_minor, 'string');
        moneyMinor(row.account_amount_minor);
      }
      for (const edge of [
        '9223372036854775807',
        '-9223372036854775808',
        '9007199254740993',
      ])
        assert.ok(values.some((row) => row.account_amount_minor === edge));
      const name = "SYNTHETIC_US024_'); DROP TABLE fm.workspace; --",
        id = identity.newId();
      await scoped(corpus.workspace_a, async (trx) => {
        const query = trx
          .insertInto('tag')
          .values({
            id,
            workspace_id: corpus.workspace_a,
            name,
            status: 'ACTIVE',
          })
          .returning('name');
        const compiled = query.compile();
        assert.equal(compiled.sql.includes(name), false);
        assert.ok(compiled.parameters.includes(name));
        assert.equal((await query.executeTakeFirstOrThrow()).name, name);
      });
    });
    await step('same_client_and_local_context', async () => {
      const after = await scoped(corpus.workspace_a, async (trx) => {
        const before = await pid(trx);
        const rows = await trx
          .selectFrom('financial_account')
          .select(['id', 'workspace_id'])
          .execute();
        assert.equal(rows.length, expected(corpus.workspace_a));
        assert.ok(rows.every((row) => row.workspace_id === corpus.workspace_a));
        assert.equal(await pid(trx), before);
        return before;
      });
      assert.ok(Number.isInteger(after));
      const context =
        await sql`SELECT nullif(current_setting('app.workspace_id',true),'') AS workspace`.execute(
          db,
        );
      assert.equal(context.rows[0].workspace, null);
    });
    await step('rls_without_where_and_with_check', async () => {
      assert.equal(
        (await db.selectFrom('financial_account').selectAll().execute()).length,
        0,
      );
      for (const workspace of [corpus.workspace_a, corpus.workspace_b]) {
        const rows = await scoped(workspace, (trx) =>
          trx.selectFrom('financial_account').select('workspace_id').execute(),
        );
        assert.equal(rows.length, expected(workspace));
        assert.ok(rows.every((row) => row.workspace_id === workspace));
      }
      await assert.rejects(
        scoped(corpus.workspace_a, (trx) =>
          trx
            .insertInto('tag')
            .values({
              id: identity.newId(),
              workspace_id: corpus.workspace_b,
              name: 'SYNTHETIC_US024_CROSS',
              status: 'ACTIVE',
            })
            .execute(),
        ),
        (error) => error.code === '42501',
      );
    });
    await step('transaction_rollback', async () => {
      const id = identity.newId();
      await assert.rejects(
        scoped(corpus.workspace_a, async (trx) => {
          await trx
            .insertInto('tag')
            .values({
              id,
              workspace_id: corpus.workspace_a,
              name: 'SYNTHETIC_US024_ROLLBACK',
              status: 'ACTIVE',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await sql`SELECT 1/0`.execute(trx);
        }),
        (error) => error.code === '22012',
      );
      const rows = await scoped(corpus.workspace_a, (trx) =>
        trx.selectFrom('tag').select('id').where('id', '=', id).execute(),
      );
      assert.equal(rows.length, 0);
    });
    await step('connection_loss_and_pool_recovery', async () => {
      let killed;
      await assert.rejects(
        scoped(corpus.workspace_a, async (trx) => {
          killed = await pid(trx);
          assert.equal(
            (
              await admin.query(
                'SELECT pg_terminate_backend($1) AS terminated',
                [killed],
              )
            ).rows[0].terminated,
            true,
          );
          await trx.selectFrom('financial_account').select('id').execute();
        }),
      );
      const result = await scoped(corpus.workspace_b, async (trx) => ({
        pid: await pid(trx),
        rows: await trx
          .selectFrom('financial_account')
          .select('workspace_id')
          .execute(),
      }));
      assert.notEqual(result.pid, killed);
      assert.equal(result.rows.length, expected(corpus.workspace_b));
      assert.ok(
        result.rows.every((row) => row.workspace_id === corpus.workspace_b),
      );
    });
    await step('concurrent_workspace_contexts', async () => {
      let count = 0,
        release;
      const barrier = new Promise((resolve) => {
        release = resolve;
      });
      const results = await Promise.all(
        [corpus.workspace_a, corpus.workspace_b].map((workspace) =>
          scoped(workspace, async (trx) => {
            const backend = await pid(trx);
            if (++count === 2) release();
            await barrier;
            const rows = await trx
              .selectFrom('financial_account')
              .select('workspace_id')
              .execute();
            assert.equal(rows.length, expected(workspace));
            assert.ok(rows.every((row) => row.workspace_id === workspace));
            return backend;
          }),
        ),
      );
      assert.notEqual(results[0], results[1]);
    });
    await step('row_locks', async () => {
      const account = corpus.seed.find(
        (row) =>
          row.table === 'financial_account' &&
          row.values.workspace_id === corpus.workspace_a,
      ).values.id;
      let ready, failed, release;
      const locked = new Promise((resolve, reject) => {
          ready = resolve;
          failed = reject;
        }),
        hold = new Promise((resolve) => {
          release = resolve;
        });
      const first = scoped(corpus.workspace_a, async (trx) => {
        await trx
          .selectFrom('financial_account')
          .select('id')
          .where('id', '=', account)
          .forUpdate()
          .execute();
        ready();
        await hold;
      });
      first.catch(failed);
      try {
        await locked;
        await assert.rejects(
          scoped(corpus.workspace_a, (trx) =>
            trx
              .selectFrom('financial_account')
              .select('id')
              .where('id', '=', account)
              .forUpdate()
              .noWait()
              .execute(),
          ),
          (error) => error.code === '55P03',
        );
      } finally {
        release();
        await first;
      }
    });
    await step('keyset_pagination', async () => {
      await scoped(corpus.workspace_a, async (trx) => {
        const expected = await trx
          .selectFrom('financial_transaction')
          .select(['id'])
          .select((eb) =>
            eb.cast('financial_date', 'text').as('financial_date'),
          )
          .orderBy('financial_date')
          .orderBy('id')
          .execute();
        const actual = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
          let query = trx
            .selectFrom('financial_transaction')
            .select(['id'])
            .select((eb) =>
              eb.cast('financial_date', 'text').as('financial_date'),
            )
            .orderBy('financial_date')
            .orderBy('id')
            .limit(3);
          if (cursor)
            query = query.where((eb) =>
              eb.or([
                eb('financial_date', '>', cursor.financial_date),
                eb.and([
                  eb('financial_date', '=', cursor.financial_date),
                  eb('id', '>', cursor.id),
                ]),
              ]),
            );
          const rows = await query.execute();
          actual.push(...rows);
          if (rows.length < 3) break;
          cursor = rows.at(-1);
        }
        assert.deepEqual(actual, expected);
        assert.equal(
          new Set(actual.map((row) => row.id)).size,
          expected.length,
        );
      });
    });
  } finally {
    await db.destroy();
  }
}
