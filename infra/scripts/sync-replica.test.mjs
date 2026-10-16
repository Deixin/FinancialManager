import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Replica } from '../sync/replica.mjs';
import { f, operation, syntheticRecord } from '../sync/fixtures.mjs';

const page = (overrides = {}) => ({
  status: 'OK',
  generation: f.generation,
  cursor: '1',
  conflicts: [],
  changes: [
    {
      entity_id: f.entity,
      account_id: f.account,
      version: '1',
      deleted: false,
      snapshot: syntheticRecord,
    },
  ],
  ...overrides,
});
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'fm-us005-synthetic-'));
  let replica;
  t.after(() => {
    replica?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('fm-us005-synthetic-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const open = () => {
    replica = new Replica(
      path.join(directory, 'client.sqlite'),
      f.workspace,
      f.generation,
    );
    return replica;
  };
  return {
    open,
    close: () => {
      replica.close();
      replica = undefined;
    },
  };
}
test('replica: committed outbox survives reopen; interrupted enqueue rolls back', (t) => {
  const files = fixture(t);
  let replica = files.open();
  replica.enqueue(operation(900, { amount_minor: '12000' }));
  assert.throws(() =>
    replica.enqueue(operation(901, { amount_minor: '13000' }), () => {
      throw new Error('synthetic interruption');
    }),
  );
  files.close();
  replica = files.open();
  assert.deepEqual(
    replica.pending().map((op) => op.operation_id),
    [operation(900, { amount_minor: '12000' }).operation_id],
  );
});
test('replica: confirmed data and cursor advance in one local transaction', (t) => {
  const replica = fixture(t).open();
  assert.throws(() =>
    replica.apply(page(), {
      beforeCommit: () => {
        throw new Error('synthetic interruption');
      },
    }),
  );
  assert.equal(replica.meta().cursor, '0');
  assert.equal(replica.state().records.length, 0);
  replica.apply(page());
  assert.equal(replica.meta().cursor, '1');
  assert.equal(
    replica.state().records[0].snapshot.amount_minor,
    '9007199254740993',
  );
});
test('replica: delayed pages cannot regress cursor or overwrite a tombstone', (t) => {
  const replica = fixture(t).open();
  replica.apply(
    page({
      cursor: '2',
      changes: [{ ...page().changes[0], version: '2', deleted: true }],
    }),
  );
  assert.throws(() => replica.apply(page()), { code: 'STALE_RESPONSE' });
  replica.apply(page({ cursor: '2' }));
  assert.equal(replica.state().records[0].deleted, true);
  assert.equal(replica.meta().cursor, '2');
});
test('replica: generation reset quarantines old pending proposals without automatic rebase', (t) => {
  const replica = fixture(t).open();
  replica.enqueue(operation(900, { amount_minor: '12000' }));
  assert.throws(() => replica.apply(page({ generation: f.nextGeneration })), {
    code: 'STALE_GENERATION',
  });
  replica.apply(
    {
      status: 'OK',
      generation: f.nextGeneration,
      cursor: '0',
      records: [],
      conflicts: [],
    },
    { snapshot: true },
  );
  assert.equal(replica.pending().length, 0);
  assert.equal(replica.state().outbox[0].state, 'QUARANTINED');
  assert.throws(
    () => replica.enqueue(operation(901, { amount_minor: '13000' })),
    { code: 'WRONG_REPLICA' },
  );
});
test('replica: conflicts and revocation remain distinct from cloud confirmation', (t) => {
  const replica = fixture(t).open();
  for (let number = 900; number < 904; number++)
    replica.enqueue(operation(number, { amount_minor: '12000' }));
  const ids = replica.pending().map((op) => op.operation_id);
  for (const [index, status] of [
    'UNAVAILABLE',
    'CONFLICT',
    'REJECTED_PERMISSION',
    'MERGED',
  ].entries())
    replica.acknowledge(ids[index], { status });
  assert.deepEqual(
    replica.state().outbox.map((row) => row.state),
    ['PENDING', 'CONFLICT', 'REVOKED', 'CONFIRMED'],
  );
});
