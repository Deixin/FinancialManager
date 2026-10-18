/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  syntheticTransferHost,
  workspace,
  id,
} from '../transfers-desktop/fixture.mjs';
import {
  captureLocalTransfer,
  decodeTransfersSnapshot,
  decodeTransferResult,
  transferBase,
  createLocalTransfersGateway,
  LocalTransferError,
  localTransferMessage,
} from '../../apps/desktop/dist/local-transfers.js';
import { movementAccount } from '../../apps/desktop/dist/local-movements.js';
import { accountRows } from '../../apps/desktop/dist/local-accounts.js';
import {
  browserChecks,
  nativeChecks,
  validateDesktopTransferEvidence,
} from '../transfers-desktop/evidence.mjs';
const input = (h) => ({
  kind: 'CREATE',
  id: id(10),
  source_entry_id: id(11),
  target_entry_id: id(12),
  source_account: { ...movementAccount(h.accounts[0].account) },
  target_account: { ...movementAccount(h.accounts[1].account) },
  financial_date: '2026-10-18',
  amount_minor: '9007199254740993',
  display_name: 'SYNTHETIC TRANSFER',
  original_description: null,
});
test('Desktop transfer gateway requires native host and captures immutable group pair and canonical money', () => {
  assert.equal(createLocalTransfersGateway(), null);
  const h = syntheticTransferHost(),
    raw = input(h),
    c = captureLocalTransfer(raw, workspace);
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
      () => captureLocalTransfer(c, workspace),
      (e) => e.code === 'INVALID_TRANSFER',
    );
  }
});
test('transfer snapshot binds every group to exactly its visible workspace members and full revisions', async () => {
  const h = syntheticTransferHost();
  await h.apply(input(h));
  const raw = h.snapshot(),
    s = decodeTransfersSnapshot(raw, workspace);
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
      () => decodeTransfersSnapshot(v, workspace),
      (e) => e.code === 'INVALID_RESPONSE',
    );
  }
});
test('paired native response binds both IDs revisions and group without relying on order', async () => {
  const h = syntheticTransferHost(),
    c = captureLocalTransfer(input(h), workspace),
    r = await h.apply(c);
  assert.equal(
    decodeTransferResult({ ...r, entries: r.entries.toReversed() }, c).entries
      .length,
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
    assert.throws(() => decodeTransferResult(v, c));
  }
});
test('grouped transfer deletion and restoration preserve total and complete before after history', async () => {
  const h = syntheticTransferHost();
  await h.apply({ ...input(h), amount_minor: '500' });
  let s = decodeTransfersSnapshot(h.snapshot(), workspace),
    b = transferBase(s, id(10));
  assert.ok(b);
  let rows = accountRows(s.movements.balance, '2026-10-18');
  assert.deepEqual(
    rows.map((r) => r.value.balance.amount_minor),
    ['99500', '200500'],
  );
  await h.apply({ kind: 'DELETE', base: b });
  s = decodeTransfersSnapshot(h.snapshot(), workspace);
  assert.equal(s.movements.balance.movements.length, 0);
  b = transferBase(s, id(10));
  await h.apply({ kind: 'RESTORE', base: b });
  s = decodeTransfersSnapshot(h.snapshot(), workspace);
  assert.equal(s.movements.history.length, 6);
  assert.ok(
    s.movements.transactions.every(
      (s) => s.version === '3' && !s.content.deleted,
    ),
  );
});
test('broken and imported groups remain consultable without exposing legacy snapshots as editable content', async () => {
  const h = syntheticTransferHost();
  await h.apply(input(h));
  h.groups.get(id(10)).state = 'BROKEN';
  assert.equal(
    transferBase(decodeTransfersSnapshot(h.snapshot(), workspace), id(10)),
    null,
  );
  h.groups.get(id(10)).state = 'ACTIVE';
  h.states.get(id(11)).content.origin_kind = 'IMPORT';
  h.history[0].compatible = false;
  h.history[0].snapshot = null;
  assert.equal(
    transferBase(decodeTransfersSnapshot(h.snapshot(), workspace), id(10)),
    null,
  );
  assert.equal(
    new LocalTransferError('SYNTHETIC SQL').code,
    'STORAGE_UNAVAILABLE',
  );
  assert.doesNotMatch(
    localTransferMessage(Error('SYNTHETIC SQL')),
    /SYNTHETIC/,
  );
});
test('native corpus is reproducibly generated from the current guarded shared transfer service', () => {
  const r = spawnSync(
    process.execPath,
    ['infra/transfers-desktop/generate.mjs', '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0);
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us042-transfers.json'),
  );
  assert.equal(f.synthetic_only, true);
  assert.equal(f.vectors.length, 69);
  assert.ok(f.vectors.some((v) => v.expected.error === 'VERSION_CONFLICT'));
});
const evidence = (kind) =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-042-desktop-transfers-' +
        kind +
        '-2026-10-18-us047-associations.json',
    ),
  );
test('Desktop transfer evidence requires pair native crash restore cleanup and every UI gate', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateDesktopTransferEvidence(evidence(kind)).passed, true);
    for (const name of checks) {
      const r = evidence(kind);
      delete r.checks[name];
      assert.throws(() => validateDesktopTransferEvidence(r));
    }
  }
});
test('Desktop transfer evidence refuses stale code financial payloads premature cloud or human approval', () => {
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
    assert.throws(() => validateDesktopTransferEvidence(r));
  }
});
