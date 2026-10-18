import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { movementHashes } from '../movements-desktop/evidence.mjs';
import { transferHashes } from '../transfers/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_without_browser_vault',
  'create_pair_confirmation_and_conserved_balance',
  'edit_swap_accounts_and_preserve_original',
  'delete_restore_both_sides_and_history',
  'lost_ack_reuses_three_ids_and_pair_base',
  'stale_pair_is_not_rebased',
  'large_money_and_asset_only_selection',
  'broken_imported_and_legacy_groups_read_only',
  'workspace_switch_drops_old_transfer_response',
  'lock_and_late_save_remove_financial_tree',
  'accessibility_reflow_forced_colors_and_no_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_ten_tests_and_69_shared_vectors',
  'twenty_one_narrow_permissions_without_default_probes',
  ...[
    'paired_crud_and_history',
    'canonical_money_and_conserved_balances',
    'lost_ack_frozen_group_and_members',
    'workspace_isolation',
    'lock_removes_financial_tree',
    'no_storage_or_egress',
  ].map((n) => 'webview_' + n),
  'independent_process_reopens_groups_members_and_revisions',
  'crash_after_first_side_rolls_back_group_and_audit',
  'crash_after_commit_replay_conflicts_without_duplicate',
  'portable_restore_rebases_group_and_revision_snapshots',
  'owned_keys_policy_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'cloud-outbox-feed-and-durable-receipts',
  'card-payment-and-classification-editors',
  'large-snapshot-pagination-other-platforms-and-signed-release',
]);
export const desktopTransferHashes = () => ({
  ...movementHashes(),
  ...transferHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-transfers.ts',
      'apps/desktop/src/local-transfers-flow.tsx',
      'apps/desktop/src-tauri/src/local_transfers.rs',
      'apps/desktop/src-tauri/src/transfer_model.rs',
      'apps/desktop/src-tauri/src/transfer_probe.rs',
      'apps/desktop/src-tauri/src/bin/transfers-probe.rs',
      'apps/desktop/src-tauri/src/bin/transfers-smoke.rs',
      'apps/desktop/src-tauri/transfers-smoke.js',
      'apps/desktop/src-tauri/src/transfer_tests.rs',
      'apps/desktop/src-tauri/fixtures/us042-transfers.json',
      'infra/transfers-desktop/generate.mjs',
      'infra/transfers-desktop/fixture.mjs',
      'infra/transfers-desktop/browser.mjs',
      'infra/transfers-desktop/native.mjs',
      'infra/transfers-desktop/evidence.mjs',
      'infra/scripts/transfers-desktop.test.mjs',
      '.github/workflows/desktop-transfers.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopTransferEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('DESKTOP_TRANSFER_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us042-desktop-transfers-windows',
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
      'us042-desktop-transfers-windows',
      'us042-desktop-transfers-browser',
    ].includes(r.scope) ||
    r.passed !== true ||
    r.synthetic_only !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, checks) ||
    checks.some((n) => r.checks[n] !== true) ||
    JSON.stringify(r.pending) !== JSON.stringify(pending) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.completed_at_utc) ||
    !Number.isFinite(Date.parse(r.completed_at_utc)) ||
    new Date(r.completed_at_utc).toISOString() !== r.completed_at_utc
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
  const hashes = desktopTransferHashes(),
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
