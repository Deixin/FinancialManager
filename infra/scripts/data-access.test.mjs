import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkDataAccess,
  validateDataAccessSource,
  dataAccessPolicy,
} from './check-data-access.mjs';
import {
  ReadGuard,
  captureRequest,
  authorizeContext,
} from '../../packages/persistence-postgres/dist/internal/scope.js';
import { guardedPool } from '../../packages/persistence-postgres/dist/internal/driver.js';
import { createPostgresReadUnit } from '../../packages/persistence-postgres/dist/index.js';
import { readAccountActivity } from '../../packages/finance-ports/dist/index.js';
import {
  repositoryChecks,
  validateRepositoryEvidence,
} from '../query/evidence.mjs';
const workspace = '0199d021-0000-7000-8000-000000000001';
const account = '0199d021-0000-7000-8000-00000000000b';
const other = '0199d021-0000-7000-8000-000000000002';
const request = () => ({
  workspace_id: workspace,
  principal_id: 'synthetic-principal',
});
const grant = () => ({
  workspace_id: workspace,
  permissions: ['accounts:read', 'transactions:read'],
  account_ids: [account],
});
const modulePath = 'packages/persistence-postgres/src/modules/accounts.ts';
test('data modules cover each financial table once and current sources respect ownership', () => {
  assert.deepEqual(checkDataAccess(), []);
  const tables = Object.values(dataAccessPolicy.modules).flat().sort();
  const sql = readFileSync(
    new URL(
      '../../apps/api/persistence/postgres/migrations/0001-financial-core.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const physical = [...sql.matchAll(/CREATE TABLE fm\.([a-z_]+)/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'schema_migration')
    .sort();
  assert.equal(tables.length, 12);
  assert.deepEqual(tables, physical);
});
test('architecture rejects cross-module tables, runtime SQL, casts, dynamic tables and unapproved imports', () => {
  for (const source of [
    "db.selectFrom('financial_transaction').selectAll()",
    "db.selectFrom('financial_account').innerJoin('category', 'id', 'id')",
    'db.selectFrom(dynamicName)',
    'db as any',
    'sql`select * from fm.financial_transaction`',
    "import {sql} from 'kysely'",
    "import {db} from '../internal/driver.js'",
    "import {createTransactionsRepository} from './transactions.js'",
    "db.insertInto('financial_account')",
    "db.withSchema('another')",
    "import('pg')",
    "db.fn('unapproved_function', [])",
  ])
    assert.ok(validateDataAccessSource(modulePath, source).length > 0);
  assert.deepEqual(
    validateDataAccessSource(
      modulePath,
      "import type {Kysely} from 'kysely'; db.selectFrom('financial_account as a').selectAll()",
    ),
    [],
  );
});
test('architecture requires child reads to join the parent and restricts backend driver installation', () => {
  const txPath = 'packages/persistence-postgres/src/modules/transactions.ts';
  for (const table of dataAccessPolicy.parent_scoped_tables) {
    assert.ok(
      validateDataAccessSource(txPath, `db.selectFrom('${table}').selectAll()`)
        .length,
    );
    assert.ok(
      validateDataAccessSource(
        txPath,
        `db.selectFrom('${table}').leftJoin('financial_transaction', 'id', 'id')`,
      ).length,
    );
    assert.deepEqual(
      validateDataAccessSource(
        txPath,
        `db.selectFrom('${table}').innerJoin('financial_transaction', 'id', 'id')`,
      ),
      [],
    );
  }
  for (const path of [
    'apps/api/src/transactions.ts',
    'apps/worker/src/job.ts',
    'packages/finance-ports/src/index.ts',
  ]) {
    assert.ok(
      validateDataAccessSource(
        path,
        "import {createPostgresReadUnit} from '@financial-manager/persistence-postgres'",
      ).length,
    );
    assert.ok(
      validateDataAccessSource(path, "db.selectFrom('financial_account')")
        .length,
    );
  }
  assert.ok(
    validateDataAccessSource(
      'apps/api/src/transactions.ts',
      "import pg from 'pg'",
    ).length,
  );
  assert.deepEqual(
    validateDataAccessSource(
      'apps/api/src/read-model.ts',
      "import {createPostgresReadUnit} from '@financial-manager/persistence-postgres'",
    ),
    [],
  );
});
test('authorization captures and freezes the trusted grant and denies invalid workspace or account grants', async () => {
  const input = request(),
    captured = captureRequest(input),
    mutable = grant();
  input.workspace_id = other;
  const context = await authorizeContext(captured, async () => mutable);
  mutable.account_ids.length = 0;
  mutable.permissions.length = 0;
  assert.equal(context.workspace_id, workspace);
  assert.deepEqual(context.account_ids, [account]);
  assert.ok(
    Object.isFrozen(context) &&
      Object.isFrozen(context.account_ids) &&
      Object.isFrozen(context.permissions),
  );
  for (const invalid of [
    null,
    { ...grant(), workspace_id: other },
    { ...grant(), permissions: ['ADMIN'] },
    { ...grant(), account_ids: ['invalid'] },
  ])
    await assert.rejects(authorizeContext(captured, async () => invalid));
  await assert.rejects(
    authorizeContext(captured, async () => {
      throw Error('SYNTHETIC_PRIVATE_AUTH_CANARY');
    }),
    { message: 'ACCESS_DENIED' },
  );
  assert.throws(() => captureRequest({ ...request(), permissions: [] }), {
    code: 'INVALID_INPUT',
  });
});
test('denied authorization never obtains a connection and closing a borrowed unit is idempotent', async () => {
  let connects = 0,
    ends = 0;
  const pool = {
    options: {},
    connect: async () => {
      connects++;
      throw Error('MUST_NOT_CONNECT');
    },
    end: async () => {
      ends++;
    },
  };
  const unit = createPostgresReadUnit({
    pool,
    authorize: async () => null,
    expected_role: 'synthetic_runtime',
  });
  await assert.rejects(
    unit.read(request(), async () => {}),
    { code: 'ACCESS_DENIED' },
  );
  assert.equal(connects, 0);
  await Promise.all([unit.close(), unit.close()]);
  assert.equal(ends, 0);
  await assert.rejects(
    unit.read(request(), async () => {}),
    { code: 'CLOSED' },
  );
});
test('driver discards poisoned connections, prevents reuse and only closes an owned pool', async () => {
  const releases = [],
    queries = [];
  let ends = 0;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (sql === 'ROLLBACK') throw Error('SYNTHETIC_PRIVATE_DRIVER_CANARY');
      return { rows: [] };
    },
    release: (discard) => releases.push(discard),
  };
  const pool = {
    options: {},
    connect: async () => client,
    end: async () => {
      ends++;
    },
  };
  const borrowed = guardedPool(pool, false),
    connection = await borrowed.connect();
  await connection.query('BEGIN', []);
  await assert.rejects(connection.query('ROLLBACK', []));
  connection.release();
  connection.release();
  await assert.rejects(connection.query('SELECT 1', []), {
    code: 'SCOPE_CLOSED',
  });
  assert.deepEqual(releases, [true]);
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK']);
  await borrowed.end();
  assert.equal(ends, 0);
  const owned = guardedPool(pool, true),
    healthy = await owned.connect();
  healthy.release();
  assert.deepEqual(releases, [true, false]);
  await owned.end();
  assert.equal(ends, 1);
});
test('scope retirement drains unawaited work, closes escaped ports and latches sanitized query errors', async () => {
  const context = await authorizeContext(captureRequest(request()), async () =>
    grant(),
  );
  const guard = new ReadGuard(context);
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const pending = guard.query('accounts:read', () => barrier);
  const retirement = guard.finish();
  release('synthetic');
  await assert.rejects(pending, { code: 'SCOPE_CLOSED' });
  await assert.rejects(retirement, { code: 'PENDING_WORK' });
  await assert.rejects(
    guard.query('accounts:read', async () => {}),
    { code: 'SCOPE_CLOSED' },
  );
  const failure = new ReadGuard(context);
  await assert.rejects(
    failure.query('accounts:read', async () => {
      throw Error('SYNTHETIC_PRIVATE_SQL_CANARY');
    }),
    { message: 'DATA_ACCESS_FAILED' },
  );
  await assert.rejects(failure.finish(), { code: 'UNIT_OF_WORK_FAILED' });
});
test('pure account activity composes ports and snapshots filters before asynchronous authorization', async () => {
  const calls = [],
    args = {
      account_id: account,
      from: '2026-01-01',
      through: '2026-12-31',
      limit: 2,
    };
  let allow;
  const barrier = new Promise((resolve) => {
    allow = resolve;
  });
  const unit = {
    read: async (input, operation) => {
      await barrier;
      return operation({
        accounts: {
          get: async (id) => {
            calls.push(id);
            return { id };
          },
        },
        transactions: {
          page: async (filter) => {
            calls.push(filter);
            return { items: [], next_cursor: null };
          },
        },
      });
    },
  };
  const work = readAccountActivity(unit, request(), args);
  args.account_id = other;
  args.from = '2025-01-01';
  allow();
  assert.equal((await work).account.id, account);
  assert.equal(calls[1].account_id, account);
  assert.equal(calls[1].from, '2026-01-01');
});
test('current repository evidence requires every real gate, source hash, cleanup and declared limitations', () => {
  const historical = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-024-repositories-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(
    validateRepositoryEvidence(historical, { matchSources: false }).passed,
    true,
  );
  const previous = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-024-repositories-2026-10-16-us025.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(
    validateRepositoryEvidence(previous, { matchSources: false }).passed,
    true,
  );
  historical.source_sha256['package.json'] = 'invalid-hash';
  assert.throws(
    () => validateRepositoryEvidence(historical, { matchSources: false }),
    /REPOSITORY_EVIDENCE_INVALID/,
  );
  assert.equal(
    validateRepositoryEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-024-repositories-2026-10-16-us026.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      { matchSources: false },
    ).passed,
    true,
  );
  assert.equal(
    validateRepositoryEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-024-repositories-2026-10-16-us027.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      { matchSources: false },
    ).passed,
    true,
  );
  assert.equal(
    validateRepositoryEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-024-repositories-2026-10-16-us030.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      { matchSources: false },
    ).passed,
    true,
  );
  const load = () =>
    JSON.parse(
      readFileSync(
        new URL(
          '../../docs/quality/evidence/us-024-repositories-2026-10-18-us041-core.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  assert.equal(validateRepositoryEvidence(load()).passed, true);
  for (const gate of repositoryChecks) {
    const report = load();
    delete report.checks[gate];
    assert.throws(
      () => validateRepositoryEvidence(report),
      /REPOSITORY_EVIDENCE_INVALID/,
    );
  }
  for (const mutate of [
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.payload = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (r) => {
      r.versions.kysely = '0.0.0';
    },
  ]) {
    const report = load();
    mutate(report);
    assert.throws(
      () => validateRepositoryEvidence(report),
      /REPOSITORY_EVIDENCE_INVALID/,
    );
  }
});
