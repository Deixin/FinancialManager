import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { vaultHashes } from '../vault/evidence.mjs';
export const browserChecks = Object.freeze([
  'preview_has_no_privacy_persistence',
  'optional_default_and_clear_policy',
  'enable_change_disable_clear_pins',
  'manual_lock_and_exit_hide_workspace',
  'wrong_pin_and_throttle_preserve_closed_view',
  'late_unlock_reply_after_blur_discarded',
  'accessible_locked_settings_and_responsive',
  'no_storage_egress_or_errors',
  'hello_opt_in_and_os_pin_policy',
  'hello_cancellation_and_pin_fallback',
  'hello_late_success_after_explicit_cancel_discarded',
]);
export const nativeChecks = Object.freeze([
  'rustfmt_clippy_seventeen_privacy_tests',
  'locked_build_without_default_probe',
  'os_policy_not_plaintext_and_financial_state_preserved',
  'locked_commands_and_wrong_pin_preserve_ciphertext',
  'restart_requires_pin',
  'change_disable_requires_current_pin',
  'enable_crash_before_policy_write',
  'enable_crash_after_policy_write',
  'webview_boot_locked_without_names',
  'webview_wrong_pin_preserves_closed_view',
  'webview_unlock_through_native_commands',
  'webview_manual_and_blur_remove_financial_tree',
  'webview_policy_and_disable_with_current_pin',
  'webview_no_storage_or_egress',
  'only_narrow_privacy_and_backup_permissions',
  'windows_hello_availability_from_native_api',
  'owned_credentials_profiles_and_files_removed',
]);
export const permissions = Object.freeze([
  'allow-list-local-workspaces',
  'allow-create-local-workspace',
  'allow-open-local-workspace',
  'allow-local-lock-status',
  'allow-lock-local-session',
  'allow-unlock-local-session',
  'allow-configure-local-pin',
  'allow-disable-local-pin',
  'allow-configure-local-hello',
  'allow-unlock-local-hello',
  'allow-create-local-backup',
  'allow-select-local-backup',
  'allow-preview-local-restore',
  'allow-confirm-local-restore',
  'allow-cancel-local-restore',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'durable-outbox-sync-product-integration',
  'signed-desktop-release-and-other-platforms',
]);
const priorPending = Object.freeze([
  'native-windows-hello-interactive-hardware-validation',
  'product-backup-restore-us034-us035',
  ...pending.slice(1),
]);
const priorBackupPending = [
  pending[0],
  'product-restore-as-new-workspace-us035',
  ...pending.slice(1),
];
export const lockHashes = () => ({
  ...vaultHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src-tauri/src/local_lock.rs',
      'apps/desktop/src-tauri/src/lock_store.rs',
      'apps/desktop/src-tauri/src/bin/lock-probe.rs',
      'apps/desktop/src-tauri/src/bin/lock-smoke.rs',
      'apps/desktop/src-tauri/tests/local_lock.rs',
      'apps/desktop/src-tauri/tests/local_hello.rs',
      'apps/desktop/src-tauri/src/windows_hello.rs',
      'apps/desktop/src-tauri/src/bin/hello-manual.rs',
      'infra/local-lock/hello-package.mjs',
      'infra/local-lock/hello-run.ps1',
      'apps/desktop/src-tauri/lock-smoke.js',
      'apps/desktop/src/local-privacy.ts',
      'apps/desktop/src/local-privacy-flow.tsx',
      'infra/local-lock/evidence.mjs',
      'infra/local-lock/native.mjs',
      'infra/local-lock/browser.mjs',
      'infra/scripts/local-lock.test.mjs',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateLockEvidence(report, { matchSources = true } = {}) {
  const exact = (value, keys) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const fail = () => {
    throw Error('LOCAL_LOCK_EVIDENCE_INVALID');
  };
  const native = report?.scope === 'us033-local-lock-windows',
    legacy = report?.format_version === 1,
    priorHello = report?.format_version === 2,
    priorBackup = report?.format_version === 3,
    checks = native
      ? legacy
        ? nativeChecks
            .filter(
              (name) => name !== 'windows_hello_availability_from_native_api',
            )
            .map((name) =>
              name === 'only_narrow_privacy_and_backup_permissions'
                ? 'only_eight_narrow_permissions'
                : name === 'rustfmt_clippy_seventeen_privacy_tests'
                  ? 'rustfmt_clippy_ten_lock_tests'
                  : name,
            )
        : priorHello
          ? nativeChecks.map((name) =>
              name === 'only_narrow_privacy_and_backup_permissions'
                ? 'only_ten_narrow_permissions'
                : name,
            )
          : nativeChecks
      : legacy
        ? browserChecks.slice(0, 8)
        : browserChecks;
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
    (report.format_version !== 4 &&
      !((legacy || priorHello || priorBackup) && !matchSources)) ||
    !['us033-local-lock-windows', 'us033-local-lock-browser'].includes(
      report.scope,
    ) ||
    report.passed !== true ||
    report.synthetic_only !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, checks) ||
    checks.some((name) => report.checks[name] !== true) ||
    JSON.stringify(report.pending) !==
      JSON.stringify(
        legacy
          ? [
              'native-biometrics-adapter-and-hardware-validation',
              ...priorPending.slice(1),
            ]
          : priorHello
            ? priorPending
            : priorBackup
              ? priorBackupPending
              : pending,
      ) ||
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
          'argon2',
          ...(legacy ? [] : ['windows_hello']),
        ]) ||
        !/^24\./.test(report.versions.node) ||
        !/^rustc 1\.99\.0/.test(report.versions.rust) ||
        report.versions.tauri !== '2.12.3' ||
        report.versions.platform !== 'win32-x64' ||
        report.versions.argon2 !== '0.6.0' ||
        (!legacy &&
          ![
            'AVAILABLE',
            'NOT_CONFIGURED',
            'DISABLED_BY_POLICY',
            'DEVICE_BUSY',
            'UNAVAILABLE',
          ].includes(report.versions.windows_hello))
      : !exact(report.versions, ['node', 'chromium']) ||
        !/^24\./.test(report.versions.node) ||
        !/^\d+\.\d+\.\d+\.\d+$/.test(report.versions.chromium)
  )
    fail();
  const hashes = lockHashes(),
    files = Object.keys(hashes).filter(
      (name) =>
        !legacy ||
        ![
          'apps/desktop/src-tauri/tests/local_hello.rs',
          'apps/desktop/src-tauri/src/windows_hello.rs',
          'apps/desktop/src-tauri/src/bin/hello-manual.rs',
          'infra/local-lock/hello-package.mjs',
          'infra/local-lock/hello-run.ps1',
        ].includes(name),
    );
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
