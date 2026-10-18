/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  captureCardPayment,
  cardPaymentChanges,
  validateCardPaymentPlan,
} from '../../packages/domain/dist/card-payments.js';
import { planTransactionRevision } from '../../packages/domain/dist/revisions.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createCardPaymentService } from '../../packages/finance-ports/dist/card-payments.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { createRevisionHarness } from '../revisions/harness.mjs';
import {
  runCardPaymentCases,
  cardPaymentCases,
  id,
} from '../card-payments/protocol.mjs';
import {
  cardPaymentChecks,
  validateCardPaymentEvidence,
} from '../card-payments/evidence.mjs';
const w = id(1),
  now = '2026-10-18T12:00:00.000Z',
  a = {
    id: id(2),
    workspace_id: w,
    currency_code: 'BRL',
    account_kind: 'CASH',
    balance_nature: 'ASSET',
    status: 'ACTIVE',
  },
  b = {
    ...a,
    id: id(3),
    account_kind: 'CREDIT_CARD',
    balance_nature: 'LIABILITY',
  };
const input = () => ({
  kind: 'CREATE',
  id: id(4),
  source_entry_id: id(5),
  target_entry_id: id(6),
  source_account: { ...a },
  target_account: { ...b },
  financial_date: '2026-10-18',
  amount_minor: '9007199254740993',
  display_name: 'SYNTHETIC CARD_PAYMENT',
  original_description: 'SYNTHETIC ORIGINAL',
});
const pair = () => {
  const c = captureCardPayment(input(), w),
    rows = cardPaymentChanges(c);
  return {
    group_id: c.id,
    source: planTransactionRevision(w, null, rows[0], now).after,
    target: planTransactionRevision(w, null, rows[1], now).after,
  };
};
test('cardPayment command captures asset and credit card with equal negative i64 deltas', () => {
  const raw = input(),
    c = captureCardPayment(raw, w);
  raw.source_account.status = 'ARCHIVED';
  raw.display_name = 'SYNTHETIC CHANGED';
  const rows = cardPaymentChanges(c);
  assert.equal(rows[0].content.account_amount_minor, '-9007199254740993');
  assert.equal(rows[1].content.account_amount_minor, '-9007199254740993');
  assert.ok(
    rows.every(
      (r) =>
        r.content.economic_kind === 'DEBT_SETTLEMENT' &&
        r.content.group_id === id(4),
    ),
  );
  assert.ok(Object.isFrozen(c.source_account) && Object.isFrozen(rows));
});
test('cardPayment commands reject floats noncanonical amounts mixed scopes incorrect account roles and unknown fields', () => {
  for (const mutate of [
    (c) => (c.amount_minor = 1),
    (c) => (c.amount_minor = '01'),
    (c) => (c.amount_minor = '0'),
    (c) => (c.amount_minor = '-1'),
    (c) => (c.amount_minor = '9223372036854775808'),
    (c) => (c.target_account.balance_nature = 'ASSET'),
    (c) => (c.target_account.account_kind = 'LOAN_SIMPLE'),
    (c) => (c.source_account.balance_nature = 'LIABILITY'),
    (c) => (c.target_account.id = c.source_account.id),
    (c) => (c.source_entry_id = c.target_entry_id),
    (c) => (c.target_account.workspace_id = id(99)),
    (c) => (c.financial_date = '2026-02-30'),
    (c) => (c.actor = 'SYNTHETIC'),
    (c) => delete c.original_description,
  ]) {
    const c = input();
    mutate(c);
    assert.throws(
      () => captureCardPayment(c, w),
      (e) => e.code === 'INVALID_CARD_PAYMENT',
    );
  }
});
test('paired base preserves provenance and rejects broken imported or one-sided restoration', () => {
  const base = pair();
  for (const mutate of [
    (b) => (b.target.content.deleted = true),
    (b) => (b.target.content.origin_kind = 'IMPORT'),
    (b) => (b.target.content.group_id = id(99)),
    (b) => (b.target.content.account_amount_minor = '1'),
  ]) {
    const v = structuredClone(base);
    mutate(v);
    assert.throws(() => captureCardPayment({ kind: 'DELETE', base: v }, w));
  }
  const c = captureCardPayment(
    {
      kind: 'EDIT',
      base,
      source_account: a,
      target_account: b,
      financial_date: '2026-10-17',
      amount_minor: '123',
      display_name: 'SYNTHETIC EDIT',
    },
    w,
  );
  assert.ok(
    cardPaymentChanges(c).every(
      (r) => r.content.original_description === 'SYNTHETIC ORIGINAL',
    ),
  );
});
test('cardPayment guard compares complete bases live descriptors and source account status', () => {
  const base = pair(),
    c = captureCardPayment({ kind: 'DELETE', base }, w),
    change = cardPaymentChanges(c)[0],
    plan = planTransactionRevision(w, base.source, change, now);
  validateCardPaymentPlan(c, { plan, account: a, previous_account: a }, w);
  const forged = structuredClone(base);
  forged.source.content.display_name = 'SYNTHETIC FORGED';
  assert.throws(
    () =>
      validateCardPaymentPlan(
        { kind: 'DELETE', base: forged },
        { plan, account: a, previous_account: a },
        w,
      ),
    (e) => e.code === 'CARD_PAYMENT_BASE_CONFLICT',
  );
  assert.throws(
    () =>
      validateCardPaymentPlan(
        c,
        { plan, account: { ...a, status: 'ARCHIVED' }, previous_account: a },
        w,
      ),
    (e) => e.code === 'CARD_PAYMENT_ACCOUNT_ARCHIVED',
  );
});
test('authorization precedes group storage and lifecycle remains controlled by revision adapter', async () => {
  let storage = 0;
  const s = createRevisionService({
    store: {
      transaction: async () => {
        storage++;
        throw Error('SYNTHETIC UNREACHABLE');
      },
    },
    authorize: async () => null,
    identity: { newId: () => id(100), nowInstant: () => now },
    change_source: 'MANUAL',
  });
  await assert.rejects(
    () => createCardPaymentService(s).apply({ workspace_id: w }, input()),
    { code: 'ACCESS_DENIED' },
  );
  assert.equal(storage, 0);
});
test('existing composite metadata must describe every current member and account before any save', async () => {
  const b = pair();
  let writes = 0;
  const service = createRevisionService({
    authorize: async () => ({
      workspace_id: w,
      authority: 'LOCAL',
      can_write: true,
      account_ids: null,
      actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
    }),
    identity: { newId: () => id(100), nowInstant: () => now },
    change_source: 'MANUAL',
    store: {
      transaction: async (_, run) =>
        run({
          workspaceMode: async () => 'LOCAL',
          load: async (id) =>
            [b.source, b.target].find((s) => s.id === id) ?? null,
          account: async (id) =>
            [
              a,
              {
                ...a,
                id: b.target.content.account_id,
                account_kind: 'CREDIT_CARD',
                balance_nature: 'LIABILITY',
              },
            ].find((a) => a.id === id) ?? null,
          group: async () => ({
            id: b.group_id,
            group_type: 'CARD_PAYMENT',
            state: 'ACTIVE',
            members: [
              { id: b.source.id, account_id: b.source.content.account_id },
            ],
          }),
          history: async () => null,
          save: async () => {
            writes++;
          },
        }),
    },
  });
  await assert.rejects(
    () =>
      createCardPaymentService(service).apply(
        { workspace_id: w },
        { kind: 'DELETE', base: b },
      ),
    { code: 'COMPOSITE_REQUIRED' },
  );
  assert.equal(writes, 0);
});
test('SQLite cardPayment scenarios commit group both entries and revisions together with real schema constraints', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  for (const w of [fixture.workspace_a, fixture.workspace_b])
    await loadFixture(handle.db, 'sqlite', w);
  const h = createRevisionHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runCardPaymentCases({ ...h, engine: 'sqlite' }, async (n, fn) => {
      await fn();
      seen.push(n);
    });
    assert.deepEqual(seen, cardPaymentCases);
  } finally {
    await h.close();
    handle.close();
  }
});
test('card payment rejects non-v7 creation ids before authorization and contains adapter failures', async () => {
  let calls = 0;
  const host = {
      applyGuarded: async () => {
        calls++;
        throw Error('SYNTHETIC PRIVATE ADAPTER DETAIL');
      },
      applyComposite: async () => {
        calls++;
        throw Error('SYNTHETIC PRIVATE ADAPTER DETAIL');
      },
    },
    service = createCardPaymentService(host);
  for (const field of ['id', 'source_entry_id', 'target_entry_id']) {
    const c = input();
    c[field] = '0199d043-0000-4000-8000-000000000123';
    await assert.rejects(() => service.apply({ workspace_id: w }, c), {
      code: 'INVALID_CARD_PAYMENT',
    });
  }
  assert.equal(calls, 0);
  await assert.rejects(
    () => service.apply({ workspace_id: w }, input()),
    (error) =>
      error.code === 'DATA_ACCESS_FAILED' && !error.message.includes('PRIVATE'),
  );
  assert.equal(calls, 1);
  assert.throws(
    () => createCardPaymentService({ applyGuarded: async () => [] }),
    { code: 'CONFIGURATION_INVALID' },
  );
});
test('composite creation rejects unrelated group types before opening storage', async () => {
  let storage = 0;
  const service = createRevisionService({
    store: {
      transaction: async () => {
        storage++;
        throw Error('SYNTHETIC UNREACHABLE');
      },
    },
    authorize: async () => null,
    identity: { newId: () => id(100), nowInstant: () => now },
    change_source: 'MANUAL',
  });
  const rows = cardPaymentChanges(captureCardPayment(input(), w));
  for (const group of [
    { id: id(4), group_type: 'OTHER_COMPOSITE' },
    { id: id(4), group_type: 'CARD_PAYMENT', workspace_id: w },
  ]) {
    await assert.rejects(
      () => service.applyComposite({ workspace_id: w }, rows, group, () => {}),
      { code: 'INVALID_REVISION' },
    );
  }
  await assert.rejects(
    () =>
      service.applyComposite(
        { workspace_id: w },
        rows,
        { id: id(4), group_type: 'CARD_PAYMENT' },
        null,
      ),
    { code: 'CONFIGURATION_INVALID' },
  );
  assert.equal(storage, 0);
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-043-card-payment-core-2026-10-18-us044-core.json',
    ),
  );
test('cardPayment evidence requires every two-engine atomicity authorization rollback and cleanup gate', () => {
  assert.equal(validateCardPaymentEvidence(evidence()).passed, true);
  for (const n of cardPaymentChecks) {
    const r = evidence();
    delete r.checks[n];
    assert.throws(() => validateCardPaymentEvidence(r));
  }
});
test('cardPayment evidence rejects stale sources private payloads premature UI and human approval', () => {
  for (const mutate of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) => (r.source_sha256['package.json'] = '0'.repeat(64)),
    (r) => (r.financial_payload = 'SYNTHETIC'),
    (r) => (r.checks.desktop_complete = true),
    (r) => (r.completed_at_utc = 'invalid'),
  ]) {
    const r = evidence();
    mutate(r);
    assert.throws(() => validateCardPaymentEvidence(r));
  }
});
