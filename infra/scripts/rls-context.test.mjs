import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceRunner } from '../../apps/api/spikes/us-004/context.mjs';
import { contextA } from '../rls/fixtures.mjs';

function fakePool(fail) {
  const statements = [];
  const releases = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (fail) await fail(sql, statements.length);
      return {
        rowCount: sql.startsWith('SELECT 1 FROM us004.membership') ? 1 : 0,
        rows: [],
      };
    },
    release(destroy) {
      releases.push(destroy);
    },
  };
  return {
    statements,
    releases,
    async connect() {
      return client;
    },
  };
}

test('RLS request validates context before acquiring a connection', async () => {
  const pool = fakePool();
  const run = createWorkspaceRunner(pool);
  for (const context of [
    undefined,
    { ...contextA, userId: 'not-a-uuid' },
    { ...contextA, workspaceId: "x'; RESET ALL; --" },
  ]) {
    await assert.rejects(
      run(context, async () => {}),
      { code: 'CONTEXT_INVALID' },
    );
  }
  assert.equal(pool.statements.length, 0);
});

test('RLS request binds LOCAL parameters, commits once, and closes escaped transaction ports', async () => {
  const pool = fakePool();
  let escaped;
  assert.equal(
    await createWorkspaceRunner(pool)(contextA, async (tx) => {
      escaped = tx;
      await tx.query('SELECT 42');
      return 'committed';
    }),
    'committed',
  );
  const bind = pool.statements.find((item) =>
    item.sql.startsWith('SELECT set_config'),
  );
  assert.deepEqual(bind.values, [contextA.workspaceId, contextA.userId]);
  assert.match(bind.sql, /\$1, true/);
  assert.equal(
    pool.statements.filter((item) => item.sql === 'COMMIT').length,
    1,
  );
  assert.equal(
    pool.statements.some((item) => item.sql === 'ROLLBACK'),
    false,
  );
  assert.deepEqual(pool.releases, [false]);
  const count = pool.statements.length;
  assert.throws(() => escaped.query('SELECT 99'), {
    code: 'TRANSACTION_CLOSED',
  });
  assert.equal(pool.statements.length, count);
});

test('RLS request rolls back and never exposes row details from a database error', async () => {
  const pool = fakePool((sql) => {
    if (sql === 'FAIL')
      throw Object.assign(new Error('sensitive synthetic row detail'), {
        code: '42501',
        detail: 'sensitive',
      });
  });
  await assert.rejects(
    createWorkspaceRunner(pool)(contextA, (tx) => tx.query('FAIL')),
    (error) =>
      error.code === 'DB_REQUEST_REJECTED' &&
      error.sqlState === '42501' &&
      !JSON.stringify(error).includes('sensitive') &&
      !error.message.includes('sensitive') &&
      error.cause === undefined,
  );
  assert.equal(
    pool.statements.some((item) => item.sql === 'ROLLBACK'),
    true,
  );
  assert.equal(
    pool.statements.some((item) => item.sql === 'COMMIT'),
    false,
  );
  assert.deepEqual(pool.releases, [false]);
});

test('RLS request destroys the connection when rollback fails', async () => {
  const pool = fakePool((sql) => {
    if (['FAIL', 'ROLLBACK'].includes(sql))
      throw new Error('synthetic failure');
  });
  await assert.rejects(
    createWorkspaceRunner(pool)(contextA, (tx) => tx.query('FAIL')),
    { code: 'DB_REQUEST_REJECTED' },
  );
  assert.deepEqual(pool.releases, [true]);
});

test('RLS request preserves confirmed commit outcome when cleanup fails', async () => {
  let committed = false;
  const pool = fakePool((sql) => {
    if (sql === 'COMMIT') committed = true;
    if (sql === 'RESET ALL; RESET ROLE' && committed)
      throw new Error('synthetic cleanup failure');
  });
  assert.equal(
    await createWorkspaceRunner(pool)(contextA, async () => 'committed'),
    'committed',
  );
  assert.deepEqual(pool.releases, [true]);
});

test('RLS request rejects a nested context instead of deadlocking a single-connection pool', async () => {
  const pool = fakePool();
  const run = createWorkspaceRunner(pool);
  await assert.rejects(
    run(contextA, async () => run(contextA, async () => {})),
    { code: 'NESTED_CONTEXT_REJECTED' },
  );
  assert.equal(
    pool.statements.filter((item) => item.sql.startsWith('BEGIN')).length,
    1,
  );
  assert.deepEqual(pool.releases, [false]);
});
