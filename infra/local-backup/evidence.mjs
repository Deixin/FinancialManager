import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lockHashes } from '../local-lock/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_backup_entry_and_clear_policy',
  'recovery_password_confirmation_and_acknowledgement',
  'owned_dialog_hides_data_and_clears_passwords',
  'verified_success_and_cancellation_keep_pin_locked',
  'sanitized_error_and_late_reply_after_cancel',
  'accessible_responsive_and_forced_colors',
  'no_storage_egress_or_runtime_errors',
]);
export const nativeChecks = Object.freeze([
  'locked_fmt_clippy_and_nine_backup_tests',
  'default_without_probe_or_wide_permissions',
  'authenticated_versioned_manifest_and_full_state',
  'independent_process_verification_without_device_key',
  'wrong_password_and_tampering_preserve_source',
  'crash_snapshot_recovers_encrypted_staging',
  'crash_before_publication_has_no_final_package',
  'crash_after_publication_has_complete_package',
  'webview_backup_form_policy_and_validation',
  'webview_ipc_export_hides_financial_tree',
  'webview_verified_notice_keeps_pin_locked',
  'webview_chooser_cancel_preserves_closed_state',
  'webview_sanitized_destination_error',
  'webview_no_storage_or_egress',
  'webview_package_validated_and_source_unchanged',
  'owned_keys_policy_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'expanded-schema-future-entities-and-outbox-integration',
  'signed-release-other-platforms-and-power-loss-filesystems',
]);
const legacyPending = [
  pending[0],
  'product-restore-as-new-workspace-us035',
  ...pending.slice(1),
];
export const backupHashes = () => ({
  ...lockHashes(),
  ...Object.fromEntries(
    [
      ...[
        'local_backup.rs',
        'backup_destination.rs',
        'backup_probe.rs',
        'bin/backup-probe.rs',
        'bin/backup-smoke.rs',
      ].map((name) => 'apps/desktop/src-tauri/src/' + name),
      'apps/desktop/src-tauri/tests/local_backup.rs',
      'apps/desktop/src-tauri/backup-smoke.js',
      'apps/desktop/src/local-backup.ts',
      'apps/desktop/src/local-backup-flow.tsx',
      ...['native.mjs', 'browser.mjs', 'evidence.mjs'].map(
        (name) => 'infra/local-backup/' + name,
      ),
      'infra/scripts/local-backup.test.mjs',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateBackupEvidence(report, { matchSources = true } = {}) {
  const exact = (value, keys) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const fail = () => {
    throw Error('LOCAL_BACKUP_EVIDENCE_INVALID');
  };
  const native = report?.scope === 'us034-backup-windows',
    checks = native ? nativeChecks : browserChecks;
  if (
    !exact(report, [
      'format_version',
      'scope',
      'passed',
      'synthetic_only',
      'checks',
      'versions',
      'pending',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
    ]) ||
    (report.format_version !== 2 &&
      !(report.format_version === 1 && !matchSources)) ||
    !['us034-backup-windows', 'us034-backup-browser'].includes(report.scope) ||
    report.passed !== true ||
    report.synthetic_only !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, checks) ||
    checks.some((name) => report.checks[name] !== true) ||
    JSON.stringify(report.pending) !==
      JSON.stringify(report.format_version === 1 ? legacyPending : pending) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    new Date(report.completed_at_utc).toISOString() !== report.completed_at_utc
  )
    fail();
  if (
    native
      ? !exact(report.versions, [
          'node',
          'rust',
          'tauri',
          'platform',
          'aes_gcm',
          'argon2',
        ]) ||
        !/^24\./.test(report.versions.node) ||
        !/^rustc 1\.99\.0/.test(report.versions.rust) ||
        report.versions.tauri !== '2.12.3' ||
        report.versions.platform !== 'win32-x64' ||
        report.versions.aes_gcm !== '0.11.1' ||
        report.versions.argon2 !== '0.6.0'
      : !exact(report.versions, ['node', 'chromium']) ||
        !/^24\./.test(report.versions.node) ||
        !/^\d+\.\d+\.\d+\.\d+$/.test(report.versions.chromium)
  )
    fail();
  const hashes = backupHashes(),
    files = Object.keys(hashes);
  if (
    !exact(report.source_sha256, files) ||
    files.some((name) =>
      matchSources
        ? report.source_sha256[name] !== hashes[name]
        : !/^[a-f0-9]{64}$/.test(report.source_sha256[name]),
    )
  )
    fail();
  return report;
}
