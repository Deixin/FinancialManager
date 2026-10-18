import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desktopAllocationHashes as inheritedHashes } from '../allocations-desktop/evidence.mjs';
export const browserChecks = Object.freeze([
  'catalog_homonyms_identifiers_archive_search',
  'lost_ack_frozen_retry_original_and_history',
  'archived_reference_review_and_full_group_partner_noop',
  'malformed_ack_keeps_intent_and_explicit_review',
  'workspace_switch_discards_late_write_reply',
  'lock_discards_late_write_reply_and_private_tree',
  'keyboard_accessibility_reflow_no_storage_or_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_eleven_tests_and_56_shared_vectors',
  'thirty_two_permissions_real_handler_and_no_probe',
  ...[
    'catalog_reuse_archive_homonyms',
    'import_association_lost_ack_frozen_base',
    'paired_transfer_and_card',
    'clear_noop_and_history',
    'workspace_isolation',
    'lock_removes_editor_tree',
    'no_storage_or_egress',
  ].map((n) => 'webview_' + n),
  'independent_process_reopens_counterparty_history',
  'financial_values_balances_economic_kind_and_groups_unchanged',
  'failed_first_save_rolls_back_associations_and_revisions',
  ...['first', 'before', 'after'].map(
    (n) => 'crash_' + n + '_commit_atomic_associations',
  ),
  'portable_restore_history_without_source_key_and_prepared_write_refusal',
  'owned_keys_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'cloud-authorized-pagination-outbox-feed-and-other-platforms',
  'taxonomy-version-audit-and-durable-receipts',
]);
export const desktopCounterpartyHashes = () => ({
  ...inheritedHashes(),
  ...Object.fromEntries(
    [
      'packages/domain/src/counterparties.ts',
      'packages/domain/src/counterparty-associations.ts',
      'packages/finance-ports/src/counterparties.ts',
      'packages/finance-ports/src/counterparty-associations.ts',
      'apps/desktop/src/local-counterparties.ts',
      'apps/desktop/src/local-counterparties-flow.tsx',
      'apps/desktop/src-tauri/src/counterparty_model.rs',
      'apps/desktop/src-tauri/src/counterparty_association_model.rs',
      'apps/desktop/src-tauri/src/local_counterparties.rs',
      'apps/desktop/src-tauri/src/counterparty_probe.rs',
      'apps/desktop/src-tauri/src/counterparty_tests.rs',
      'apps/desktop/src-tauri/src/bin/counterparties-probe.rs',
      'apps/desktop/src-tauri/src/bin/counterparties-smoke.rs',
      'apps/desktop/src-tauri/counterparties-smoke.js',
      'apps/desktop/src-tauri/fixtures/us047-counterparties.json',
      'infra/counterparties-desktop/fixture.mjs',
      'infra/counterparties-desktop/generate.mjs',
      'infra/counterparties-desktop/browser.mjs',
      'infra/counterparties-desktop/native.mjs',
      'infra/counterparties-desktop/evidence.mjs',
      'infra/scripts/counterparties-desktop.test.mjs',
      '.github/workflows/desktop-counterparties.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopCounterpartyEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('DESKTOP_COUNTERPARTY_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us047-desktop-counterparties-windows',
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
      'us047-desktop-counterparties-windows',
      'us047-desktop-counterparties-browser',
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
  const hashes = desktopCounterpartyHashes(),
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
