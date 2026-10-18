import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { classificationFilterHashes } from '../classification-filters-desktop/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_and_import_classification',
  'lost_ack_frozen_identity_explicit_review',
  'stale_base_and_archived_new_reference_refused',
  'split_tags_preserve_allocations',
  'paired_transfer_and_card_preserve_partner',
  'clear_noop_and_before_after_history',
  'malformed_ack_keeps_intent',
  'workspace_switch_discards_late_save_without_followup_read',
  'lock_discards_late_save_and_tree',
  'keyboard_accessibility_reflow_forced_colors_no_persistence_or_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_ten_tests_and_58_shared_vectors',
  'thirty_two_permissions_real_handler_and_no_probe',
  ...[
    'import_lost_ack_frozen_base',
    'paired_transfer_and_card',
    'split_tags_preserve_allocations',
    'clear_noop_and_history',
    'workspace_isolation',
    'lock_removes_editor_tree',
    'no_storage_or_egress',
  ].map((n) => 'webview_' + n),
  'independent_process_reopens_classification_history',
  'financial_values_balances_economic_kind_and_groups_unchanged',
  'failed_first_save_rolls_back_allocations_tags_and_revisions',
  ...['first', 'before', 'after'].map(
    (n) => 'crash_' + n + '_commit_atomic_classification',
  ),
  'portable_restore_history_without_source_key_and_prepared_write_refusal',
  'owned_keys_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'split-editor-us046',
  'cloud-authorized-pagination-outbox-feed-and-other-platforms',
  'taxonomy-version-audit-and-durable-receipts',
]);
export const desktopClassificationHashes = () => ({
  ...classificationFilterHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-classification.ts',
      'apps/desktop/src/local-classification-flow.tsx',
      'apps/desktop/src-tauri/src/classification_model.rs',
      'apps/desktop/src-tauri/src/local_classification.rs',
      'apps/desktop/src-tauri/src/classification_probe.rs',
      'apps/desktop/src-tauri/src/classification_tests.rs',
      'apps/desktop/src-tauri/src/bin/classification-probe.rs',
      'apps/desktop/src-tauri/src/bin/classification-smoke.rs',
      'apps/desktop/src-tauri/classification-smoke.js',
      'apps/desktop/src-tauri/fixtures/us045-classification.json',
      'infra/classification-desktop/fixture.mjs',
      'infra/classification-desktop/generate.mjs',
      'infra/classification-desktop/browser.mjs',
      'infra/classification-desktop/native.mjs',
      'infra/classification-desktop/evidence.mjs',
      'infra/scripts/classification-desktop.test.mjs',
      '.github/workflows/desktop-classification.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopClassificationEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('DESKTOP_CLASSIFICATION_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us045-desktop-classification-windows',
    checks =
      native && !matchSources
        ? nativeChecks.map((n) =>
            n === 'thirty_two_permissions_real_handler_and_no_probe'
              ? ({
                  2: 'twenty_nine_permissions_real_handler_and_no_probe',
                  1: 'twenty_eight_permissions_real_handler_and_no_probe',
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
      'us045-desktop-classification-windows',
      'us045-desktop-classification-browser',
    ].includes(r.scope) ||
    r.passed !== true ||
    r.synthetic_only !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, checks) ||
    checks.some((k) => r.checks[k] !== true) ||
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
  const hashes = desktopClassificationHashes(),
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
