import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { backupHashes } from '../local-backup/evidence.mjs';
export const browserChecks = Object.freeze([
  'preview_requires_native_without_browser_persistence',
  'picker_locks_pin_and_original_secret_policy',
  'wrong_secret_clears_fields_without_publication',
  'verified_preview_counts_ack_and_new_local_workspace',
  'canceled_preview_and_late_reply_discarded',
  'lost_ack_retries_same_restore_without_duplicate',
  'accessible_responsive_forced_colors',
  'no_storage_egress_or_runtime_errors',
]);
export const nativeChecks = Object.freeze([
  'locked_fmt_clippy_fourteen_restore_tests',
  'default_without_restore_probe_or_wide_permissions',
  'independent_installation_new_ids_key_generation',
  'preview_unpublished_and_source_preserved',
  'wrong_password_tampered_and_unsupported_fail_closed',
  'replay_idempotent_after_restart',
  'crash_after_staging_recovers_key',
  'crash_before_publish_recovers_without_new_workspace',
  'crash_after_publish_has_complete_new_workspace',
  'webview_picker_policy_and_reauthentication',
  'webview_invalid_secret_preserves_existing',
  'webview_verified_preview_counts_and_no_publication',
  'webview_confirmed_restore_opens_new_local_workspace',
  'webview_canceled_preview_removes_stage',
  'webview_no_storage_or_egress',
  'webview_restored_graph_verified',
  'owned_keys_policy_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'expanded-schema-future-entities-and-outbox-integration',
  'signed-release-other-platforms-and-power-loss-filesystems',
]);
export const restoreHashes = () => ({
  ...backupHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src-tauri/src/local_restore.rs',
      'apps/desktop/src-tauri/src/restore_source.rs',
      'apps/desktop/src-tauri/src/restore_probe.rs',
      'apps/desktop/src-tauri/src/bin/restore-probe.rs',
      'apps/desktop/src-tauri/src/bin/restore-smoke.rs',
      'apps/desktop/src-tauri/tests/local_restore.rs',
      'apps/desktop/src-tauri/restore-smoke.js',
      'apps/desktop/src/local-restore.ts',
      'apps/desktop/src/local-restore-flow.tsx',
      'infra/local-restore/evidence.mjs',
      'infra/local-restore/native.mjs',
      'infra/local-restore/browser.mjs',
      'infra/scripts/local-restore.test.mjs',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateRestoreEvidence(report, { matchSources = true } = {}) {
  const exact = (value, keys) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const fail = () => {
    throw Error('LOCAL_RESTORE_EVIDENCE_INVALID');
  };
  const native = report?.scope === 'us035-restore-windows',
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
    report.format_version !== 1 ||
    !['us035-restore-windows', 'us035-restore-browser'].includes(
      report.scope,
    ) ||
    report.passed !== true ||
    report.synthetic_only !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, checks) ||
    checks.some((name) => report.checks[name] !== true) ||
    JSON.stringify(report.pending) !== JSON.stringify(pending) ||
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
  const hashes = restoreHashes(),
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
