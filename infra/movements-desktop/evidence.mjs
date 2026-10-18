import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desktopAccountHashes } from '../accounts-desktop/evidence.mjs';
import { manualHashes } from '../manual-movements/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_no_browser_vault',
  'create_income_expense_and_account_balance',
  'edit_preserves_original_and_history',
  'delete_restore_with_explicit_ack',
  'lost_ack_frozen_intent_and_consult',
  'explicit_signed_adjustment',
  'read_only_origins_and_legacy_history',
  'workspace_switch_drops_old_response',
  'lock_and_late_save_hide_data',
  'accessibility_reflow_and_forced_colors',
  'no_storage_egress_or_runtime_errors',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_ten_tests_and_80_shared_vectors',
  'twenty_three_narrow_permissions_without_default_probes',
  ...[
    'crud_history_and_soft_deletion',
    'explicit_adjustment',
    'lost_ack_frozen_intent',
    'workspace_isolation',
    'lock_removes_financial_data',
    'no_storage_or_egress',
  ].map((n) => 'webview_' + n),
  'independent_reopen_and_account_balances',
  'crash_before_commit_no_partial_transaction_or_revision',
  'crash_after_commit_explicit_conflict_without_duplicate',
  'portable_backup_restores_history_with_new_ids',
  'owned_keys_policy_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'cloud-outbox-feed-and-durable-receipts',
  'category-tag-counterparty-and-allocation-editors',
  'large-snapshot-pagination-other-platforms-and-signed-release',
]);
export const movementHashes = () => ({
  ...desktopAccountHashes(),
  ...manualHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-movements.ts',
      'apps/desktop/src/local-movements-flow.tsx',
      'apps/desktop/src-tauri/src/movement_model.rs',
      'apps/desktop/src-tauri/src/local_movements.rs',
      'apps/desktop/src-tauri/src/movement_probe.rs',
      'apps/desktop/src-tauri/tests/local_movements.rs',
      'apps/desktop/src-tauri/fixtures/us041-movements.json',
      'apps/desktop/src-tauri/src/bin/movements-probe.rs',
      'apps/desktop/src-tauri/src/bin/movements-smoke.rs',
      'apps/desktop/src-tauri/movements-smoke.js',
      'infra/movements-desktop/generate.mjs',
      'infra/movements-desktop/fixture.mjs',
      'infra/movements-desktop/browser.mjs',
      'infra/movements-desktop/native.mjs',
      'infra/movements-desktop/evidence.mjs',
      'infra/scripts/movements-desktop.test.mjs',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateMovementEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('DESKTOP_MOVEMENT_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us041-desktop-movements-windows',
    checks =
      native && !matchSources
        ? nativeChecks.map((n) =>
            n === 'twenty_three_narrow_permissions_without_default_probes'
              ? ({
                  1: 'nineteen_narrow_permissions_without_default_probes',
                  2: 'twenty_one_narrow_permissions_without_default_probes',
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
    (r.format_version !== 3 &&
      !([1, 2].includes(r.format_version) && !matchSources)) ||
    ![
      'us041-desktop-movements-browser',
      'us041-desktop-movements-windows',
    ].includes(r.scope) ||
    r.passed !== true ||
    r.synthetic_only !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, checks) ||
    checks.some((n) => r.checks[n] !== true) ||
    JSON.stringify(r.pending) !== JSON.stringify(pending) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.completed_at_utc) ||
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
  const hashes = movementHashes(),
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
