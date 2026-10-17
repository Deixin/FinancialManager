import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  decodeSelection,
  decodeRestorePreview,
  createRestoreGateway,
  restoreMessage,
  LocalRestoreError,
  restoreTables,
} from '../../apps/desktop/dist/local-restore.js';
import {
  browserChecks,
  nativeChecks,
  validateRestoreEvidence,
} from '../local-restore/evidence.mjs';
const load = (kind) =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-035-restore-' +
          kind +
          '-2026-10-17-us040-desktop.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
const preview = () => ({
  restore_id: '0199d035-0000-7000-8000-000000000002',
  source_name: 'SYNTHETIC source',
  display_name: 'SYNTHETIC source (restaurado)',
  purpose: 'PERSONAL',
  backup_created_at: '2026-10-17T12:00:00.000Z',
  record_counts: Object.fromEntries(
    restoreTables.map((name) => [name, name === 'workspace' ? '1' : '0']),
  ),
});
test('restore contracts accept only opaque selection and verified metadata without paths, keys, secrets or payloads', () => {
  assert.equal(createRestoreGateway(), null);
  assert.equal(decodeSelection({ selection_id: null }), null);
  assert.equal(
    decodeSelection({ selection_id: preview().restore_id }),
    preview().restore_id,
  );
  for (const value of [
    { selection_id: 'SYNTHETIC_PATH' },
    { selection_id: null, path: 'private' },
    { key: 'secret' },
    null,
  ])
    assert.throws(
      () => decodeSelection(value),
      /LOCAL_RESTORE_OPERATION_FAILED/,
    );
  const valid = decodeRestorePreview(preview());
  assert.ok(Object.isFrozen(valid) && Object.isFrozen(valid.record_counts));
  for (const patch of [
    { path: 'SYNTHETIC_PRIVATE' },
    { password: 'SYNTHETIC_SECRET' },
    { workspace_id: 'OLD_AUTHORITY' },
    { restore_id: 'invalid' },
    { source_name: '' },
    { display_name: 'x'.repeat(121) },
    { purpose: 'CLOUD' },
    { backup_created_at: '2026-02-30T00:00:00.000Z' },
    { record_counts: {} },
  ])
    assert.throws(
      () => decodeRestorePreview({ ...preview(), ...patch }),
      /LOCAL_RESTORE_OPERATION_FAILED/,
    );
});
test('preview counts use canonical integer strings and cannot masquerade as money, fractional counts or multiple authorities', () => {
  for (const count of [1, 1.5, '01', '-1', '1.5', '9223372036854775808']) {
    const p = preview();
    p.record_counts.financial_account = count;
    assert.throws(
      () => decodeRestorePreview(p),
      /LOCAL_RESTORE_OPERATION_FAILED/,
    );
  }
  const p = preview();
  p.record_counts.workspace = '2';
  assert.throws(
    () => decodeRestorePreview(p),
    /LOCAL_RESTORE_OPERATION_FAILED/,
  );
});
test('restore errors preserve existing workspaces and never expose private native payloads or claim success', () => {
  assert.equal(
    restoreMessage(new Error('SYNTHETIC_SQL_OR_SECRET')),
    restoreMessage(null),
  );
  for (const code of [
    'BACKUP_AUTHENTICATION_FAILED',
    'UNSUPPORTED_BACKUP',
    'UNSUPPORTED_SCHEMA',
    'INVALID_BACKUP_PASSWORD',
    'LOCAL_LOCKED',
  ])
    assert.ok(
      !restoreMessage(new LocalRestoreError(code)).includes('SYNTHETIC_SQL'),
    );
  assert.match(
    restoreMessage(new LocalRestoreError('BACKUP_AUTHENTICATION_FAILED')),
    /Nenhum espaço existente foi alterado/,
  );
  assert.match(restoreMessage(null), /repetir a confirmação da mesma prévia/);
});
test('restore evidence requires every portable crypto, identity, graph, race, crash, WebView and cleanup gate', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateRestoreEvidence(load(kind)).passed, true);
    for (const gate of checks) {
      const r = load(kind);
      delete r.checks[gate];
      assert.throws(
        () => validateRestoreEvidence(r),
        /LOCAL_RESTORE_EVIDENCE_INVALID/,
      );
    }
  }
});
test('restore evidence rejects stale sources, financial payloads, missing human deferral and invented complete-system claims', () => {
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.secret = 'SYNTHETIC_SECRET';
    },
    (r) => {
      r.checks.human_full_system_approved = true;
    },
    (r) => {
      r.versions.platform = 'unsupported';
    },
    (r) => {
      r.completed_at_utc = 'invalid';
    },
  ]) {
    const r = load('windows');
    mutate(r);
    assert.throws(
      () => validateRestoreEvidence(r),
      /LOCAL_RESTORE_EVIDENCE_INVALID/,
    );
  }
  const r = load('windows');
  r.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateRestoreEvidence(r, { matchSources: false }).passed,
    true,
  );
});
