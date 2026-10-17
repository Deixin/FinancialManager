import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  fixture,
  loadFixture,
  postgresFixtureConnection,
} from '../fixtures/loader.mjs';
import { verifyTotals } from '../fixtures/totals.mjs';
import { createRevisionHarness } from './harness.mjs';
import {
  runRevisionCases,
  ids,
  request,
  grant,
  change,
  initialState,
} from './scenarios.mjs';
import { checkDataAccess } from '../scripts/check-data-access.mjs';
import { createApiRevisionModel } from '../../apps/api/dist/revision-model.js';
import { createWorkerRevisionModel } from '../../apps/worker/dist/revision-model.js';
import { createApiReadModel } from '../../apps/api/dist/read-model.js';
export async function runRevisionProtocol(sqlite, pools, admin, step) {
  await step('unit_types_and_module_boundaries', async () => {
    assert.deepEqual(checkDataAccess(), []);
    const result = spawnSync(
      process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
      process.platform === 'win32'
        ? [
            '/d',
            '/c',
            'pnpm',
            'exec',
            'tsc',
            '-p',
            'infra/revisions/tsconfig.json',
          ]
        : ['exec', 'tsc', '-p', 'infra/revisions/tsconfig.json'],
      { windowsHide: true, encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
  });
  for (const workspace of [ids.a, ids.b]) {
    await loadFixture(sqlite.db, 'sqlite', workspace);
    const connection = await postgresFixtureConnection(
      workspace === ids.b ? pools.b : pools.a,
      workspace,
    );
    try {
      await loadFixture(connection, 'postgresql', workspace);
    } finally {
      await connection.close();
    }
  }
  const local = createRevisionHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createRevisionHarness('postgresql', { pools, admin });
  try {
    await runRevisionCases(local, (name, run) => step('sqlite_' + name, run));
    await runRevisionCases(cloud, (name, run) =>
      step('postgresql_' + name, run),
    );
    await step('same_financial_goldens', async () => {
      for (const h of [local, cloud])
        for (const workspace of [fixture.workspace_a, fixture.workspace_b])
          verifyTotals(await h.snapshot(workspace), workspace);
    });
    await step('sqlite_local_without_cloud_identity', async () => {
      await sqlite.db.exec('BEGIN IMMEDIATE');
      try {
        await sqlite.db.run(
          "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,created_at) VALUES(?,'SYNTHETIC LOCAL','PERSONAL','LOCAL','BRL',?,'2026-10-16T00:00:00.000Z')",
          [ids.local, ids.localTransaction],
        );
        await sqlite.db.run(
          "INSERT INTO financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status) VALUES(?,?,'SYNTHETIC LOCAL ACCOUNT','CHECKING','ASSET','BRL','ACTIVE')",
          [ids.localAccount, ids.local],
        );
        await sqlite.db.exec('COMMIT');
      } catch (error) {
        await sqlite.db.exec('ROLLBACK');
        throw error;
      }
      const service = local.make(ids.local);
      try {
        const content = {
          ...initialState(ids.expense).content,
          account_id: ids.localAccount,
          account_amount_minor: '1000',
          economic_kind: 'INCOME',
          allocations: [],
          tag_ids: [],
          display_name: 'SYNTHETIC LOCAL CREATE',
        };
        const result = await service.apply({ workspace_id: ids.local }, [
          { id: ids.localTransaction, base_revision: '0', content },
        ]);
        assert.equal(result[0].version, '1');
        const history = await local.history(ids.local, ids.localTransaction);
        assert.equal(history[0].actor_type, 'LOCAL_USER');
        assert.equal(history[0].actor_id, null);
        assert.equal(history[0].device_id, null);
        await assert.rejects(
          service.apply(
            { workspace_id: ids.local, principal_id: 'synthetic-member' },
            [{ id: ids.localTransaction, base_revision: '1', content }],
          ),
          { code: 'INVALID_AUTHORIZATION' },
        );
      } finally {
        await service.close();
      }
    });
    await step('postgres_backend_loss_rollback', async () => {
      const current = await cloud.state(ids.a, ids.expense),
        history = await cloud.history(ids.a, ids.expense),
        service = cloud.make(ids.a, { kill_after_update: true });
      try {
        await assert.rejects(
          service.apply(request(), [
            change(current, { display_name: 'SYNTHETIC LOST CONNECTION' }),
          ]),
          { code: 'DATA_ACCESS_FAILED' },
        );
      } finally {
        await service.close();
      }
      assert.deepEqual(await cloud.state(ids.a, ids.expense), current);
      assert.deepEqual(await cloud.history(ids.a, ids.expense), history);
    });
    await step('api_worker_factories_and_reauthorization', async () => {
      let allowed = true,
        calls = 0;
      const options = {
        pool: pools.a,
        expected_role: 'us021_a',
        change_source: 'MANUAL',
        authorize: async (input) => {
          calls++;
          return allowed ? grant(input) : null;
        },
      };
      const api = createApiRevisionModel(options),
        worker = createWorkerRevisionModel(options),
        reader = createApiReadModel({
          pool: pools.a,
          expected_role: 'us021_a',
          authorize: async (input) => ({
            workspace_id: input.workspace_id,
            permissions: ['accounts:read', 'transactions:read'],
            account_ids: null,
          }),
        });
      try {
        const current = await cloud.state(ids.a, ids.expense);
        assert.equal(
          (await api.apply(request(), [change(current)]))[0].changed,
          false,
        );
        assert.equal(
          (await worker.apply(request(), [change(current)]))[0].changed,
          false,
        );
        allowed = false;
        await assert.rejects(worker.apply(request(), [change(current)]), {
          code: 'ACCESS_DENIED',
        });
        assert.equal(calls, 3);
        allowed = true;
        await reader.read(request(), async () => {
          await assert.rejects(worker.apply(request(), [change(current)]), {
            code: 'NESTED_UNIT',
          });
        });
      } finally {
        await Promise.all([api.close(), worker.close(), reader.close()]);
      }
    });
  } finally {
    await local.close();
    await cloud.close();
  }
}
