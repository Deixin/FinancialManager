import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nativeChecks,
  validateAndroidReboot,
  validateAndroidLibraries,
  validateMobileReport,
} from './mobile-evidence.mjs';

test('Android SQLCipher runtime requires OpenSSL packaged for the same ABI', () => {
  const cipher = 'lib/x86_64/libexpo-sqlite.so';
  assert.throws(
    () => validateAndroidLibraries([cipher]),
    /SQLCIPHER_ANDROID_RUNTIME_MISSING/,
  );
  assert.throws(
    () => validateAndroidLibraries([cipher, 'lib/arm64-v8a/libcrypto.so']),
    /SQLCIPHER_ANDROID_RUNTIME_MISSING/,
  );
  validateAndroidLibraries([cipher, 'lib/x86_64/libcrypto.so']);
});

function report() {
  return {
    format_version: 1,
    synthetic_only: true,
    passed: true,
    phase: 'reopened',
    platform: 'android',
    cipher_version: '4.14.0 community',
    completed_at_utc: '2026-10-15T12:00:00.000Z',
    checks: Object.fromEntries(
      [...nativeChecks, 'key_recovered_after_process_restart'].map((key) => [
        key,
        true,
      ]),
    ),
  };
}

test('Mobile evidence rejects incomplete checks and a failed native run', () => {
  validateMobileReport(report(), 'reopened');
  for (const key of nativeChecks) {
    const candidate = report();
    delete candidate.checks[key];
    assert.throws(
      () => validateMobileReport(candidate, 'reopened'),
      /MOBILE_CHECK_MISSING/,
    );
  }
  assert.throws(
    () => validateMobileReport({ ...report(), passed: false }, 'reopened'),
    /MOBILE_REPORT_FAILED/,
  );
});

test('Mobile evidence distinguishes prepared, process restart, cleanup and a full Android reboot', () => {
  assert.throws(
    () => validateMobileReport(report(), 'cleaned'),
    /MOBILE_REPORT_FAILED/,
  );
  const candidate = report();
  delete candidate.checks.key_recovered_after_process_restart;
  assert.throws(
    () => validateMobileReport(candidate, 'reopened'),
    /MOBILE_CHECK_MISSING/,
  );
  assert.throws(() => validateAndroidReboot(2, 2), /ANDROID_REBOOT_NOT_PROVEN/);
  assert.throws(
    () => validateAndroidReboot(2, NaN),
    /ANDROID_REBOOT_NOT_PROVEN/,
  );
  validateAndroidReboot(2, 3);
});
