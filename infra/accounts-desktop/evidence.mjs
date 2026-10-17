import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { managerHashes } from '../workspace-manager/evidence.mjs';
import { accountHashes } from '../accounts/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_no_browser_vault',
  'snapshot_balances_debt_and_incompleteness',
  'create_explicit_reference_and_canonical_money',
  'observed_balance_is_read_only',
  'metadata_edit_and_stale_conflict',
  'archive_reactivate_preserves_history',
  'reference_correction_preserves_history_and_ack',
  'lost_ack_same_frozen_intent_without_duplicate',
  'workspace_switch_drops_old_tree_and_response',
  'native_lock_and_late_save_hide_financial_data',
  'accessibility_responsive_and_forced_colors',
  'no_storage_egress_or_runtime_errors',
]);
export const nativeChecks = Object.freeze([
  'locked_build_clippy_ten_tests_and_62_domain_vectors',
  'seventeen_narrow_permissions_without_default_probes',
  'native_fin002_snapshot_matches_shared_domain_goldens',
  'webview_crud_and_canonical_money',
  'webview_reference_history_and_comparison',
  'webview_lost_ack_reuses_same_intent',
  'webview_workspace_switch_isolation',
  'webview_lock_removes_financial_data',
  'webview_no_storage_or_egress',
  'webview_state_reopened_by_independent_process',
  'crash_before_commit_recovers_without_partial_account',
  'crash_after_commit_replay_does_not_duplicate',
  'backup_restore_in_another_installation_preserves_new_accounts',
  'owned_keys_policy_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'cloud-account-write-routes-outbox-and-audit-lineage',
  'identified-adjustment-movement-us041',
  'large-snapshot-pagination-other-platforms-and-signed-release',
]);
export const desktopAccountHashes = () => ({
  ...managerHashes(),
  ...accountHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src-tauri/src/bin/accounts-probe.rs',
      'apps/desktop/src-tauri/src/bin/accounts-smoke.rs',
      'apps/desktop/src-tauri/accounts-smoke.js',
      'infra/accounts-desktop/native.mjs',
      'apps/desktop/src/local-accounts.ts',
      'apps/desktop/src/local-accounts-flow.tsx',
      'apps/desktop/src-tauri/src/account_model.rs',
      'apps/desktop/src-tauri/src/local_accounts.rs',
      'apps/desktop/src-tauri/src/account_probe.rs',
      'apps/desktop/src-tauri/tests/local_accounts.rs',
      'apps/desktop/src-tauri/fixtures/us040-accounts.json',
      'infra/accounts-desktop/generate.mjs',
      'infra/accounts-desktop/fixture.mjs',
      'infra/accounts-desktop/browser.mjs',
      'infra/accounts-desktop/evidence.mjs',
      'infra/scripts/accounts-desktop.test.mjs',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopAccountEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('DESKTOP_ACCOUNT_EVIDENCE_INVALID');
    };
  const native = r?.scope === 'us040-desktop-accounts-windows',
    checks = native ? nativeChecks : browserChecks;
  if (
    !exact(r, [
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
    r.format_version !== 1 ||
    ![
      'us040-desktop-accounts-windows',
      'us040-desktop-accounts-browser',
    ].includes(r.scope) ||
    r.passed !== true ||
    r.synthetic_only !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, checks) ||
    checks.some((n) => r.checks[n] !== true) ||
    JSON.stringify(r.pending) !== JSON.stringify(pending)
  )
    fail();
  if (
    native
      ? !exact(r.versions, [
          'node',
          'rust',
          'tauri',
          'platform',
          'aes_gcm',
          'argon2',
        ]) ||
        !/^24\./.test(r.versions.node) ||
        !/^rustc 1\.99\.0/.test(r.versions.rust) ||
        r.versions.tauri !== '2.12.3' ||
        r.versions.platform !== 'win32-x64' ||
        r.versions.aes_gcm !== '0.11.1' ||
        r.versions.argon2 !== '0.6.0'
      : !exact(r.versions, ['node', 'chromium']) ||
        !/^24\./.test(r.versions.node) ||
        !/^\d+\.\d+\.\d+\.\d+$/.test(r.versions.chromium)
  )
    fail();
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.completed_at_utc) ||
    !Number.isFinite(Date.parse(r.completed_at_utc)) ||
    new Date(r.completed_at_utc).toISOString() !== r.completed_at_utc
  )
    fail();
  const hashes = desktopAccountHashes(),
    files = Object.keys(hashes);
  if (
    !exact(r.source_sha256, files) ||
    files.some((f) =>
      matchSources
        ? r.source_sha256[f] !== hashes[f]
        : !/^[a-f0-9]{64}$/.test(r.source_sha256[f]),
    )
  )
    fail();
  return r;
}
