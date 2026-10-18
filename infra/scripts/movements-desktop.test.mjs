/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { syntheticHost, workspace, id } from '../movements-desktop/fixture.mjs';
import {
  captureLocalManualMovement,
  decodeMovementsSnapshot,
  decodeMovementResult,
  createLocalMovementsGateway,
  movementAccount,
  editableMinor,
  canEditMovement,
  canToggleMovement,
  localMovementMessage,
  LocalMovementError,
} from '../../apps/desktop/dist/local-movements.js';
import { accountRows } from '../../apps/desktop/dist/local-accounts.js';
import {
  browserChecks,
  nativeChecks,
  validateMovementEvidence,
} from '../movements-desktop/evidence.mjs';
const input = (h) => ({
  kind: 'CREATE',
  id: id(10),
  account: movementAccount(h.accounts[0].account),
  financial_date: '2026-10-17',
  amount_minor: '9007199254740993',
  movement_kind: 'INCOME',
  display_name: 'SYNTHETIC US041',
  original_description: null,
});
test('movement gateway requires native host and captures immutable narrow commands', () => {
  assert.equal(createLocalMovementsGateway(), null);
  const h = syntheticHost(),
    raw = input(h),
    captured = captureLocalManualMovement(raw, workspace);
  raw.display_name = 'SYNTHETIC CHANGED';
  assert.equal(captured.display_name, 'SYNTHETIC US041');
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.account));
  for (const modify of [
    (v) => (v.actor = 'SYNTHETIC'),
    (v) => (v.amount_minor = 1),
    (v) => (v.amount_minor = '-1'),
    (v) => (v.id = '00000000-0000-4000-8000-000000000000'),
    (v) => delete v.original_description,
  ]) {
    const v = input(h);
    modify(v);
    assert.throws(() => captureLocalManualMovement(v, workspace));
  }
});
test('snapshot validates transaction balance and history as one scoped read', async () => {
  const h = syntheticHost();
  await h.apply(input(h));
  const value = decodeMovementsSnapshot(h.snapshot(), workspace);
  assert.ok(
    Object.isFrozen(value) && Object.isFrozen(value.transactions[0].content),
  );
  assert.equal(
    value.transactions[0].content.account_amount_minor,
    '9007199254740993',
  );
  for (const modify of [
    (v) => (v.path = 'SYNTHETIC'),
    (v) => v.balance.movements.pop(),
    (v) => (v.transactions[0].content.account_amount_minor = '1'),
    (v) => v.transactions.push(v.transactions[0]),
    (v) => (v.history[0].transaction_id = id(99)),
    (v) => (v.history[0].version = '2'),
    (v) => v.history.push(v.history[0]),
    (v) => (v.history[0].snapshot.after.workspace_id = id(90)),
  ]) {
    const v = h.snapshot();
    modify(v);
    assert.throws(
      () => decodeMovementsSnapshot(v, workspace),
      (e) => e.code === 'INVALID_RESPONSE',
    );
  }
});
test('manual result binds ID base next version and native revision identity', async () => {
  const h = syntheticHost(),
    c = captureLocalManualMovement(input(h), workspace),
    r = await h.apply(c);
  assert.equal(decodeMovementResult(r, c).version, '1');
  for (const delta of [
    { id: id(99) },
    { version: '2' },
    { base_revision: '1' },
    { revision_id: null },
    { changed: false },
  ])
    assert.throws(() => decodeMovementResult({ ...r, ...delta }, c));
});
test('deleted records stay in history while dropping balance and restoration advances revision', async () => {
  const h = syntheticHost(),
    c = { ...input(h), amount_minor: '500' };
  await h.apply(c);
  const b = structuredClone(h.states.get(c.id));
  await h.apply({ kind: 'DELETE', base: b });
  let s = decodeMovementsSnapshot(h.snapshot(), workspace);
  assert.equal(s.balance.movements.length, 0);
  assert.equal(s.transactions.length, 1);
  assert.equal(s.history.length, 2);
  assert.equal(
    accountRows(s.balance, '2026-10-17')[0].value.balance.amount_minor,
    '100000',
  );
  await assert.rejects(
    h.apply({ kind: 'RESTORE', base: b }),
    (e) => e.code === 'VERSION_CONFLICT',
  );
  await h.apply({ kind: 'RESTORE', base: h.states.get(c.id) });
  s = decodeMovementsSnapshot(h.snapshot(), workspace);
  assert.equal(s.transactions[0].version, '3');
  assert.equal(s.balance.movements.length, 1);
});
test('legacy revisions remain uninterpreted and unrelated origins cannot enter the manual editor', async () => {
  const h = syntheticHost();
  await h.apply(input(h));
  const s = h.states.get(id(10));
  assert.equal(canEditMovement(s), true);
  s.content.origin_kind = 'IMPORT';
  assert.equal(canEditMovement(s), false);
  assert.equal(canToggleMovement(s), false);
  h.history[0].compatible = false;
  h.history[0].snapshot = null;
  assert.equal(
    decodeMovementsSnapshot(h.snapshot(), workspace).history[0].snapshot,
    null,
  );
  h.history[0].snapshot = { secret: 'SYNTHETIC' };
  assert.throws(() => decodeMovementsSnapshot(h.snapshot(), workspace));
  assert.equal(editableMinor('-9223372036854775808'), '-92233720368547758,08');
  assert.equal(
    new LocalMovementError('SYNTHETIC SQL PRIVATE').code,
    'STORAGE_UNAVAILABLE',
  );
  assert.doesNotMatch(
    localMovementMessage(new Error('SYNTHETIC SQL PRIVATE')),
    /SYNTHETIC/,
  );
});
test('all 80 native plans are regenerated from current shared policies', () => {
  const r = spawnSync(
    process.execPath,
    ['infra/movements-desktop/generate.mjs', '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0);
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us041-movements.json'),
  );
  assert.equal(f.synthetic_only, true);
  assert.equal(f.vectors.length, 80);
  assert.ok(f.vectors.some((v) => v.expected.error === 'VERSION_CONFLICT'));
});
const evidence = (kind) =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-041-desktop-movements-' +
        kind +
        '-2026-10-18-us045-classification.json',
    ),
  );
test('movement evidence requires actual UI native crash restore and cleanup gates', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateMovementEvidence(evidence(kind)).passed, true);
    for (const name of checks) {
      const r = evidence(kind);
      delete r.checks[name];
      assert.throws(() => validateMovementEvidence(r));
    }
  }
});
test('movement evidence rejects stale sources private payload and premature human signoff', () => {
  for (const mutate of [
    (r) => (r.resources_closed = false),
    (r) => (r.pending = []),
    (r) => (r.source_sha256['package.json'] = '0'.repeat(64)),
    (r) => (r.transaction = 'SYNTHETIC PRIVATE'),
    (r) => (r.checks.human_approved = true),
    (r) => (r.completed_at_utc = 'invalid'),
    (r) => (r.versions.tauri = '0'),
  ]) {
    const r = evidence('windows');
    mutate(r);
    assert.throws(() => validateMovementEvidence(r));
  }
  const r = evidence('windows');
  r.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateMovementEvidence(r, { matchSources: false }).passed,
    true,
  );
});
