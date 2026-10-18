/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  captureTransfer,
  transferChanges,
  validateTransferPlan,
} from '../../packages/domain/dist/transfers.js';
import { planTransactionRevision } from '../../packages/domain/dist/revisions.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createTransferService } from '../../packages/finance-ports/dist/transfers.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { createRevisionHarness } from '../revisions/harness.mjs';
import { runTransferCases, transferCases, id } from '../transfers/protocol.mjs';
import {
  transferChecks,
  validateTransferEvidence,
} from '../transfers/evidence.mjs';
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
  b = { ...a, id: id(3) };
const input = () => ({
  kind: 'CREATE',
  id: id(4),
  source_entry_id: id(5),
  target_entry_id: id(6),
  source_account: { ...a },
  target_account: { ...b },
  financial_date: '2026-10-18',
  amount_minor: '9007199254740993',
  display_name: 'SYNTHETIC TRANSFER',
  original_description: 'SYNTHETIC ORIGINAL',
});
const pair = () => {
  const c = captureTransfer(input(), w),
    rows = transferChanges(c);
  return {
    group_id: c.id,
    source: planTransactionRevision(w, null, rows[0], now).after,
    target: planTransactionRevision(w, null, rows[1], now).after,
  };
};
test('transfer command captures both asset accounts and canonical opposite i64 deltas', () => {
  const raw = input(),
    c = captureTransfer(raw, w);
  raw.source_account.status = 'ARCHIVED';
  raw.display_name = 'SYNTHETIC CHANGED';
  const rows = transferChanges(c);
  assert.equal(rows[0].content.account_amount_minor, '-9007199254740993');
  assert.equal(rows[1].content.account_amount_minor, '9007199254740993');
  assert.ok(
    rows.every(
      (r) =>
        r.content.economic_kind === 'TRANSFER' && r.content.group_id === id(4),
    ),
  );
  assert.ok(Object.isFrozen(c.source_account) && Object.isFrozen(rows));
});
test('transfer commands reject floats noncanonical amounts mixed scopes passive accounts and unknown fields', () => {
  for (const mutate of [
    (c) => (c.amount_minor = 1),
    (c) => (c.amount_minor = '01'),
    (c) => (c.amount_minor = '0'),
    (c) => (c.amount_minor = '-1'),
    (c) => (c.amount_minor = '9223372036854775808'),
    (c) => (c.target_account.balance_nature = 'LIABILITY'),
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
      () => captureTransfer(c, w),
      (e) => e.code === 'INVALID_TRANSFER',
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
    assert.throws(() => captureTransfer({ kind: 'DELETE', base: v }, w));
  }
  const c = captureTransfer(
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
    transferChanges(c).every(
      (r) => r.content.original_description === 'SYNTHETIC ORIGINAL',
    ),
  );
});
test('transfer guard compares complete bases live descriptors and source account status', () => {
  const base = pair(),
    c = captureTransfer({ kind: 'DELETE', base }, w),
    change = transferChanges(c)[0],
    plan = planTransactionRevision(w, base.source, change, now);
  validateTransferPlan(c, { plan, account: a, previous_account: a }, w);
  const forged = structuredClone(base);
  forged.source.content.display_name = 'SYNTHETIC FORGED';
  assert.throws(
    () =>
      validateTransferPlan(
        { kind: 'DELETE', base: forged },
        { plan, account: a, previous_account: a },
        w,
      ),
    (e) => e.code === 'TRANSFER_BASE_CONFLICT',
  );
  assert.throws(
    () =>
      validateTransferPlan(
        c,
        { plan, account: { ...a, status: 'ARCHIVED' }, previous_account: a },
        w,
      ),
    (e) => e.code === 'TRANSFER_ACCOUNT_ARCHIVED',
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
    () => createTransferService(s).apply({ workspace_id: w }, input()),
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
            [a, { ...a, id: b.target.content.account_id }].find(
              (a) => a.id === id,
            ) ?? null,
          group: async () => ({
            id: b.group_id,
            group_type: 'TRANSFER',
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
      createTransferService(service).apply(
        { workspace_id: w },
        { kind: 'DELETE', base: b },
      ),
    { code: 'COMPOSITE_REQUIRED' },
  );
  assert.equal(writes, 0);
});
test('SQLite transfer scenarios commit group both entries and revisions together with real schema constraints', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  for (const w of [fixture.workspace_a, fixture.workspace_b])
    await loadFixture(handle.db, 'sqlite', w);
  const h = createRevisionHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runTransferCases({ ...h, engine: 'sqlite' }, async (n, fn) => {
      await fn();
      seen.push(n);
    });
    assert.deepEqual(seen, transferCases);
  } finally {
    await h.close();
    handle.close();
  }
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-042-transfer-core-2026-10-18-us047-associations.json',
    ),
  );
test('transfer evidence requires every two-engine atomicity authorization rollback and cleanup gate', () => {
  assert.equal(validateTransferEvidence(evidence()).passed, true);
  for (const n of transferChecks) {
    const r = evidence();
    delete r.checks[n];
    assert.throws(() => validateTransferEvidence(r));
  }
});
test('transfer evidence rejects stale sources private payloads premature UI and human approval', () => {
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
    assert.throws(() => validateTransferEvidence(r));
  }
});
