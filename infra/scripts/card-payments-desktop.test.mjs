/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  syntheticCardPaymentHost,
  workspace,
  id,
} from '../card-payments-desktop/fixture.mjs';
import {
  captureLocalCardPayment,
  decodeCardPaymentsSnapshot,
  decodeCardPaymentResult,
  cardPaymentBase,
  createLocalCardPaymentsGateway,
  LocalCardPaymentError,
  localCardPaymentMessage,
} from '../../apps/desktop/dist/local-card-payments.js';
import { movementAccount } from '../../apps/desktop/dist/local-movements.js';
import { accountRows } from '../../apps/desktop/dist/local-accounts.js';
import {
  browserChecks,
  nativeChecks,
  validateDesktopCardPaymentEvidence,
} from '../card-payments-desktop/evidence.mjs';
const input = (h) => ({
  kind: 'CREATE',
  id: id(10),
  source_entry_id: id(11),
  target_entry_id: id(12),
  source_account: { ...movementAccount(h.accounts[0].account) },
  target_account: { ...movementAccount(h.accounts[1].account) },
  financial_date: '2026-10-18',
  amount_minor: '9007199254740993',
  display_name: 'SYNTHETIC CARD_PAYMENT',
  original_description: null,
});
test('Desktop cardPayment gateway requires native host and captures immutable group pair and canonical money', () => {
  assert.equal(createLocalCardPaymentsGateway(), null);
  const h = syntheticCardPaymentHost(),
    raw = input(h),
    c = captureLocalCardPayment(raw, workspace);
  raw.source_account.status = 'ARCHIVED';
  assert.equal(c.source_account.status, 'ACTIVE');
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.source_account));
  for (const modify of [
    (c) => (c.id = 'invalid'),
    (c) => (c.source_entry_id = '00000000-0000-4000-8000-000000000001'),
    (c) => (c.amount_minor = 100),
    (c) => (c.target_account.id = c.source_account.id),
    (c) => (c.actor = 'SYNTHETIC'),
    (c) => delete c.original_description,
  ]) {
    const c = input(h);
    modify(c);
    assert.throws(
      () => captureLocalCardPayment(c, workspace),
      (e) => e.code === 'INVALID_CARD_PAYMENT',
    );
  }
});
test('cardPayment snapshot binds every group to exactly its visible workspace members and full revisions', async () => {
  const h = syntheticCardPaymentHost();
  await h.apply(input(h));
  const raw = h.snapshot(),
    s = decodeCardPaymentsSnapshot(raw, workspace);
  assert.ok(Object.isFrozen(s.groups[0].member_ids));
  assert.equal(s.groups.length, 1);
  assert.equal(s.movements.history.length, 2);
  for (const modify of [
    (s) => (s.path = 'SYNTHETIC'),
    (s) => (s.groups[0].workspace_id = id(90)),
    (s) => s.groups[0].member_ids.pop(),
    (s) => s.groups[0].member_ids.push(s.groups[0].member_ids[0]),
    (s) => s.groups.push(s.groups[0]),
    (s) => (s.groups = []),
    (s) => s.movements.transactions.pop(),
    (s) => (s.groups[0].state = 'UNKNOWN'),
  ]) {
    const v = structuredClone(raw);
    modify(v);
    assert.throws(
      () => decodeCardPaymentsSnapshot(v, workspace),
      (e) => e.code === 'INVALID_RESPONSE',
    );
  }
});
test('paired native response binds both IDs revisions and group without relying on order', async () => {
  const h = syntheticCardPaymentHost(),
    c = captureLocalCardPayment(input(h), workspace),
    r = await h.apply(c);
  assert.equal(
    decodeCardPaymentResult({ ...r, entries: r.entries.toReversed() }, c)
      .entries.length,
    2,
  );
  for (const mutate of [
    (r) => r.entries.pop(),
    (r) => (r.entries[1] = r.entries[0]),
    (r) => (r.entries[0].version = '2'),
    (r) => (r.group_id = id(30)),
    (r) => (r.entries[0].revision_id = null),
  ]) {
    const v = structuredClone(r);
    mutate(v);
    assert.throws(() => decodeCardPaymentResult(v, c));
  }
});
test('grouped cardPayment deletion and restoration preserve total and complete before after history', async () => {
  const h = syntheticCardPaymentHost();
  await h.apply({ ...input(h), amount_minor: '500' });
  let s = decodeCardPaymentsSnapshot(h.snapshot(), workspace),
    b = cardPaymentBase(s, id(10));
  assert.ok(b);
  let rows = accountRows(s.movements.balance, '2026-10-18');
  assert.deepEqual(
    rows.map((r) => r.value.balance.amount_minor),
    ['99500', '199500'],
  );
  await h.apply({ kind: 'DELETE', base: b });
  s = decodeCardPaymentsSnapshot(h.snapshot(), workspace);
  assert.equal(s.movements.balance.movements.length, 0);
  b = cardPaymentBase(s, id(10));
  await h.apply({ kind: 'RESTORE', base: b });
  s = decodeCardPaymentsSnapshot(h.snapshot(), workspace);
  assert.equal(s.movements.history.length, 6);
  assert.ok(
    s.movements.transactions.every(
      (s) => s.version === '3' && !s.content.deleted,
    ),
  );
});
test('payment base identifies asset and card by account nature when both deltas are negative', async () => {
  const h = syntheticCardPaymentHost();
  await h.apply({ ...input(h), amount_minor: '123' });
  const raw = h.snapshot();
  raw.movements.transactions.reverse();
  raw.groups[0].member_ids.reverse();
  const base = cardPaymentBase(
    decodeCardPaymentsSnapshot(raw, workspace),
    id(10),
  );
  assert.ok(base);
  assert.equal(base.source.content.account_id, id(2));
  assert.equal(base.target.content.account_id, id(3));
  assert.equal(base.source.content.account_amount_minor, '-123');
  assert.equal(base.target.content.account_amount_minor, '-123');
});
test('broken and imported groups remain consultable without exposing legacy snapshots as editable content', async () => {
  const h = syntheticCardPaymentHost();
  await h.apply(input(h));
  h.groups.get(id(10)).state = 'BROKEN';
  assert.equal(
    cardPaymentBase(
      decodeCardPaymentsSnapshot(h.snapshot(), workspace),
      id(10),
    ),
    null,
  );
  h.groups.get(id(10)).state = 'ACTIVE';
  h.states.get(id(11)).content.origin_kind = 'IMPORT';
  h.history[0].compatible = false;
  h.history[0].snapshot = null;
  assert.equal(
    cardPaymentBase(
      decodeCardPaymentsSnapshot(h.snapshot(), workspace),
      id(10),
    ),
    null,
  );
  assert.equal(
    new LocalCardPaymentError('SYNTHETIC SQL').code,
    'STORAGE_UNAVAILABLE',
  );
  assert.doesNotMatch(
    localCardPaymentMessage(Error('SYNTHETIC SQL')),
    /SYNTHETIC/,
  );
});
test('native corpus is reproducibly generated from the current guarded shared cardPayment service', () => {
  const r = spawnSync(
    process.execPath,
    ['infra/card-payments-desktop/generate.mjs', '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0);
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us043-card-payments.json'),
  );
  assert.equal(f.synthetic_only, true);
  assert.equal(f.vectors.length, 72);
  assert.ok(f.vectors.some((v) => v.expected.error === 'VERSION_CONFLICT'));
});
const evidence = (kind) =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-043-desktop-card-payments-' +
        kind +
        '-2026-10-18-us044-desktop.json',
    ),
  );
test('Desktop cardPayment evidence requires pair native crash restore cleanup and every UI gate', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(
      validateDesktopCardPaymentEvidence(evidence(kind)).passed,
      true,
    );
    for (const name of checks) {
      const r = evidence(kind);
      delete r.checks[name];
      assert.throws(() => validateDesktopCardPaymentEvidence(r));
    }
  }
});
test('Desktop cardPayment evidence refuses stale code financial payloads premature cloud or human approval', () => {
  for (const mutate of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) => (r.source_sha256['package.json'] = '0'.repeat(64)),
    (r) => (r.amount = 'SYNTHETIC'),
    (r) => (r.checks.cloud_complete = true),
    (r) => (r.versions.tauri = '0.0.0'),
    (r) => (r.completed_at_utc = 'invalid'),
  ]) {
    const r = evidence('windows');
    mutate(r);
    assert.throws(() => validateDesktopCardPaymentEvidence(r));
  }
});
