import assert from 'node:assert/strict';
import { createPostgresReadUnit } from '../../packages/persistence-postgres/dist/index.js';
import { createApiReadModel } from '../../apps/api/dist/read-model.js';
import { createWorkerReadModel } from '../../apps/worker/dist/read-model.js';
import { createApiIdentity } from '../../apps/api/dist/identity.js';
import { checkDataAccess } from '../scripts/check-data-access.mjs';
export const repositoryGates = Object.freeze([
  'module_boundaries_and_port_types',
  'authorization_before_pool_and_captured_inputs',
  'workspace_and_account_scoped_reads',
  'exact_money_time_and_immutable_pages',
  'bound_keyset_cursors',
  'child_rows_scoped_in_one_statement',
  'same_client_orchestration_and_worker_revalidation',
  'retired_scopes_nested_and_pending_work',
  'safe_failures_and_connection_recovery',
  'unsafe_roles_rejected',
  'borrowed_pool_and_concurrent_requests',
]);
export async function runRepositoryProbe(
  pool,
  admin,
  corpus,
  credentials,
  step,
) {
  const identity = createApiIdentity(),
    workspace = corpus.workspace_a,
    other = corpus.workspace_b;
  const accounts = corpus.seed
    .filter(
      (row) =>
        row.table === 'financial_account' &&
        row.values.workspace_id === workspace,
    )
    .map((row) => row.values);
  const bank = accounts.find((row) => row.account_kind === 'CHECKING'),
    hidden = accounts.find((row) => row.account_kind === 'SAVINGS');
  const transaction = corpus.seed.find(
    (row) =>
      row.table === 'financial_transaction' &&
      row.values.account_id === bank.id &&
      row.values.economic_kind === 'EXPENSE',
  ).values;
  const category = corpus.seed.find(
    (row) =>
      row.table === 'category' &&
      row.values.workspace_id === workspace &&
      row.values.category_scope === 'BOTH',
  ).values;
  const tag = corpus.seed.find(
    (row) => row.table === 'tag' && row.values.workspace_id === workspace,
  ).values;
  const fixtureClient = await pool.connect();
  try {
    await fixtureClient.query('BEGIN');
    await fixtureClient.query("SELECT set_config('app.workspace_id',$1,true)", [
      workspace,
    ]);
    await fixtureClient.query(
      'INSERT INTO fm.transaction_allocation(id,workspace_id,transaction_id,category_id,amount_minor) VALUES($1,$2,$3,$4,$5)',
      [
        identity.newId(),
        workspace,
        transaction.id,
        category.id,
        (-BigInt(transaction.account_amount_minor)).toString(),
      ],
    );
    await fixtureClient.query(
      'INSERT INTO fm.transaction_tag VALUES($1,$2,$3)',
      [workspace, transaction.id, tag.id],
    );
    for (const version of ['1', '2', '10'])
      await fixtureClient.query(
        "INSERT INTO fm.transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source) VALUES($1,$2,$3,$4,'{}','SYSTEM','SYSTEM')",
        [identity.newId(), workspace, transaction.id, version],
      );
    await fixtureClient.query('COMMIT');
  } catch (error) {
    await fixtureClient.query('ROLLBACK');
    throw error;
  } finally {
    fixtureClient.release();
  }
  let authorizeCount = 0,
    connectCount = 0;
  const events = [];
  const traced = {
    options: pool.options,
    end: () => pool.end(),
    async connect() {
      connectCount++;
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, key) {
          if (key === 'query')
            return async (text, parameters = []) => {
              events.push({ pid: client.processID, text });
              return target.query(text, parameters);
            };
          if (key === 'release') return (discard) => target.release(discard);
          return Reflect.get(target, key, target);
        },
      });
    },
  };
  const authorize = async (request) => {
    authorizeCount++;
    if (request.principal_id === 'other' && request.workspace_id === other)
      return {
        workspace_id: other,
        permissions: ['accounts:read', 'transactions:read'],
        account_ids: null,
      };
    if (
      request.workspace_id !== workspace ||
      !['all', 'bank', 'hidden', 'empty', 'accounts-only'].includes(
        request.principal_id,
      )
    )
      return null;
    return {
      workspace_id: workspace,
      permissions:
        request.principal_id === 'accounts-only'
          ? ['accounts:read']
          : ['accounts:read', 'transactions:read'],
      account_ids:
        request.principal_id === 'bank'
          ? [bank.id]
          : request.principal_id === 'hidden'
            ? [hidden.id]
            : request.principal_id === 'empty'
              ? []
              : null,
    };
  };
  const options = { pool: traced, authorize, expected_role: 'us024_runtime' };
  const api = createApiReadModel(options),
    worker = createWorkerReadModel(options);
  const request = (principal_id = 'all', workspace_id = workspace) => ({
    workspace_id,
    principal_id,
  });
  const filter = { from: '0001-01-01', through: '9999-12-31', limit: 100 };
  try {
    await step('module_boundaries_and_port_types', async () => {
      assert.deepEqual(checkDataAccess(), []);
    });
    await step('authorization_before_pool_and_captured_inputs', async () => {
      const before = connectCount;
      await assert.rejects(
        api.read(request('unknown'), async () => {}),
        { code: 'ACCESS_DENIED' },
      );
      await assert.rejects(
        api.read(request('all', other), async () => {}),
        { code: 'ACCESS_DENIED' },
      );
      assert.equal(connectCount, before);
      let allow;
      const barrier = new Promise((resolve) => {
        allow = resolve;
      });
      const captured = createPostgresReadUnit({
        ...options,
        authorize: async (input) => {
          assert.ok(Object.isFrozen(input));
          await barrier;
          return authorize(input);
        },
      });
      try {
        const input = request('bank'),
          page = captured.read(input, (ports) =>
            ports.accounts.page({ limit: 100 }),
          );
        input.workspace_id = other;
        input.principal_id = 'other';
        allow();
        const result = await page;
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].id, bank.id);
      } finally {
        await captured.close();
      }
    });
    await step('workspace_and_account_scoped_reads', async () => {
      await api.read(request('bank'), async (ports) => {
        const page = await ports.accounts.page({ limit: 100 });
        assert.deepEqual(
          page.items.map((row) => row.id),
          [bank.id],
        );
        await assert.rejects(async () => ports.accounts.get(hidden.id), {
          code: 'ACCESS_DENIED',
        });
        const pageTx = await ports.transactions.page(filter);
        assert.ok(
          pageTx.items.length > 0 &&
            pageTx.items.every(
              (row) =>
                row.workspace_id === workspace && row.account_id === bank.id,
            ),
        );
        assert.equal(
          await ports.transactions.get(
            corpus.seed.find(
              (row) =>
                row.table === 'financial_transaction' &&
                row.values.account_id === hidden.id,
            ).values.id,
          ),
          null,
        );
      });
      await api.read(request('other', other), async (ports) => {
        const page = await ports.accounts.page({ limit: 100 });
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].workspace_id, other);
        assert.equal(await ports.transactions.get(transaction.id), null);
      });
      await api.read(request('empty'), async (ports) => {
        assert.deepEqual((await ports.accounts.page({ limit: 100 })).items, []);
        assert.deepEqual((await ports.transactions.page(filter)).items, []);
      });
    });
    await step('exact_money_time_and_immutable_pages', async () => {
      const page = await api.read(request(), (ports) =>
        ports.transactions.page(filter),
      );
      assert.ok(
        Object.isFrozen(page) &&
          Object.isFrozen(page.items) &&
          page.items.every(Object.isFrozen),
      );
      for (const value of [
        '9223372036854775807',
        '-9223372036854775808',
        '9007199254740993',
      ])
        assert.ok(page.items.some((row) => row.account_amount_minor === value));
      for (const row of page.items) {
        assert.equal(typeof row.account_amount_minor, 'string');
        assert.equal(typeof row.version, 'string');
        assert.match(
          row.created_at,
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
        );
        assert.equal(
          JSON.parse(JSON.stringify(row)).financial_date,
          row.financial_date,
        );
      }
      const references = await api.read(request('bank'), (ports) =>
        ports.accounts.references({ account_id: bank.id, limit: 100 }),
      );
      assert.ok(references.items.length > 0);
      assert.equal(typeof references.items[0].amount_minor, 'string');
    });
    await step('bound_keyset_cursors', async () => {
      const expected = (
        await api.read(request(), (ports) => ports.transactions.page(filter))
      ).items;
      const actual = [];
      let cursor = null;
      for (let count = 0; count < 100; count++) {
        const page = await api.read(request(), (ports) =>
          ports.transactions.page({ ...filter, limit: 2, cursor }),
        );
        actual.push(...page.items);
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      assert.deepEqual(actual, expected);
      assert.equal(new Set(actual.map((row) => row.id)).size, expected.length);
      const first = await api.read(request(), (ports) =>
        ports.transactions.page({ ...filter, limit: 2 }),
      );
      assert.ok(first.next_cursor);
      for (const change of [
        { workspace_id: other },
        { account_id: bank.id },
        { from: '2026-01-01' },
        { through: '2026-12-31' },
      ])
        await assert.rejects(
          api.read(request(), (ports) =>
            ports.transactions.page({
              ...filter,
              cursor: { ...first.next_cursor, ...change },
            }),
          ),
          { code: 'INVALID_INPUT' },
        );
    });
    await step('child_rows_scoped_in_one_statement', async () => {
      for (const method of ['allocations', 'tagIds', 'revisions']) {
        events.length = 0;
        const rows = await api.read(request('bank'), (ports) =>
          ports.transactions[method](transaction.id),
        );
        assert.ok(rows.length > 0);
        const selects = events.filter((event) =>
          /select.*from "fm"\."transaction_(allocation|tag|revision)"/is.test(
            event.text,
          ),
        );
        assert.equal(selects.length, 1);
        assert.ok(
          selects[0].text.includes('inner join "fm"."financial_transaction"'),
        );
        assert.equal(
          events.filter((event) =>
            /select.*from "fm"\."financial_transaction"/is.test(event.text),
          ).length,
          0,
        );
        assert.deepEqual(
          await api.read(request('hidden'), (ports) =>
            ports.transactions[method](transaction.id),
          ),
          [],
        );
        assert.deepEqual(
          await api.read(request('other', other), (ports) =>
            ports.transactions[method](transaction.id),
          ),
          [],
        );
      }
      assert.deepEqual(
        (
          await api.read(request('bank'), (ports) =>
            ports.transactions.revisions(transaction.id),
          )
        ).map((row) => row.version),
        ['1', '2', '10'],
      );
    });
    await step(
      'same_client_orchestration_and_worker_revalidation',
      async () => {
        events.length = 0;
        const result = await api.accountActivity(request('bank'), {
          ...filter,
          account_id: bank.id,
        });
        assert.equal(result.account.id, bank.id);
        assert.ok(
          result.transactions.items.every((row) => row.account_id === bank.id),
        );
        const finance = events.filter((event) =>
          /from "fm"\./.test(event.text),
        );
        assert.ok(finance.length >= 2);
        assert.equal(new Set(finance.map((event) => event.pid)).size, 1);
        assert.ok(
          events.some((event) =>
            /start transaction.*read only/i.test(event.text),
          ),
        );
        const before = authorizeCount;
        await worker.accountActivity(request('bank'), {
          ...filter,
          account_id: bank.id,
        });
        await worker.accountActivity(request('bank'), {
          ...filter,
          account_id: bank.id,
        });
        assert.equal(authorizeCount, before + 2);
      },
    );
    await step('retired_scopes_nested_and_pending_work', async () => {
      const ports = await api.read(request(), async (ports) => ports);
      const before = connectCount;
      await assert.rejects(ports.accounts.page({ limit: 1 }), {
        code: 'SCOPE_CLOSED',
      });
      assert.equal(connectCount, before);
      await assert.rejects(
        api.read(request(), async () => worker.read(request(), async () => {})),
        { code: 'NESTED_READ_SCOPE' },
      );
      let deferred;
      await assert.rejects(
        api.read(request(), async (ports) => {
          deferred = ports.transactions.page(filter);
          return;
        }),
        { code: 'PENDING_WORK' },
      );
      await assert.rejects(deferred);
    });
    await step('safe_failures_and_connection_recovery', async () => {
      await assert.rejects(
        api.read(request(), async () => {
          throw new Error('SYNTHETIC_PRIVATE_FINANCIAL_ERROR_CANARY');
        }),
        { message: 'UNIT_OF_WORK_FAILED' },
      );
      await assert.rejects(
        api.read(request('accounts-only'), async (ports) => {
          try {
            await ports.transactions.page(filter);
          } catch {
            /* A caught repository error still aborts the read scope. */
          }
        }),
        { code: 'UNIT_OF_WORK_FAILED' },
      );
      assert.equal(
        (
          await api.read(request('bank'), (ports) =>
            ports.accounts.page({ limit: 100 }),
          )
        ).items.length,
        1,
      );
    });
    await step('unsafe_roles_rejected', async () => {
      const unsafe = createPostgresReadUnit({
        ...options,
        expected_role: 'another_database_role',
      });
      try {
        await assert.rejects(
          unsafe.read(request(), async () => {}),
          { code: 'CONFIGURATION_INVALID' },
        );
      } finally {
        await unsafe.close();
      }
      const role = (
        await admin.query(
          'SELECT rolsuper,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=$1',
          ['us024_runtime'],
        )
      ).rows[0];
      assert.equal(role.rolsuper, false);
      assert.equal(role.rolbypassrls, false);
    });
    await step('borrowed_pool_and_concurrent_requests', async () => {
      const pages = await Promise.all([
        api.read(request('bank'), (ports) =>
          ports.accounts.page({ limit: 100 }),
        ),
        worker.read(request('other', other), (ports) =>
          ports.accounts.page({ limit: 100 }),
        ),
      ]);
      assert.equal(pages[0].items[0].id, bank.id);
      assert.equal(pages[1].items[0].workspace_id, other);
      const client = await pool.connect();
      try {
        assert.equal(
          (
            await client.query(
              "SELECT nullif(current_setting('app.workspace_id',true),'') AS workspace",
            )
          ).rows[0].workspace,
          null,
        );
      } finally {
        client.release();
      }
    });
  } finally {
    await api.close();
    await worker.close();
  }
  assert.equal((await pool.query('SELECT 1 AS alive')).rows[0].alive, 1);
  void credentials;
}
