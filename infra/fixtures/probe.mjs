import assert from 'node:assert/strict';
import {
  fixture,
  loadFixture,
  readSnapshot,
  fixtureRows,
  postgresFixtureConnection,
} from './loader.mjs';
import { verifyTotals, verifyDocumentVector } from './totals.mjs';
export async function runFixtureProbe(sqlite, aPool, bPool, step) {
  const a = await postgresFixtureConnection(aPool, fixture.workspace_a),
    b = await postgresFixtureConnection(bPool, fixture.workspace_b);
  try {
    await step('atomic_load_rollback', async () => {
      for (const [engine, db] of [
        ['sqlite', sqlite],
        ['postgresql', b],
      ]) {
        let count = 0;
        await assert.rejects(
          loadFixture(
            {
              ...db,
              async run(sql, values) {
                if (++count === 3) throw Error('SYNTHETIC_PRIVATE_SEED_CANARY');
                await db.run(sql, values);
              },
            },
            engine,
            fixture.workspace_b,
          ),
          { message: 'FIXTURE_LOAD_FAILED' },
        );
        const { snapshot } = await readSnapshot(
          db,
          engine,
          fixture.workspace_b,
        );
        assert.ok(Object.values(snapshot).every((rows) => rows.length === 0));
      }
    });
    await step('same_dataset_persisted', async () => {
      for (const workspace of [fixture.workspace_a, fixture.workspace_b]) {
        await loadFixture(sqlite, 'sqlite', workspace);
        const pg = workspace === fixture.workspace_a ? a : b;
        await loadFixture(pg, 'postgresql', workspace);
        const local = await readSnapshot(sqlite, 'sqlite', workspace),
          cloud = await readSnapshot(pg, 'postgresql', workspace);
        assert.deepEqual(local.snapshot, local.expected);
        assert.deepEqual(cloud.snapshot, local.expected);
        assert.equal(
          Object.values(local.snapshot).reduce(
            (sum, rows) => sum + rows.length,
            0,
          ),
          fixtureRows(workspace).length,
        );
      }
    });
    await step('golden_balances_reports_allocations', async () => {
      for (const workspace of [fixture.workspace_a, fixture.workspace_b]) {
        verifyTotals(
          (await readSnapshot(sqlite, 'sqlite', workspace)).snapshot,
          workspace,
        );
        verifyTotals(
          (
            await readSnapshot(
              workspace === fixture.workspace_a ? a : b,
              'postgresql',
              workspace,
            )
          ).snapshot,
          workspace,
        );
      }
    });
    await step('exact_i64_and_reference_cutoffs', async () => {
      for (const [engine, db] of [
        ['sqlite', sqlite],
        ['postgresql', b],
      ]) {
        const { snapshot } = await readSnapshot(
          db,
          engine,
          fixture.workspace_b,
        );
        const amounts = snapshot.financial_transaction.map(
          (row) => row.account_amount_minor,
        );
        for (const edge of [
          '9223372036854775807',
          '-9223372036854775808',
          '9007199254740993',
          '-9007199254740993',
        ])
          assert.ok(amounts.includes(edge));
        assert.ok(amounts.every((value) => typeof value === 'string'));
      }
      const { snapshot } = await readSnapshot(
        sqlite,
        'sqlite',
        fixture.workspace_a,
      );
      assert.ok(
        snapshot.balance_reference.some(
          (row) => row.day_position === 'END_OF_DAY',
        ),
      );
      assert.ok(
        snapshot.financial_transaction.some((row) => row.deleted_at !== null),
      );
    });
    await step('duplicate_load_preserves_data', async () => {
      for (const [engine, db] of [
        ['sqlite', sqlite],
        ['postgresql', a],
      ]) {
        await assert.rejects(loadFixture(db, engine, fixture.workspace_a), {
          message: 'FIXTURE_LOAD_FAILED',
        });
        const { snapshot, expected } = await readSnapshot(
          db,
          engine,
          fixture.workspace_a,
        );
        assert.deepEqual(snapshot, expected);
      }
    });
    await step('workspace_isolation_with_rls', async () => {
      await a.exec('BEGIN IMMEDIATE');
      const rows = await a.rows(
        'SELECT workspace_id::text FROM fm.financial_account',
      );
      assert.equal(rows.length, 3);
      assert.ok(rows.every((row) => row.workspace_id === fixture.workspace_a));
      assert.equal(
        rows.some((row) => row.workspace_id === fixture.workspace_b),
        false,
      );
      await assert.rejects(
        a.run(
          "INSERT INTO fm.financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status) VALUES($1,$2,'SYNTHETIC CROSS','OTHER','ASSET','BRL','ACTIVE')",
          ['0199d025-0000-7000-8000-000000000999', fixture.workspace_b],
        ),
        (error) => error.code === '42501',
      );
      await a.exec('ROLLBACK');
      const forged = await postgresFixtureConnection(
        aPool,
        fixture.workspace_b,
      );
      try {
        const { snapshot } = await readSnapshot(
          forged,
          'postgresql',
          fixture.workspace_b,
        );
        assert.ok(Object.values(snapshot).every((rows) => rows.length === 0));
      } finally {
        await forged.close();
      }
    });
    await step('document_search_vector_only', async () => {
      verifyDocumentVector();
    });
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}
