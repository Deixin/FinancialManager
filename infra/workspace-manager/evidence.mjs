import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { restoreHashes } from '../local-restore/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_multiple_workspace_policy',
  'unlimited_catalog_with_purpose_and_local_cloud_filter',
  'create_multiple_fresh_intents_and_cancel',
  'lost_ack_repeats_frozen_request_without_duplicate',
  'switch_removes_old_tree_and_resets_route',
  'native_lock_failure_clears_cached_catalog',
  'restored_initial_workspace_has_full_selector',
  'accessible_responsive_and_forced_colors',
  'no_storage_egress_or_runtime_errors',
]);
export const nativeChecks = Object.freeze([
  'locked_fmt_clippy_build_and_default_without_probe',
  'twenty_nine_narrow_product_permissions',
  'many_local_workspaces_without_plan_or_cloud_identity',
  'reopen_in_independent_process_and_preserve_financial_state',
  'webview_catalog_purpose_local_and_cloud_unavailable',
  'webview_create_multiple_and_cancel',
  'webview_switch_resets_context_and_route',
  'webview_full_selector_after_reentry',
  'webview_no_storage_or_egress',
  'webview_created_state_verified_in_new_process',
  'owned_keys_policy_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'expanded-schema-future-entities-and-outbox-integration',
  'signed-release-other-platforms-and-power-loss-filesystems',
]);
export const managerHashes = () => ({
  ...restoreHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src-tauri/src/bin/workspace-manager-probe.rs',
      'apps/desktop/src-tauri/src/bin/workspace-manager-smoke.rs',
      'apps/desktop/src-tauri/workspace-manager-smoke.js',
      'infra/workspace-manager/evidence.mjs',
      'infra/workspace-manager/browser.mjs',
      'infra/workspace-manager/native.mjs',
      'infra/scripts/workspace-manager.test.mjs',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateManagerEvidence(report, { matchSources = true } = {}) {
  const exact = (value, keys) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const fail = () => {
    throw Error('WORKSPACE_MANAGER_EVIDENCE_INVALID');
  };
  const native = report?.scope === 'us036-workspace-manager-windows',
    checks =
      native && !matchSources
        ? nativeChecks.map((n) =>
            n === 'twenty_nine_narrow_product_permissions'
              ? ({
                  1: 'fifteen_narrow_product_permissions',
                  2: 'seventeen_narrow_product_permissions',
                  3: 'nineteen_narrow_product_permissions',
                  4: 'twenty_one_narrow_product_permissions',
                  5: 'twenty_three_narrow_product_permissions',
                  6: 'twenty_five_narrow_product_permissions',
                  7: 'twenty_seven_narrow_product_permissions',
                  8: 'twenty_eight_narrow_product_permissions',
                }[report.format_version] ?? n)
              : n,
          )
        : native
          ? nativeChecks
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
    (report.format_version !== 9 &&
      !(
        [1, 2, 3, 4, 5, 6, 7, 8].includes(report.format_version) &&
        !matchSources
      )) ||
    ![
      'us036-workspace-manager-windows',
      'us036-workspace-manager-browser',
    ].includes(report.scope) ||
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
  const hashes = managerHashes(),
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
