import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desktopCategoryHashes as movementHashes } from '../categories-desktop/evidence.mjs';
import { taxonomyHashes as categoryHashes } from '../taxonomy/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_without_browser_vault',
  'create_search_and_parent_immutable',
  'archive_reactivate_and_active_order',
  'lost_ack_reuses_frozen_create_id',
  'normalized_name_conflict_and_explicit_review',
  'stale_base_is_not_rebased',
  'workspace_switch_drops_late_catalog',
  'lock_and_late_save_remove_taxonomy_tree',
  'accessibility_reflow_forced_colors_no_storage_or_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_nine_tests_and_77_shared_vectors',
  'thirty_two_permissions_real_production_handler_and_no_probe',
  ...[
    'taxonomy_crud_and_parent_order',
    'archive_retains_parent_identity',
    'lost_ack_frozen_taxonomy_id',
    'workspace_isolation',
    'lock_removes_financial_tree',
    'no_storage_or_egress',
  ].map((n) => 'webview_' + n),
  'independent_process_reopens_taxonomy',
  'used_taxonomy_preserves_financial_graph_and_balances',
  'failed_reorder_rolls_back_every_row',
  ...['first', 'before', 'after'].map(
    (n) => 'crash_' + n + '_commit_atomic_reorder',
  ),
  'portable_restore_keeps_taxonomy_without_source_key',
  'owned_keys_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'desktop-transaction-classification-and-filters-us045',
  'split-editor-us046',
  'taxonomy-version-audit-cloud-feed-outbox-and-durable-receipts',
  'unicode-locale-expansion-pagination-other-platforms-and-signed-release',
]);
export const desktopTaxonomyHashes = () => ({
  ...movementHashes(),
  ...categoryHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-taxonomy.ts',
      'apps/desktop/src/local-taxonomy-flow.tsx',
      'apps/desktop/src-tauri/src/taxonomy_model.rs',
      'apps/desktop/src-tauri/src/local_taxonomy.rs',
      'apps/desktop/src-tauri/src/taxonomy_probe.rs',
      'apps/desktop/src-tauri/src/taxonomy_tests.rs',
      'apps/desktop/src-tauri/src/bin/taxonomy-probe.rs',
      'apps/desktop/src-tauri/src/bin/taxonomy-smoke.rs',
      'apps/desktop/src-tauri/taxonomy-smoke.js',
      'apps/desktop/src-tauri/fixtures/us045-taxonomy.json',
      'infra/taxonomy-desktop/generate.mjs',
      'infra/taxonomy-desktop/fixture.mjs',
      'infra/taxonomy-desktop/browser.mjs',
      'infra/taxonomy-desktop/native.mjs',
      'infra/taxonomy-desktop/evidence.mjs',
      'infra/scripts/taxonomy-desktop.test.mjs',
      '.github/workflows/desktop-taxonomy.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopTaxonomyEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('DESKTOP_TAXONOMY_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us045-desktop-taxonomy-windows',
    checks =
      native && !matchSources
        ? nativeChecks.map((n) =>
            n === 'thirty_two_permissions_real_production_handler_and_no_probe'
              ? ({
                  3: 'twenty_nine_permissions_real_production_handler_and_no_probe',
                  1: 'twenty_seven_permissions_real_production_handler_and_no_probe',
                  2: 'twenty_eight_permissions_real_production_handler_and_no_probe',
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
    (r.format_version !== 4 &&
      !([1, 2, 3].includes(r.format_version) && !matchSources)) ||
    ![
      'us045-desktop-taxonomy-windows',
      'us045-desktop-taxonomy-browser',
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
  const hashes = desktopTaxonomyHashes(),
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
