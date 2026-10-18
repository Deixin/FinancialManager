import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { movementHashes } from '../movements-desktop/evidence.mjs';
import { cardPaymentHashes } from '../card-payments/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_without_browser_vault',
  'create_pair_confirmation_and_debt_reduction',
  'edit_pair_roles_and_preserve_original',
  'delete_restore_both_sides_and_history',
  'lost_ack_reuses_three_ids_and_pair_base',
  'stale_pair_is_not_rebased',
  'large_money_and_account_role_selection',
  'card_overview_separates_purchase_credit_and_payment',
  'broken_imported_and_legacy_groups_read_only',
  'workspace_switch_drops_old_cardPayment_response',
  'lock_and_late_save_remove_financial_tree',
  'accessibility_reflow_forced_colors_and_no_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_eleven_tests_and_72_shared_vectors',
  'twenty_nine_narrow_permissions_without_default_probes',
  ...[
    'paired_crud_and_history',
    'canonical_money_and_net_worth',
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
  'statement-import-and-payment-reconciliation',
  'classification-editors',
  'large-snapshot-pagination-other-platforms-and-signed-release',
]);
export const desktopCardPaymentHashes = () => ({
  ...movementHashes(),
  ...cardPaymentHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-card-payments.ts',
      'apps/desktop/src/local-card-payments-flow.tsx',
      'apps/desktop/src-tauri/src/local_card_payments.rs',
      'apps/desktop/src-tauri/src/card_payment_model.rs',
      'apps/desktop/src-tauri/src/card_payment_probe.rs',
      'apps/desktop/src-tauri/src/bin/card-payments-probe.rs',
      'apps/desktop/src-tauri/src/bin/card-payments-smoke.rs',
      'apps/desktop/src-tauri/card-payments-smoke.js',
      'apps/desktop/src-tauri/src/card_payment_tests.rs',
      'apps/desktop/src-tauri/fixtures/us043-card-payments.json',
      'infra/card-payments-desktop/generate.mjs',
      'infra/card-payments-desktop/fixture.mjs',
      'infra/card-payments-desktop/browser.mjs',
      'infra/card-payments-desktop/native.mjs',
      'infra/card-payments-desktop/evidence.mjs',
      'infra/scripts/card-payments-desktop.test.mjs',
      '.github/workflows/desktop-card-payments.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopCardPaymentEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('DESKTOP_CARD_PAYMENT_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us043-desktop-card-payments-windows',
    checks =
      native && !matchSources
        ? nativeChecks.map((n) =>
            n === 'twenty_nine_narrow_permissions_without_default_probes'
              ? ({
                  1: 'twenty_three_narrow_permissions_without_default_probes',
                  2: 'twenty_five_narrow_permissions_without_default_probes',
                  3: 'twenty_seven_narrow_permissions_without_default_probes',
                  4: 'twenty_eight_narrow_permissions_without_default_probes',
                }[r.format_version] ?? n)
              : n,
          )
        : native
          ? nativeChecks
          : browserChecks;
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
    (r.format_version !== 5 &&
      !([1, 2, 3, 4].includes(r.format_version) && !matchSources)) ||
    ![
      'us043-desktop-card-payments-windows',
      'us043-desktop-card-payments-browser',
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
  const hashes = desktopCardPaymentHashes(),
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
