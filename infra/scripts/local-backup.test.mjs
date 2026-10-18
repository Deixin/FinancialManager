import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  decodeBackupResult,
  validRecoveryPassword,
  createBackupGateway,
  LocalBackupError,
  backupMessage,
} from '../../apps/desktop/dist/local-backup.js';
import {
  browserChecks,
  nativeChecks,
  validateBackupEvidence,
} from '../local-backup/evidence.mjs';
const load = (kind) =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-034-backup-' +
          kind +
          '-2026-10-18-us042-desktop.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('backup response accepts only verified creation or cancellation without native paths, keys or manifest', () => {
  const valid = { outcome: 'CREATED', created_at: '2026-10-17T12:34:56.000Z' };
  assert.ok(Object.isFrozen(decodeBackupResult(valid)));
  assert.equal(
    decodeBackupResult({ outcome: 'CANCELED', created_at: null }).outcome,
    'CANCELED',
  );
  assert.equal(createBackupGateway(), null);
  for (const patch of [
    { outcome: 'STARTED' },
    { created_at: null },
    { created_at: '2026-02-30T00:00:00.000Z' },
    { created_at: '2026-10-17' },
    { path: 'SYNTHETIC_PRIVATE_PATH' },
    { key: 'SYNTHETIC_PRIVATE_KEY' },
    { manifest: {} },
    { outcome: 'CANCELED' },
  ])
    assert.throws(
      () => decodeBackupResult({ ...valid, ...patch }),
      /LOCAL_BACKUP_OPERATION_FAILED/,
    );
});
test('recovery secret validates Unicode code points without silent normalization or accepting controls', () => {
  assert.ok(validRecoveryPassword('SYNTHETIC password'));
  assert.ok(validRecoveryPassword('á'.repeat(12)));
  assert.ok(validRecoveryPassword('😀'.repeat(128)));
  assert.ok(validRecoveryPassword('  SYNTHETIC password  '));
  for (const value of [
    'short',
    ' '.repeat(12),
    '😀'.repeat(6),
    'x'.repeat(129),
    'SYNTHETIC\npassword',
    'SYNTHETIC\u0000password',
  ])
    assert.equal(validRecoveryPassword(value), false);
});
test('backup failures never disclose SQL, paths, secret payloads or claim successful publication', () => {
  assert.equal(
    backupMessage(new Error('SYNTHETIC_PRIVATE_PATH_OR_PASSWORD')),
    backupMessage(null),
  );
  for (const code of [
    'INVALID_BACKUP_PASSWORD',
    'BACKUP_LIMIT',
    'BACKUP_ALREADY_EXISTS',
    'BACKUP_DESTINATION_UNAVAILABLE',
    'LOCAL_LOCKED',
  ])
    assert.ok(
      !backupMessage(new LocalBackupError(code)).includes('SYNTHETIC_PRIVATE'),
    );
  assert.match(
    backupMessage(new LocalBackupError('BACKUP_ALREADY_EXISTS')),
    /preservado/,
  );
  assert.match(backupMessage(null), /não o considere confirmado/);
});
test('backup evidence requires every real crypto, crash, GUI, accessibility and cleanup gate', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateBackupEvidence(load(kind)).passed, true);
    for (const gate of checks) {
      const report = load(kind);
      delete report.checks[gate];
      assert.throws(
        () => validateBackupEvidence(report),
        /LOCAL_BACKUP_EVIDENCE_INVALID/,
      );
    }
  }
});
test('backup evidence rejects stale sources, secret fields, missing deferred human validation and false restore claims', () => {
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.password = 'SYNTHETIC PRIVATE';
    },
    (r) => {
      r.versions.aes_gcm = 'unknown';
    },
    (r) => {
      r.completed_at_utc = 'invalid';
    },
    (r) => {
      r.checks.product_restore_complete = true;
    },
  ]) {
    const report = load('windows');
    mutate(report);
    assert.throws(
      () => validateBackupEvidence(report),
      /LOCAL_BACKUP_EVIDENCE_INVALID/,
    );
  }
  const report = load('windows');
  report.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateBackupEvidence(report, { matchSources: false }).passed,
    true,
  );
});
