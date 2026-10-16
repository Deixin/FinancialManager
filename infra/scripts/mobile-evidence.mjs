export const nativeChecks = [
  'secure_store',
  'missing_key_rejected',
  'wrong_key_rejected',
  'unkeyed_database_rejected',
  'workspace_key_isolation',
  'workspace_query_isolation',
  'foreign_key_isolation',
  'ciphertext_header',
  'tampering_rejected',
  'existing_database_preserved',
  'migration_rollback',
  'write_rollback',
  'int64_integer_storage',
  'int64_exact_roundtrip',
  'json_decimal_strings',
  'invalid_money_rejected',
  'database_integrity',
];

export function validateMobileReport(report, phase) {
  if (
    report?.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.phase !== phase
  ) {
    throw new Error('MOBILE_REPORT_FAILED');
  }
  if (
    !['android', 'ios'].includes(report.platform) ||
    typeof report.cipher_version !== 'string' ||
    !/^4\.[0-9]+\.[0-9]+/.test(report.cipher_version)
  ) {
    throw new Error('NATIVE_SQLCIPHER_REQUIRED');
  }
  if (!Number.isFinite(Date.parse(report.completed_at_utc)))
    throw new Error('MOBILE_REPORT_DATE_INVALID');
  const checks = [...nativeChecks];
  if (phase !== 'prepared') checks.push('key_recovered_after_process_restart');
  if (phase === 'cleaned') checks.push('synthetic_artifacts_removed');
  if (checks.some((name) => report.checks?.[name] !== true))
    throw new Error('MOBILE_CHECK_MISSING');
}

export function validateAndroidReboot(before, after) {
  if (
    !Number.isInteger(before) ||
    !Number.isInteger(after) ||
    after <= before
  ) {
    throw new Error('ANDROID_REBOOT_NOT_PROVEN');
  }
}

export function validateAndroidLibraries(entries) {
  for (const library of ['libexpo-sqlite.so', 'libcrypto.so']) {
    if (!entries.includes('lib/x86_64/' + library)) {
      throw new Error('SQLCIPHER_ANDROID_RUNTIME_MISSING');
    }
  }
}
