import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  accountChecks,
  validateAccountEvidence,
} from '../accounts/evidence.mjs';
import {
  AccountChangeError,
  captureAccountChange,
  planAccountChange,
  decodeAccountState,
  selectBalanceReference,
  compareAccountBalance,
} from '../../packages/domain/dist/index.js';
import {
  createAccountWriteService,
  readCalculatedAccountBalance,
} from '../../packages/finance-ports/dist/index.js';
import { createSqliteAccountService } from '../../packages/storage-schema/dist/index.js';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
const id = (n) => '0199d040-0000-7000-8000-' + String(n).padStart(12, '0'),
  workspace = id(1),
  now = '2026-10-17T12:00:00.000Z';
const create = (n = 2, reference = true) => ({
  kind: 'CREATE',
  account: {
    id: id(n),
    name: 'SYNTHETIC US040 ACCOUNT',
    institution_name: null,
    account_kind: 'CHECKING',
    balance_nature: 'ASSET',
    currency_code: 'BRL',
  },
  reference: reference
    ? {
        id: id(n + 100),
        amount_minor: '100000',
        reference_date: '2026-10-01',
        day_position: 'START_OF_DAY',
      }
    : null,
});
const grant = () => ({
  workspace_id: workspace,
  authority: 'LOCAL',
  can_write: true,
  can_create: true,
  account_ids: null,
});
const setup = async (override = {}) => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  await handle.db.run(
    "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,created_at) VALUES(?,'SYNTHETIC US040','PERSONAL','LOCAL','BRL',?,?)",
    [workspace, id(999), now],
  );
  const service = createSqliteAccountService({
    connection: handle.db,
    authorize: async () => grant(),
    identity: { nowInstant: () => now },
    ...override,
  });
  const state = async (accountId = id(2)) => {
    const account = (
      await handle.db.rows('SELECT * FROM financial_account WHERE id=?', [
        accountId,
      ])
    )[0];
    return account
      ? decodeAccountState(
          {
            account,
            references: await handle.db.rows(
              'SELECT * FROM balance_reference WHERE account_id=? ORDER BY id',
              [accountId],
            ),
          },
          workspace,
        )
      : null;
  };
  return {
    handle,
    service,
    state,
    async close() {
      await service.close();
      handle.close();
    },
  };
};
const rejects = (work, code) =>
  assert.rejects(
    work,
    (e) =>
      e instanceof AccountChangeError &&
      e.code === code &&
      e.message === code &&
      !('cause' in e),
  );
test('account commands capture immutable canonical input and reject ambiguous money, dates, nature and private fields', () => {
  const value = create();
  const captured = captureAccountChange(value, workspace);
  value.account.name = 'SYNTHETIC MUTATED';
  value.reference.amount_minor = '1';
  assert.equal(captured.account.name, 'SYNTHETIC US040 ACCOUNT');
  assert.equal(captured.reference.amount_minor, '100000');
  assert.ok(
    Object.isFrozen(captured) &&
      Object.isFrozen(captured.account) &&
      Object.isFrozen(captured.reference),
  );
  for (const mutate of [
    (v) => (v.extra = 'PRIVATE'),
    (v) => (v.account.name = ' '),
    (v) => (v.account.name = 'SYNTHETIC\nPRIVATE'),
    (v) => (v.account.name = 'x'.repeat(121)),
    (v) => (v.account.currency_code = 'USD'),
    (v) => (v.account.balance_nature = 'LIABILITY'),
    (v) => (v.reference.amount_minor = 1),
    (v) => (v.reference.amount_minor = '01'),
    (v) => (v.reference.amount_minor = '1.1'),
    (v) => (v.reference.amount_minor = '9223372036854775808'),
    (v) => (v.reference.day_position = null),
    (v) => (v.reference.reference_date = '2026-02-30'),
    (v) => (v.reference.id = v.account.id),
  ]) {
    const v = create();
    mutate(v);
    assert.throws(() => captureAccountChange(v, workspace));
  }
  const card = create();
  card.account.account_kind = 'CREDIT_CARD';
  card.account.balance_nature = 'LIABILITY';
  assert.equal(
    captureAccountChange(card, workspace).account.balance_nature,
    'LIABILITY',
  );
  assert.equal(
    new AccountChangeError('SYNTHETIC_PRIVATE').message,
    'DATA_ACCESS_FAILED',
  );
});
test('account creation and initial reference commit together and retry after lost acknowledgement creates one account', async () => {
  const s = await setup();
  try {
    assert.equal(
      (await s.service.apply({ workspace_id: workspace }, create())).changed,
      true,
    );
    assert.equal(
      (await s.service.apply({ workspace_id: workspace }, create())).changed,
      false,
    );
    const state = await s.state();
    assert.equal(state.references.length, 1);
    assert.equal(state.account.status, 'ACTIVE');
    assert.equal(state.references[0].amount_minor, '100000');
    assert.equal(
      (await s.handle.db.rows('SELECT count(*) AS n FROM financial_account'))[0]
        .n,
      '1',
    );
  } finally {
    await s.close();
  }
});
test('metadata edit uses explicit base, rejects stale overwrite, archives and reactivates without deleting reference history', async () => {
  const s = await setup();
  try {
    await s.service.apply({ workspace_id: workspace }, create());
    const base = (await s.state()).account;
    const edit = {
      kind: 'UPDATE',
      base,
      name: 'SYNTHETIC RENAMED',
      institution_name: 'SYNTHETIC BANK',
      status: 'ACTIVE',
    };
    assert.equal(
      (await s.service.apply({ workspace_id: workspace }, edit)).changed,
      true,
    );
    assert.equal(
      (await s.service.apply({ workspace_id: workspace }, edit)).changed,
      false,
    );
    await rejects(
      s.service.apply(
        { workspace_id: workspace },
        { ...edit, name: 'SYNTHETIC STALE' },
      ),
      'STALE_ACCOUNT',
    );
    await s.service.apply(
      { workspace_id: workspace },
      { ...edit, base: (await s.state()).account, status: 'ARCHIVED' },
    );
    assert.equal((await s.state()).account.status, 'ARCHIVED');
    assert.equal((await s.state()).references.length, 1);
    await rejects(
      s.service.apply(
        { workspace_id: workspace },
        {
          kind: 'REFERENCE',
          account_id: id(2),
          replaces_id: id(102),
          reference: { ...create().reference, id: id(103) },
        },
      ),
      'ACCOUNT_ARCHIVED',
    );
    await s.service.apply(
      { workspace_id: workspace },
      { ...edit, base: (await s.state()).account, status: 'ACTIVE' },
    );
    assert.equal((await s.state()).account.status, 'ACTIVE');
  } finally {
    await s.close();
  }
});
test('reference correction preserves superseded values and timestamps, retries and rejects a stale concurrent replacement', async () => {
  const s = await setup();
  try {
    await s.service.apply({ workspace_id: workspace }, create());
    const original = (await s.state()).references[0];
    const update = {
      kind: 'REFERENCE',
      account_id: id(2),
      replaces_id: original.id,
      reference: {
        id: id(103),
        amount_minor: '9007199254740993',
        reference_date: '2026-10-02',
        day_position: 'END_OF_DAY',
      },
    };
    await s.service.apply({ workspace_id: workspace }, update);
    assert.equal(
      (await s.service.apply({ workspace_id: workspace }, update)).changed,
      false,
    );
    const state = await s.state();
    assert.deepEqual(state.references[0], {
      ...original,
      status: 'SUPERSEDED',
    });
    assert.equal(state.references[1].amount_minor, '9007199254740993');
    await rejects(
      s.service.apply(
        { workspace_id: workspace },
        { ...update, reference: { ...update.reference, id: id(104) } },
      ),
      'STALE_ACCOUNT',
    );
    assert.equal((await s.state()).references.length, 2);
  } finally {
    await s.close();
  }
});
test('optional reference, both i64 bounds and no implicit start or end of day survive real SQLite storage', async () => {
  const s = await setup();
  try {
    await s.service.apply({ workspace_id: workspace }, create(2, false));
    assert.deepEqual((await s.state()).references, []);
    for (const [n, amount] of [
      [3, '9223372036854775807'],
      [4, '-9223372036854775808'],
    ]) {
      const c = create(n);
      c.reference.amount_minor = amount;
      await s.service.apply({ workspace_id: workspace }, c);
      assert.equal((await s.state(id(n))).references[0].amount_minor, amount);
    }
  } finally {
    await s.close();
  }
});
test('a failure inserting the initial reference rolls back the account and leaves the connection usable', async () => {
  const s = await setup();
  try {
    let fail = true;
    const service = createSqliteAccountService({
      connection: {
        ...s.handle.db,
        async rows(sql, values) {
          if (fail && sql.startsWith('INSERT INTO balance_reference')) {
            fail = false;
            throw Error('SYNTHETIC_PRIVATE_SQL');
          }
          return s.handle.db.rows(sql, values);
        },
      },
      authorize: async () => grant(),
      identity: { nowInstant: () => now },
    });
    try {
      await rejects(
        service.apply({ workspace_id: workspace }, create()),
        'DATA_ACCESS_FAILED',
      );
      assert.equal(await s.state(), null);
      await service.apply({ workspace_id: workspace }, create());
      assert.equal((await s.state()).references.length, 1);
    } finally {
      await service.close();
    }
  } finally {
    await s.close();
  }
});
test('authorization precedes storage, captures request and payload before await and scopes creation separately from editing', async () => {
  let calls = 0,
    release;
  const request = { workspace_id: workspace },
    change = create();
  const service = createAccountWriteService({
    authorize: () =>
      new Promise((r) => {
        release = r;
      }),
    identity: { nowInstant: () => now },
    store: {
      async transaction(scope, fn) {
        calls++;
        assert.equal(scope.workspace_id, workspace);
        return fn({
          workspaceMode: async () => 'LOCAL',
          load: async () => null,
          async save(plan) {
            assert.equal(plan.state.account.name, 'SYNTHETIC US040 ACCOUNT');
          },
        });
      },
    },
  });
  const work = service.apply(request, change);
  request.workspace_id = id(90);
  change.account.name = 'SYNTHETIC MUTATED';
  release(grant());
  assert.equal((await work).changed, true);
  assert.equal(calls, 1);
  const s = await setup({
    authorize: async () => ({ ...grant(), can_create: false }),
  });
  try {
    await rejects(
      s.service.apply({ workspace_id: workspace }, create()),
      'ACCESS_DENIED',
    );
    assert.equal(await s.state(), null);
  } finally {
    await s.close();
  }
});
test('account scopes, workspace authority, principal and raw errors fail closed', async () => {
  for (const authorize of [
    async () => null,
    async () => {
      throw Error('SYNTHETIC_PRIVATE');
    },
    async () => ({ ...grant(), workspace_id: id(77) }),
    async () => ({ ...grant(), account_ids: [] }),
    async () => ({ ...grant(), authority: 'CLOUD' }),
    async () => ({ ...grant(), can_write: false }),
  ]) {
    const s = await setup({ authorize });
    try {
      await rejects(
        s.service.apply({ workspace_id: workspace }, create()),
        'ACCESS_DENIED',
      );
      assert.equal(await s.state(), null);
    } finally {
      await s.close();
    }
  }
  const s = await setup();
  try {
    await rejects(
      s.service.apply(
        { workspace_id: workspace, principal_id: id(5) },
        create(),
      ),
      'ACCESS_DENIED',
    );
    await rejects(
      s.service.apply({ workspace_id: id(9) }, create()),
      'ACCESS_DENIED',
    );
  } finally {
    await s.close();
  }
});
test('concurrent metadata edits serialize and only one stale base can change stored state', async () => {
  const s = await setup();
  try {
    await s.service.apply({ workspace_id: workspace }, create());
    const base = (await s.state()).account;
    const results = await Promise.allSettled(
      ['A', 'B'].map((n) =>
        s.service.apply(
          { workspace_id: workspace },
          {
            kind: 'UPDATE',
            base,
            name: 'SYNTHETIC ' + n,
            institution_name: null,
            status: 'ACTIVE',
          },
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'STALE_ACCOUNT',
    );
    assert.equal((await s.state()).account.name, 'SYNTHETIC A');
  } finally {
    await s.close();
  }
});
test('active reference selection respects as-of date and explicit end-of-day over start-of-day', () => {
  const first = planAccountChange(workspace, null, create(), now).state;
  const next = planAccountChange(
    workspace,
    first,
    {
      kind: 'REFERENCE',
      account_id: id(2),
      replaces_id: null,
      reference: {
        id: id(103),
        amount_minor: '120000',
        reference_date: '2026-10-01',
        day_position: 'END_OF_DAY',
      },
    },
    now,
  ).state;
  assert.equal(
    selectBalanceReference(next.references, '2026-10-01').id,
    id(103),
  );
  assert.equal(selectBalanceReference(next.references, '2026-09-30'), null);
  assert.equal(
    selectBalanceReference(next.references, '2026-10-02').amount_minor,
    '120000',
  );
  assert.deepEqual(compareAccountBalance('130000', '130001'), {
    calculated_minor: '130000',
    observed_minor: '130001',
    difference_minor: '1',
    matches: false,
  });
  assert.throws(() =>
    compareAccountBalance('-9223372036854775808', '9223372036854775807'),
  );
});
test('calculated balance reads every page, excludes same-day entries for end-of-day and preserves explicit incompleteness', async () => {
  const state = planAccountChange(
    workspace,
    null,
    {
      ...create(),
      reference: { ...create().reference, day_position: 'END_OF_DAY' },
    },
    now,
  ).state;
  const rows = [
    {
      id: id(300),
      workspace_id: workspace,
      account_id: id(2),
      group_id: null,
      financial_date: '2026-10-01',
      account_amount_minor: '99999',
      economic_kind: 'INCOME',
    },
    ...Array.from({ length: 251 }, (_, i) => ({
      id: id(301 + i),
      workspace_id: workspace,
      account_id: id(2),
      group_id: null,
      financial_date: '2026-10-02',
      account_amount_minor: '100',
      economic_kind: 'INCOME',
    })),
  ];
  let pages = 0;
  const unit = {
    snapshot_consistency: true,
    async read(request, fn) {
      assert.equal(request.workspace_id, workspace);
      return fn({
        accounts: {
          get: async () => state.account,
          references: async () => ({
            items: state.references,
            next_cursor: null,
          }),
        },
        transactions: {
          async page(input) {
            pages++;
            const offset = input.cursor ? Number(input.cursor.offset) : 0;
            const end = offset + input.limit;
            return {
              items: rows.slice(offset, end),
              next_cursor: end < rows.length ? { offset: String(end) } : null,
            };
          },
        },
      });
    },
  };
  const result = await readCalculatedAccountBalance(
    unit,
    { workspace_id: workspace, principal_id: id(5) },
    { account_id: id(2), as_of: '2026-10-02', history_coverage: 'UNKNOWN' },
  );
  assert.equal(result.balance.amount_minor, '125100');
  assert.equal(result.considered_count, '251');
  assert.equal(result.balance.completeness, 'INCOMPLETE');
  assert.equal(pages, 3);
});
test('close refuses new writes and does not erase committed accounts', async () => {
  const s = await setup();
  try {
    await s.service.apply({ workspace_id: workspace }, create());
    await s.service.close();
    await rejects(
      s.service.apply({ workspace_id: workspace }, create(3)),
      'CLOSED',
    );
    assert.equal((await s.state()).account.id, id(2));
  } finally {
    await s.close();
  }
});
test('legacy restored metadata remains readable and can be archived unchanged before an explicit correction', async () => {
  const s = await setup();
  try {
    await s.service.apply({ workspace_id: workspace }, create());
    const name = '  SYNTHETIC LEGACY ' + 'x'.repeat(140) + '  ',
      institution = 'SYNTHETIC LEGACY INSTITUTION ' + 'y'.repeat(140);
    await s.handle.db.run(
      'UPDATE financial_account SET name=?,institution_name=? WHERE id=?',
      [name, institution, id(2)],
    );
    const before = await s.state();
    assert.equal(before.account.name, name);
    await s.service.apply(
      { workspace_id: workspace },
      {
        kind: 'UPDATE',
        base: before.account,
        name,
        institution_name: institution,
        status: 'ARCHIVED',
      },
    );
    const archived = await s.state();
    assert.equal(archived.account.name, name);
    assert.equal(archived.account.institution_name, institution);
    assert.deepEqual(archived.references, before.references);
    await s.service.apply(
      { workspace_id: workspace },
      {
        kind: 'UPDATE',
        base: archived.account,
        name: 'SYNTHETIC CORRECTED',
        institution_name: null,
        status: 'ACTIVE',
      },
    );
    assert.equal((await s.state()).account.name, 'SYNTHETIC CORRECTED');
  } finally {
    await s.close();
  }
});
test('balance orchestration refuses a read unit that cannot promise a single snapshot', async () => {
  let called = false;
  await rejects(
    readCalculatedAccountBalance(
      {
        async read() {
          called = true;
        },
      },
      { workspace_id: workspace, principal_id: id(5) },
      { account_id: id(2), as_of: '2026-10-17', history_coverage: 'COMPLETE' },
    ),
    'CONFIGURATION_INVALID',
  );
  assert.equal(called, false);
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-040-accounts-core-2026-10-18-us042-desktop.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('account evidence requires all real-engine, isolation, snapshot, rollback and cleanup gates', () => {
  assert.equal(validateAccountEvidence(evidence()).passed, true);
  for (const name of accountChecks) {
    const r = evidence();
    delete r.checks[name];
    assert.throws(() => validateAccountEvidence(r), /ACCOUNT_EVIDENCE_INVALID/);
  }
});
test('account evidence refuses stale sources, private payloads and premature UI or human homologation claims', () => {
  for (const change of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) =>
      (r.source_sha256['packages/domain/src/accounts.ts'] = '0'.repeat(64)),
    (r) => (r.account_name = 'SYNTHETIC_PRIVATE'),
    (r) => (r.checks.desktop_ui_integrated = true),
    (r) => (r.completed_at_utc = 'invalid'),
  ]) {
    const r = evidence();
    change(r);
    assert.throws(() => validateAccountEvidence(r), /ACCOUNT_EVIDENCE_INVALID/);
  }
  const old = evidence();
  old.source_sha256['packages/domain/src/accounts.ts'] = '0'.repeat(64);
  assert.equal(
    validateAccountEvidence(old, { matchSources: false }).passed,
    true,
  );
});
