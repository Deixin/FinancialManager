import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { canonicalFixture as fixture } from '../../packages/test-fixtures/dist/canonical.js';
import {
  decodeAccountsSnapshot,
  createLocalAccountsGateway,
  parseBrlMinor,
  formatBrlMinor,
  accountRows,
  captureLocalAccountChange,
  decodeAccountResult,
  LocalAccountsError,
  localAccountsMessage,
} from '../../apps/desktop/dist/local-accounts.js';
import { syntheticSnapshot } from '../accounts-desktop/fixture.mjs';
import {
  browserChecks,
  nativeChecks,
  validateDesktopAccountEvidence,
} from '../accounts-desktop/evidence.mjs';
const workspace = fixture.workspace_a;
const id = (n) => '0199d040-0000-7000-8000-' + String(n).padStart(12, '0');
test('Desktop account gateway requires Tauri and monetary fields preserve i64 precision through BRL input and presentation', () => {
  assert.equal(createLocalAccountsGateway(), null);
  for (const [input, minor] of [
    ['1000,00', '100000'],
    ['0,01', '1'],
    ['-0,00', '0'],
    ['90071992547409,93', '9007199254740993'],
    ['92233720368547758,07', '9223372036854775807'],
    ['-92233720368547758,08', '-9223372036854775808'],
  ]) {
    assert.equal(parseBrlMinor(input), minor);
    assert.equal(
      parseBrlMinor(
        formatBrlMinor(minor).replace('R$ ', '').replaceAll('.', ''),
      ),
      minor,
    );
  }
  for (const value of [
    '1.000,00',
    '1.0',
    '1e2',
    ',5',
    'NaN',
    '92233720368547758,08',
    '9'.repeat(10000),
  ])
    assert.throws(() => parseBrlMinor(value));
});
test('native account snapshots reject private fields, mixed scopes, floats and unsupported or duplicate resource projections', () => {
  const value = decodeAccountsSnapshot(syntheticSnapshot(), workspace);
  assert.ok(
    Object.isFrozen(value) &&
      Object.isFrozen(value.accounts) &&
      Object.isFrozen(value.movements),
  );
  for (const mutate of [
    (r) => (r.path = 'SYNTHETIC_PRIVATE'),
    (r) => (r.workspace_id = fixture.workspace_b),
    (r) => (r.read_at = 'invalid'),
    (r) => r.accounts.push(r.accounts[0]),
    (r) => (r.accounts[0].account.currency_code = 'USD'),
    (r) => (r.accounts[0].references[0].amount_minor = 1),
    (r) => (r.movements[0].account_amount_minor = 1.5),
    (r) => (r.movements[0].workspace_id = fixture.workspace_b),
    (r) => (r.movements[0].account_id = id(999)),
    (r) => (r.movements[0].posting_state = 'STAGING'),
    (r) => r.movements.push(r.movements[0]),
  ]) {
    const raw = syntheticSnapshot();
    mutate(raw);
    assert.throws(
      () => decodeAccountsSnapshot(raw, workspace),
      (e) =>
        e instanceof LocalAccountsError &&
        e.code === 'INVALID_RESPONSE' &&
        !e.message.includes('PRIVATE'),
    );
  }
});
test('Desktop balance projection matches all seven original goldens, keeps debt signs and never declares unknown history complete', () => {
  for (const expected of fixture.expected.balances) {
    const snapshot = decodeAccountsSnapshot(
        syntheticSnapshot(expected.workspace_id),
        expected.workspace_id,
      ),
      row = accountRows(snapshot, expected.as_of).find(
        (r) => r.state.account.id === expected.account_id,
      );
    assert.equal(row.value.balance.amount_minor, expected.amount_minor);
    assert.equal(row.value.balance.completeness, 'INCOMPLETE');
    assert.ok(row.value.balance.warnings.includes('UNKNOWN_HISTORY'));
  }
});
test('account acknowledgement is bound to the captured account and reference, and exposes no native error payloads', () => {
  const input = captureLocalAccountChange(
    {
      kind: 'CREATE',
      account: {
        id: id(2),
        name: 'SYNTHETIC ACK',
        institution_name: null,
        account_kind: 'CASH',
        balance_nature: 'ASSET',
        currency_code: 'BRL',
      },
      reference: null,
    },
    workspace,
  );
  assert.ok(Object.isFrozen(input) && Object.isFrozen(input.account));
  assert.equal(
    decodeAccountResult(
      { changed: true, account_id: id(2), reference_id: null },
      input,
    ).changed,
    true,
  );
  for (const reply of [
    { changed: true, account_id: id(3), reference_id: null },
    { changed: 'true', account_id: id(2), reference_id: null },
    { changed: true, account_id: id(2), reference_id: id(4) },
    {
      changed: true,
      account_id: id(2),
      reference_id: null,
      path: 'SYNTHETIC_PRIVATE',
    },
  ])
    assert.throws(() => decodeAccountResult(reply, input));
  assert.equal(
    localAccountsMessage(new Error('SYNTHETIC_PRIVATE_SQL')),
    localAccountsMessage(null),
  );
  assert.equal(
    new LocalAccountsError('SYNTHETIC_PRIVATE').code,
    'STORAGE_UNAVAILABLE',
  );
});
test('shared/native command parity vectors are generated from the current production Domain and stay synthetic', () => {
  const output = spawnSync(
    process.execPath,
    ['infra/accounts-desktop/generate.mjs', '--check'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(output.status, 0);
  const vectors = JSON.parse(
    readFileSync(
      new URL(
        '../../apps/desktop/src-tauri/fixtures/us040-accounts.json',
        import.meta.url,
      ),
    ),
  );
  assert.equal(vectors.synthetic_only, true);
  assert.equal(vectors.vectors.length, 62);
  assert.ok(vectors.vectors.some((v) => v.name === 'preserve_legacy_archive'));
});
test('overflowing a displayed balance never becomes zero, a partial total or a render failure for other accounts', () => {
  const raw = syntheticSnapshot(),
    bank = raw.accounts.find((s) => s.account.account_kind === 'CHECKING');
  bank.references[0].amount_minor = '9223372036854775807';
  const snapshot = decodeAccountsSnapshot(raw, workspace),
    rows = accountRows(snapshot, '2026-09-30');
  assert.equal(
    rows.find((r) => r.state.account.id === bank.account.id).value,
    null,
  );
  assert.ok(
    rows.find((r) => r.state.account.account_kind === 'CREDIT_CARD').value,
  );
});
const evidence = (kind) =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-040-desktop-accounts-' +
          kind +
          '-2026-10-18-us042-desktop.json',
        import.meta.url,
      ),
    ),
  );
test('Desktop account evidence requires every behavioral, independent native, crash, restore and cleanup gate', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateDesktopAccountEvidence(evidence(kind)).passed, true);
    for (const gate of checks) {
      const report = evidence(kind);
      delete report.checks[gate];
      assert.throws(
        () => validateDesktopAccountEvidence(report),
        /DESKTOP_ACCOUNT_EVIDENCE_INVALID/,
      );
    }
  }
});
test('Desktop account evidence rejects stale sources, financial payloads, premature human approval and invented cloud integration', () => {
  for (const mutate of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) => (r.source_sha256['package.json'] = '0'.repeat(64)),
    (r) => (r.account_name = 'SYNTHETIC_PRIVATE'),
    (r) => (r.checks.cloud_complete = true),
    (r) => (r.completed_at_utc = 'invalid'),
    (r) => (r.versions.tauri = '0.0.0'),
  ]) {
    const report = evidence('windows');
    mutate(report);
    assert.throws(
      () => validateDesktopAccountEvidence(report),
      /DESKTOP_ACCOUNT_EVIDENCE_INVALID/,
    );
  }
  const report = evidence('windows');
  report.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateDesktopAccountEvidence(report, { matchSources: false }).passed,
    true,
  );
});
