import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  revisionVersion,
  nextRevision,
  captureRevisionContent,
  decodeRevisionSnapshot,
  planTransactionRevision,
  planRevisionReversal,
} from '../../packages/domain/dist/revisions.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createSqliteRevisionService } from '../../packages/storage-schema/dist/revisions.js';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { createApiIdentity } from '../../apps/api/dist/identity.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import {
  ids,
  initialState,
  change,
  grant,
  request,
  runRevisionCases,
  revisionCases,
} from '../revisions/scenarios.mjs';
import { createRevisionHarness } from '../revisions/harness.mjs';
import {
  revisionChecks,
  validateRevisionEvidence,
} from '../revisions/evidence.mjs';
import { validateDataAccessSource } from './check-data-access.mjs';
const at = '2026-10-17T00:00:00.000Z';
const base = initialState(ids.expense);
const identity = () => ({ ...createApiIdentity(), nowInstant: () => at });
const account = fixture.seed.find(
  (row) =>
    row.table === 'financial_account' &&
    row.values.id === base.content.account_id,
).values;
test('revision counters use canonical i64 strings without precision loss or wraparound', () => {
  assert.equal(revisionVersion('9007199254740993'), '9007199254740993');
  assert.equal(nextRevision('9007199254740993'), '9007199254740994');
  assert.equal(nextRevision('0'), '1');
  for (const value of [
    0,
    1,
    null,
    '0',
    '01',
    '-1',
    '1.0',
    '9223372036854775808',
    ' 1',
  ])
    assert.throws(() => revisionVersion(value), { code: 'INVALID_REVISION' });
  assert.throws(() => nextRevision('9223372036854775807'), {
    code: 'VERSION_EXHAUSTED',
  });
});
test('canonical revision snapshots preserve the whole prior aggregate and freeze all relations', () => {
  const input = change(base, {
    display_name: 'SYNTHETIC NEW LABEL',
    allocations: base.content.allocations.map((row) => ({
      ...row,
      note: 'SYNTHETIC NEW NOTE',
    })),
  });
  const plan = planTransactionRevision(ids.a, base, input, at);
  assert.equal(plan.after.version, '2');
  assert.deepEqual(plan.snapshot.before, base);
  assert.equal(plan.snapshot.base_revision, '1');
  assert.equal(
    plan.snapshot.after.content.allocations[0].note,
    'SYNTHETIC NEW NOTE',
  );
  assert.ok(
    Object.isFrozen(plan) &&
      Object.isFrozen(plan.after.content) &&
      Object.isFrozen(plan.after.content.allocations[0]),
  );
  input.content.allocations[0].note = 'SYNTHETIC MUTATED';
  assert.equal(plan.after.content.allocations[0].note, 'SYNTHETIC NEW NOTE');
  assert.equal(
    typeof JSON.parse(JSON.stringify(plan.snapshot)).after.content
      .account_amount_minor,
    'string',
  );
  assert.throws(
    () =>
      captureRevisionContent({
        ...base.content,
        original_document: 'SYNTHETIC FORBIDDEN ORIGINAL',
      }),
    { code: 'INVALID_REVISION' },
  );
});
test('stale bases are rejected before no-op detection and original provenance cannot be rewritten', () => {
  const noop = planTransactionRevision(ids.a, base, change(base), at);
  assert.equal(noop.changed, false);
  assert.equal(noop.snapshot, null);
  assert.equal(noop.after.version, '1');
  assert.throws(
    () =>
      planTransactionRevision(
        ids.a,
        base,
        { ...change(base), base_revision: '0' },
        at,
      ),
    { code: 'VERSION_CONFLICT' },
  );
  for (const patch of [
    { original_description: 'SYNTHETIC FORGED SOURCE' },
    { origin_kind: 'IMPORT' },
  ])
    assert.throws(
      () => planTransactionRevision(ids.a, base, change(base, patch), at),
      { code: 'ORIGIN_IMMUTABLE' },
    );
});
test('snapshot decoding is independent of JSONB object-key order and rejects inconsistent bases', () => {
  const plan = planTransactionRevision(
    ids.a,
    base,
    change(base, { display_name: 'SYNTHETIC JSONB' }),
    at,
  );
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, child]) => [key, reorder(child)]),
          )
        : value;
  assert.deepEqual(
    decodeRevisionSnapshot(reorder(plan.snapshot)),
    plan.snapshot,
  );
  for (const patch of [
    { base_revision: '0' },
    { format_version: 2 },
    { original_document: 'SYNTHETIC EXTRA' },
  ])
    assert.throws(
      () => decodeRevisionSnapshot({ ...plan.snapshot, ...patch }),
      { code: 'INVALID_SNAPSHOT' },
    );
});
test('reversal creates a new revision, preserves later edits and undoes creation through soft deletion', () => {
  const plan = planTransactionRevision(
    ids.a,
    base,
    change(base, { display_name: 'SYNTHETIC CHANGE' }),
    at,
  );
  const reverted = planRevisionReversal(plan.after, plan.snapshot, '2', at);
  assert.equal(reverted.after.version, '3');
  assert.deepEqual(reverted.after.content, base.content);
  const later = planTransactionRevision(
    ids.a,
    plan.after,
    change(plan.after, { display_name: 'SYNTHETIC LATER' }),
    at,
  );
  assert.throws(
    () => planRevisionReversal(later.after, plan.snapshot, '3', at),
    { code: 'REVERSAL_CONFLICT' },
  );
  const created = planTransactionRevision(
    ids.a,
    null,
    { id: ids.created, base_revision: '0', content: base.content },
    at,
  );
  const undone = planRevisionReversal(created.after, created.snapshot, '1', at);
  assert.equal(undone.after.version, '2');
  assert.equal(undone.after.content.deleted, true);
  assert.ok(undone.after.deleted_at);
});
test('authorization denies before touching storage and invalid requests cannot inject a grant', async () => {
  let touched = 0;
  const options = {
    store: {
      async transaction() {
        touched++;
        throw Error('MUST_NOT_ACCESS_STORAGE');
      },
    },
    identity: identity(),
    change_source: 'MANUAL',
    authorize: async () => null,
  };
  const service = createRevisionService(options);
  await assert.rejects(service.apply(request(), [change(base)]), {
    code: 'ACCESS_DENIED',
  });
  await assert.rejects(
    service.apply({ ...request(), can_write: true }, [change(base)]),
    { code: 'INVALID_REVISION' },
  );
  await assert.rejects(
    service.apply(request(), [{ ...change(base), base_revision: 1 }]),
    { code: 'INVALID_REVISION' },
  );
  const broken = createRevisionService({
    ...options,
    authorize: async () => {
      throw Error('SYNTHETIC_PRIVATE_AUTH_CANARY');
    },
  });
  await assert.rejects(broken.apply(request(), [change(base)]), {
    message: 'ACCESS_DENIED',
  });
  assert.equal(touched, 0);
});
test('commands, grants, configured providers and attribution are captured before asynchronous work', async () => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const saved = [];
  const mutableGrant = grant(request());
  mutableGrant.account_ids = [base.content.account_id];
  const tx = {
    workspaceMode: async () => 'CLOUD',
    load: async () => base,
    account: async () => account,
    group: async () => null,
    history: async () => null,
    save: async (plan, record) => saved.push({ plan, record }),
  };
  const store = {
    async transaction(scope, operation) {
      assert.deepEqual(scope.account_ids, [base.content.account_id]);
      mutableGrant.account_ids.length = 0;
      mutableGrant.actor.actor_id = ids.created;
      return operation(tx);
    },
  };
  const options = {
    store,
    identity: identity(),
    change_source: 'MANUAL',
    authorize: async (input) => {
      assert.ok(Object.isFrozen(input));
      await barrier;
      return mutableGrant;
    },
  };
  const service = createRevisionService(options),
    input = request(),
    proposal = change(base, {
      display_name: 'SYNTHETIC CAPTURED',
      allocations: base.content.allocations.map((row) => ({ ...row })),
    });
  const work = service.apply(input, [proposal]);
  input.workspace_id = ids.b;
  proposal.content.display_name = 'SYNTHETIC MUTATED';
  proposal.content.allocations[0].note = 'SYNTHETIC MUTATED';
  options.change_source = 'SYSTEM';
  store.transaction = async () => {
    throw Error('MUTATED_STORE');
  };
  options.identity.nowInstant = () => {
    throw Error('MUTATED_CLOCK');
  };
  release();
  assert.equal((await work)[0].version, '2');
  assert.equal(saved[0].record.actor_id, ids.actor);
  assert.equal(saved[0].record.change_source, 'MANUAL');
  assert.equal(saved[0].plan.after.content.display_name, 'SYNTHETIC CAPTURED');
  assert.equal(saved[0].plan.after.content.allocations[0].note, null);
});
test('a bounded large revision batch stays in one transaction and oversized batches fail before storage', async () => {
  let transactions = 0,
    writes = 0;
  const service = createRevisionService({
    store: {
      transaction: async (scope, operation) => {
        transactions++;
        return operation({
          workspaceMode: async () => 'CLOUD',
          load: async () => null,
          account: async () => account,
          group: async () => null,
          history: async () => null,
          save: async (plan, record) => {
            writes++;
            assert.equal(record.snapshot.base_revision, '0');
            assert.equal(plan.after.version, '1');
          },
        });
      },
    },
    identity: identity(),
    change_source: 'MANUAL',
    authorize: async (input) => grant(input),
  });
  const changes = Array.from({ length: 65 }, (_, index) => ({
    id:
      '0199d026-0000-7000-8000-' +
      (1000 + index).toString(16).padStart(12, '0'),
    base_revision: '0',
    content: { ...base.content, allocations: [], tag_ids: [] },
  }));
  assert.equal((await service.apply(request(), changes)).length, 65);
  assert.equal(transactions, 1);
  assert.equal(writes, 65);
  await assert.rejects(
    service.apply(request(), Array(10001).fill(changes[0])),
    { code: 'INVALID_REVISION' },
  );
  assert.equal(transactions, 1);
  assert.equal(writes, 65);
});
test('both destination accounts and accounts restored by reversal must remain authorized', async () => {
  const savings = fixture.seed.find(
    (row) =>
      row.table === 'financial_account' &&
      row.values.account_kind === 'SAVINGS',
  ).values;
  let writes = 0;
  const moved = planTransactionRevision(
    ids.a,
    base,
    change(base, { account_id: savings.id }),
    at,
  );
  const make = (current, permitted, snapshot) =>
    createRevisionService({
      store: {
        transaction: async (scope, operation) =>
          operation({
            workspaceMode: async () => 'CLOUD',
            load: async () => current,
            account: async () => savings,
            group: async () => null,
            history: async () => snapshot,
            save: async () => {
              writes++;
            },
          }),
      },
      identity: identity(),
      change_source: 'MANUAL',
      authorize: async (input) => ({
        ...grant(input),
        account_ids: [permitted],
      }),
    });
  await assert.rejects(
    make(base, base.content.account_id, null).apply(request(), [
      change(base, { account_id: savings.id }),
    ]),
    { code: 'ACCESS_DENIED' },
  );
  await assert.rejects(
    make(moved.after, savings.id, moved.snapshot).revert(request(), [
      { id: base.id, base_revision: '2', revision_version: '2' },
    ]),
    { code: 'ACCESS_DENIED' },
  );
  assert.equal(writes, 0);
});
test('local authority writes without a cloud user and cannot be substituted for a cloud grant', async () => {
  const sqlite = openProbeDatabase(':memory:');
  let service;
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    await loadFixture(sqlite.db, 'sqlite', ids.a);
    await sqlite.db.run(
      "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation) VALUES(?,'SYNTHETIC LOCAL','PERSONAL','LOCAL','BRL',?)",
      [ids.local, ids.created],
    );
    await sqlite.db.run(
      "INSERT INTO financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status) VALUES(?,?,'SYNTHETIC LOCAL','CHECKING','ASSET','BRL','ACTIVE')",
      [ids.localAccount, ids.local],
    );
    service = createSqliteRevisionService({
      connection: sqlite.db,
      authorize: async (input) => grant(input),
      identity: identity(),
      change_source: 'MANUAL',
    });
    const content = {
      ...base.content,
      account_id: ids.localAccount,
      allocations: [],
      tag_ids: [],
    };
    await service.apply({ workspace_id: ids.local }, [
      { id: ids.localTransaction, base_revision: '0', content },
    ]);
    const rows = await sqlite.db.rows(
      'SELECT actor_type,actor_id,device_id FROM transaction_revision WHERE workspace_id=?',
      [ids.local],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      actor_type: 'LOCAL_USER',
      actor_id: null,
      device_id: null,
    });
    await assert.rejects(
      service.apply({ workspace_id: ids.a }, [change(base)]),
      { code: 'ACCESS_DENIED' },
    );
    await service.close();
    await assert.rejects(service.apply(request(), [change(base)]), {
      code: 'CLOSED',
    });
  } finally {
    await service?.close();
    sqlite.close();
  }
});
test('a failed SQLite rollback poisons the adapter and prevents any subsequent database access', async () => {
  const sqlite = openProbeDatabase(':memory:');
  let service,
    calls = 0;
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    await loadFixture(sqlite.db, 'sqlite', ids.a);
    const connection = {
      exec: async (sql) => {
        calls++;
        if (sql === 'ROLLBACK')
          throw Error('SYNTHETIC_PRIVATE_ROLLBACK_CANARY');
        return sqlite.db.exec(sql);
      },
      rows: async (sql, args) => {
        calls++;
        return sqlite.db.rows(sql, args);
      },
      run: async (sql, args) => {
        calls++;
        if (/^INSERT INTO transaction_revision/.test(sql))
          throw Error('SYNTHETIC_PRIVATE_SQL_CANARY');
        return sqlite.db.run(sql, args);
      },
    };
    service = createSqliteRevisionService({
      connection,
      authorize: async (input) => grant(input),
      identity: identity(),
      change_source: 'MANUAL',
    });
    await assert.rejects(
      service.apply(request(), [
        change(base, { display_name: 'SYNTHETIC FAILURE' }),
      ]),
      { message: 'DATA_ACCESS_FAILED' },
    );
    const before = calls;
    await assert.rejects(
      service.apply(request(), [
        change(base, { display_name: 'SYNTHETIC RETRY' }),
      ]),
      { message: 'DATA_ACCESS_FAILED' },
    );
    assert.equal(calls, before);
  } finally {
    await service?.close();
    sqlite.close();
  }
});
test('architecture limits write capabilities to registered owning modules and static SQLite statements', () => {
  const native =
      'packages/storage-schema/src/revision-adapters/transactions.ts',
    reader = 'packages/storage-schema/src/revision-adapters/accounts.ts',
    writer = 'packages/persistence-postgres/src/modules/transaction-writes.ts';
  for (const source of [
    "db.rows('SELECT * FROM financial_account')",
    'db.rows(sql)',
    "db.rows('SELECT * FROM transaction_revision')",
    "import pg from 'pg'",
    'const raw: any = db',
  ])
    assert.ok(validateDataAccessSource(native, source).length);
  assert.ok(
    validateDataAccessSource(
      reader,
      "db.run('UPDATE financial_account SET name=?')",
    ).length,
  );
  assert.ok(
    validateDataAccessSource(
      reader,
      "db.exec('SELECT id FROM financial_account; DELETE FROM financial_account')",
    ).length,
  );
  assert.ok(
    validateDataAccessSource(writer, "db.deleteFrom('workspace')").length,
  );
  assert.deepEqual(
    validateDataAccessSource(
      writer,
      "db.updateTable('financial_transaction').set({version:'2'})",
    ),
    [],
  );
  assert.ok(
    validateDataAccessSource(
      'packages/storage-schema/src/revision-adapters/hidden.ts',
      "db.rows('SELECT * FROM workspace')",
    ).length,
  );
  assert.ok(
    validateDataAccessSource(
      'packages/finance-ports/src/revisions.ts',
      "db.rows('SELECT * FROM financial_transaction')",
    ).length,
  );
});
test('SQLite executes every persisted revision scenario with strict conflicts, composites and failure rollback', async () => {
  const sqlite = openProbeDatabase(':memory:');
  let harness;
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    for (const workspace of [ids.a, ids.b])
      await loadFixture(sqlite.db, 'sqlite', workspace);
    harness = createRevisionHarness('sqlite', { sqlite: () => sqlite });
    const passed = [];
    await runRevisionCases(harness, async (name, run) => {
      await run();
      passed.push(name);
    });
    assert.deepEqual(passed, revisionCases);
  } finally {
    await harness?.close();
    sqlite.close();
  }
});
test('current revision evidence requires all real engine gates, exact sources and declared integration limits', () => {
  assert.equal(
    validateRevisionEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-026-revisions-2026-10-16-us027.json',
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
    validateRevisionEvidence(
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-026-revisions-2026-10-16-us030.json',
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
          '../../docs/quality/evidence/us-026-revisions-2026-10-18-us041-core.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  const historical = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-026-revisions-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(
    validateRevisionEvidence(historical, { matchSources: false }).passed,
    true,
  );
  historical.source_sha256['package.json'] = 'invalid';
  assert.throws(
    () => validateRevisionEvidence(historical, { matchSources: false }),
    /REVISION_EVIDENCE_INVALID/,
  );
  assert.equal(validateRevisionEvidence(load()).passed, true);
  for (const name of revisionChecks) {
    const r = load();
    delete r.checks[name];
    assert.throws(
      () => validateRevisionEvidence(r),
      /REVISION_EVIDENCE_INVALID/,
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
      r.ios_verified = true;
    },
    (r) => {
      r.completed_at_utc = 'invalid';
    },
  ]) {
    const r = load();
    mutate(r);
    assert.throws(
      () => validateRevisionEvidence(r),
      /REVISION_EVIDENCE_INVALID/,
    );
  }
});
