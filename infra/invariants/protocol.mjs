import assert from 'node:assert/strict';
import { createSqliteRevisionService } from '../../packages/storage-schema/dist/revisions.js';
import { createPostgresRevisionService } from '../../packages/persistence-postgres/dist/revisions.js';
import {
  calculateAccountBalance,
  consolidateBalances,
  summarizeMovements,
} from '../../packages/domain/dist/index.js';
import {
  fixture,
  loadFixture,
  postgresFixtureConnection,
} from '../fixtures/loader.mjs';
import { createRevisionHarness } from '../revisions/harness.mjs';
import { grant, request } from '../revisions/scenarios.mjs';
import {
  aggregate,
  assertAudit,
  logicalSnapshot,
  referenceTotals,
} from './oracle.mjs';
import {
  fixtureId,
  syntheticId,
  workflowCases,
  operation,
  golden,
  transferAmounts,
  splitAmounts,
  propertyTransfer,
  propertySplit,
} from './scenarios.mjs';
const workspaces = [fixture.workspace_a, fixture.workspace_b];
export function verifyObserved(snapshot, workspace) {
  const expected = referenceTotals(snapshot),
    accounts = snapshot.financial_account,
    movements = snapshot.financial_transaction.map((row) => ({
      ...row,
      posting_state: row.deleted_at === null ? 'CONFIRMED' : 'DELETED',
    }));
  const balances = accounts.map((account) =>
    calculateAccountBalance({
      workspace_id: workspace,
      account,
      reference: snapshot.balance_reference.find(
        (row) => row.account_id === account.id,
      ),
      movements: movements.filter((row) => row.account_id === account.id),
      as_of: '2026-10-31',
      history_coverage: 'COMPLETE',
    }),
  );
  for (const row of balances) {
    assert.equal(row.amount_minor, expected.balances[row.account_id]);
    assert.equal(row.completeness, 'COMPLETE');
  }
  const wealth = consolidateBalances(workspace, balances);
  for (const key of [
    'asset_balance_minor',
    'liability_balance_minor',
    'net_worth_minor',
  ])
    assert.equal(wealth[key], expected[key]);
  // Workspace B deliberately has gross flows outside i64; only its exact net is a product balance.
  if (workspace === fixture.workspace_b)
    assert.equal(balances[0].amount_minor, '-1');
  for (const [i, period] of (workspace === fixture.workspace_b
    ? []
    : [
        { from: '2026-09-01', to: '2026-09-30' },
        { from: '2026-10-01', to: '2026-10-31' },
      ]
  ).entries())
    assert.deepEqual(
      summarizeMovements({
        workspace_id: workspace,
        accounts,
        movements,
        period,
      }),
      expected.periods[i],
    );
  for (const tx of snapshot.financial_transaction) {
    const allocations = snapshot.transaction_allocation.filter(
      (row) => row.transaction_id === tx.id,
    );
    if (allocations.length)
      assert.equal(
        allocations.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n),
        BigInt(tx.account_amount_minor) < 0n
          ? -BigInt(tx.account_amount_minor)
          : BigInt(tx.account_amount_minor),
      );
  }
}
export async function seedInvariants(engine, sqlite, pools) {
  for (const workspace of workspaces) {
    const db =
      engine === 'sqlite'
        ? sqlite.db
        : await postgresFixtureConnection(
            workspace === fixture.workspace_b ? pools.b : pools.a,
            workspace,
          );
    try {
      await loadFixture(db, engine, workspace);
      if (workspace === fixture.workspace_b) {
        await db.exec('BEGIN IMMEDIATE');
        try {
          await db.run(
            engine === 'sqlite'
              ? "INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES(?,?,?,'synthetic invariant category','BOTH',0,'ACTIVE',0)"
              : "INSERT INTO fm.category(id,workspace_id,name,category_scope,sort_order,status,is_seeded) VALUES($1,$2,$3,'BOTH',0,'ACTIVE',false)",
            [syntheticId(300), workspace, 'SYNTHETIC INVARIANT CATEGORY'],
          );
          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      }
    } finally {
      if (engine !== 'sqlite') await db.close();
    }
  }
}
export function invariantHarness(engine, sqlite, pools) {
  const read = createRevisionHarness(engine, { sqlite: () => sqlite, pools });
  return {
    engine,
    snapshot: read.snapshot,
    async execute(command, ordinal) {
      const workspace = command.workspace ?? fixture.workspace_a;
      if (command.raw) {
        const db =
          engine === 'sqlite'
            ? sqlite.db
            : await postgresFixtureConnection(pools.b, workspace);
        let updated = false;
        try {
          await db.exec('BEGIN IMMEDIATE');
          const rows = await db.rows(
            engine === 'sqlite'
              ? 'UPDATE transaction_allocation SET amount_minor=amount_minor-1 WHERE workspace_id=? AND id=? RETURNING id'
              : 'UPDATE fm.transaction_allocation SET amount_minor=amount_minor-1 WHERE workspace_id=$1 AND id=$2 RETURNING id',
            [workspace, syntheticId(301)],
          );
          assert.equal(rows.length, 1);
          updated = true;
          await assert.rejects(db.exec('COMMIT'), (error) =>
            engine === 'postgresql'
              ? error.code === '23514'
              : error.code === 'ERR_SQLITE_ERROR' &&
                [787, 1811].includes(error.errcode),
          );
        } finally {
          try {
            await db.exec('ROLLBACK');
          } finally {
            if (engine !== 'sqlite') await db.close();
          }
        }
        assert.equal(updated, true);
        return;
      }
      let sequence = 0;
      const options = {
        authorize: async (input) => grant(input),
        identity: {
          newId: () => syntheticId(10000 + ordinal * 100 + sequence++),
          nowInstant: () => '2026-10-18T00:00:00.000Z',
        },
        change_source: 'MANUAL',
      };
      const unit =
        engine === 'sqlite'
          ? createSqliteRevisionService({ ...options, connection: sqlite.db })
          : createPostgresRevisionService({
              ...options,
              pool: workspace === fixture.workspace_b ? pools.b : pools.a,
              expected_role:
                workspace === fixture.workspace_b ? 'us021_b' : 'us021_a',
            });
      try {
        const run = () =>
          command.revert
            ? unit.revert(request(workspace), command.revert)
            : unit.apply(request(workspace), command.changes);
        if (command.error) await assert.rejects(run, { code: command.error });
        else return await run();
      } finally {
        await unit.close();
      }
    },
  };
}
export async function runInvariants(harnesses, step) {
  let ordinal = 0;
  async function frames() {
    const result = [];
    for (const harness of harnesses) {
      const frame = [];
      for (const workspace of workspaces) {
        const snapshot = await harness.snapshot(workspace);
        verifyObserved(snapshot, workspace);
        frame.push(snapshot);
      }
      result.push(frame);
    }
    for (const frame of result.slice(1))
      assert.deepEqual(
        frame.map(logicalSnapshot),
        result[0].map(logicalSnapshot),
      );
    return result;
  }
  async function apply(build) {
    const before = await frames(),
      results = [];
    ordinal++;
    const commands = before.map((frame) => build(frame));
    for (const [i, h] of harnesses.entries())
      results.push(
        commands[i] ? await h.execute(commands[i], ordinal) : undefined,
      );
    for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
    const after = await frames();
    for (const [i, frame] of after.entries())
      for (const [j, snapshot] of frame.entries())
        assertAudit(
          before[i][j],
          snapshot,
          Boolean(
            commands[i]?.error || commands[i]?.raw || commands[i]?.unchanged,
          ),
        );
    for (const [i, command] of commands.entries())
      if (command?.changes && !command.error) {
        const index = command.workspace === fixture.workspace_b ? 1 : 0;
        for (const change of command.changes)
          assert.deepEqual(
            aggregate(after[i][index], change.id).content,
            change.content,
          );
      }
    return { before, after };
  }
  for (const name of workflowCases)
    await step(name, async () => {
      const result = await apply((frame) =>
        operation(
          name,
          frame[
            name === 'i64_minimum_split' || name === 'deferred_split_rollback'
              ? 1
              : 0
          ],
        ),
      );
      for (const frame of result.after) golden(name, frame[0]);
      if (name === 'i64_minimum_split')
        for (const frame of result.after)
          assert.deepEqual(
            aggregate(frame[1], fixtureId(202)).content.allocations.map(
              (row) => row.amount_minor,
            ),
            ['9223372036854775807', '1'],
          );
    });
  async function roundtrip(name, build, ids) {
    await step(name, async () => {
      const first = await apply((frame) => build(frame[0]));
      for (const [i, frame] of first.after.entries()) {
        const before = referenceTotals(first.before[i][0]),
          after = referenceTotals(frame[0]);
        assert.equal(after.net_worth_minor, before.net_worth_minor);
        assert.deepEqual(
          after.periods.map((row) => [
            row.income_minor,
            row.expense_minor,
            row.expense_reversal_minor,
          ]),
          before.periods.map((row) => [
            row.income_minor,
            row.expense_minor,
            row.expense_reversal_minor,
          ]),
        );
      }
      const last = await apply((frame) => ({
        revert: ids.map((id) => {
          const state = aggregate(frame[0], id);
          return {
            id,
            base_revision: state.version,
            revision_version: state.version,
          };
        }),
      }));
      for (const [i, frame] of last.after.entries()) {
        assert.deepEqual(
          referenceTotals(frame[0]),
          referenceTotals(first.before[i][0]),
        );
        for (const id of ids)
          assert.deepEqual(
            aggregate(frame[0], id).content,
            aggregate(first.before[i][0], id).content,
          );
      }
    });
  }
  for (const [i, amount] of transferAmounts.entries())
    await roundtrip(
      'transfer_roundtrip_' + i,
      (snapshot) => propertyTransfer(snapshot, amount),
      [fixtureId(104), fixtureId(105)],
    );
  for (const [i, amount] of splitAmounts.entries())
    await roundtrip(
      'split_roundtrip_' + i,
      (snapshot) => propertySplit(snapshot, amount),
      [fixtureId(103)],
    );
  return frames();
}
