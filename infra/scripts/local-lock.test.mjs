import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  decodeLockStatus,
  createPrivacyGateway,
  LocalPrivacyError,
  privacyMessage,
  helloAvailabilityMessage,
} from '../../apps/desktop/dist/local-privacy.js';
import {
  browserChecks,
  nativeChecks,
  validateLockEvidence,
} from '../local-lock/evidence.mjs';
const load = (kind) =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-033-lock-' +
          kind +
          '-2026-10-18-us045-taxonomy-desktop.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('local privacy status decoder rejects unknown secrets, unsupported biometrics and inconsistent authority', () => {
  const valid = {
    enabled: true,
    locked: true,
    retry_after_seconds: 0,
    hello_enabled: false,
    hello_availability: 'UNAVAILABLE',
  };
  assert.ok(Object.isFrozen(decodeLockStatus(valid)));
  for (const change of [
    { pin: 'SYNTHETIC_PRIVATE' },
    { hash: 'secret' },
    { enabled: 'true' },
    { enabled: false },
    { retry_after_seconds: -1 },
    { retry_after_seconds: 31 },
    { retry_after_seconds: 0.5 },
    { hello_availability: 'VERIFIED' },
    { hello_enabled: 'true' },
    { enabled: false, locked: false, hello_enabled: true },
  ])
    assert.throws(
      () => decodeLockStatus({ ...valid, ...change }),
      /LOCAL_PRIVACY_OPERATION_FAILED/,
    );
  assert.equal(createPrivacyGateway(), null);
  for (const availability of [
    'AVAILABLE',
    'UNAVAILABLE',
    'NOT_CONFIGURED',
    'DISABLED_BY_POLICY',
    'DEVICE_BUSY',
  ]) {
    assert.equal(
      decodeLockStatus({ ...valid, hello_availability: availability })
        .hello_availability,
      availability,
    );
    assert.match(helloAvailabilityMessage(availability), /Windows Hello/);
  }
  for (const code of ['HELLO_CANCELED', 'HELLO_FAILED', 'HELLO_UNAVAILABLE'])
    assert.match(privacyMessage(new LocalPrivacyError(code)), /Windows Hello/);
});
test('historical PIN and Hello reports cannot claim the current backup permission scope', () => {
  for (const kind of ['browser', 'windows']) {
    for (const suffix of ['', '-hello', '-us034']) {
      const report = JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-033-lock-' +
              kind +
              '-2026-10-17' +
              suffix +
              '.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      assert.equal(
        validateLockEvidence(report, { matchSources: false }).passed,
        true,
      );
      assert.throws(
        () => validateLockEvidence(report),
        /LOCAL_LOCK_EVIDENCE_INVALID/,
      );
      report.checks.undeclared_current_backup_gate = true;
      assert.throws(
        () => validateLockEvidence(report, { matchSources: false }),
        /LOCAL_LOCK_EVIDENCE_INVALID/,
      );
    }
  }
});
test('privacy errors never disclose native payloads or treat failed authentication as loss of the vault', () => {
  assert.equal(
    privacyMessage(new Error('SYNTHETIC_PIN_OR_SQL')),
    privacyMessage(null),
  );
  assert.ok(
    !privacyMessage(new Error('SYNTHETIC_PIN_OR_SQL')).includes('SYNTHETIC'),
  );
  assert.match(
    privacyMessage(new LocalPrivacyError('AUTHENTICATION_FAILED')),
    /preservados/,
  );
  assert.match(
    privacyMessage(new LocalPrivacyError('RETRY_LATER')),
    /30 segundos/,
  );
});
test('local lock evidence requires every browser and native authentication, race, crash and cleanup gate', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateLockEvidence(load(kind)).passed, true);
    for (const name of checks) {
      const report = load(kind);
      delete report.checks[name];
      assert.throws(
        () => validateLockEvidence(report),
        /LOCAL_LOCK_EVIDENCE_INVALID/,
      );
    }
  }
});
test('lock evidence refuses stale sources, incomplete policy scope, secret fields and unsupported native claims', () => {
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
      r.synthetic_only = false;
    },
    (r) => {
      r.secret = 'SYNTHETIC_PRIVATE_PIN';
    },
    (r) => {
      r.versions.argon2 = '0';
    },
    (r) => {
      r.completed_at_utc = 'invalid';
    },
  ]) {
    const r = load('windows');
    mutate(r);
    assert.throws(() => validateLockEvidence(r), /LOCAL_LOCK_EVIDENCE_INVALID/);
  }
  const r = load('windows');
  r.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(validateLockEvidence(r, { matchSources: false }).passed, true);
  r.source_sha256['package.json'] = 'invalid';
  assert.throws(
    () => validateLockEvidence(r, { matchSources: false }),
    /LOCAL_LOCK_EVIDENCE_INVALID/,
  );
});
