import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desktopTaxonomyHashes } from '../taxonomy-desktop/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_complete_snapshot',
  'same_allocation_and_archived_references',
  'overlapping_tags_any_all_and_unclassified',
  'dates_accounts_and_exact_details',
  'invalid_and_over_limit_reads_show_no_partial_results',
  'workspace_change_discards_late_read',
  'lock_discards_late_read',
  'keyboard_accessibility_reflow_and_no_persistence_or_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_six_read_only_tests',
  'twenty_eight_production_permissions_and_no_probe',
  'independent_process_complete_snapshot',
  'read_preserves_ciphertext_finance_and_audit',
  'webview_complete_filter_read',
  'webview_category_subcategory_and_tags',
  'webview_workspace_isolation',
  'webview_lock_removes_tree',
  'webview_no_storage_or_egress',
  'owned_keys_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'desktop-versioned-classification-editor-us045',
  'split-editor-us046',
  'cloud-authorized-pagination-outbox-feed-and-other-platforms',
]);
export const classificationFilterHashes = () => ({
  ...desktopTaxonomyHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-classification-filters.ts',
      'apps/desktop/src/local-classification-filters-flow.tsx',
      'apps/desktop/src-tauri/src/local_classification_filters.rs',
      'apps/desktop/src-tauri/src/classification_filter_tests.rs',
      'apps/desktop/src-tauri/src/bin/classification-filters-smoke.rs',
      'apps/desktop/src-tauri/classification-filters-smoke.js',
      'infra/classification-filters-desktop/fixture.mjs',
      'infra/classification-filters-desktop/browser.mjs',
      'infra/classification-filters-desktop/native.mjs',
      'infra/classification-filters-desktop/evidence.mjs',
      'infra/scripts/classification-filters-desktop.test.mjs',
      'packages/domain/src/classification.ts',
      '.github/workflows/desktop-classification-filters.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateClassificationFilterEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('CLASSIFICATION_FILTER_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us045-desktop-classification-filters-windows',
    checks =
      native && !matchSources
        ? nativeChecks.map((n) =>
            n === 'twenty_eight_production_permissions_and_no_probe'
              ? ({ 1: 'unchanged_27_production_permissions_and_no_probe' }[
                  r.format_version
                ] ?? n)
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
    (r.format_version !== 2 && !(r.format_version === 1 && !matchSources)) ||
    ![
      'us045-desktop-classification-filters-windows',
      'us045-desktop-classification-filters-browser',
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
      ? !exact(r.versions, ['node', 'rust', 'tauri', 'platform']) ||
        !/^24\./.test(r.versions.node) ||
        !/^rustc 1\.99\.0/.test(r.versions.rust) ||
        r.versions.tauri !== '2.12.3' ||
        r.versions.platform !== 'win32-x64'
      : !exact(r.versions, ['node', 'chromium']) ||
        !/^24\./.test(r.versions.node) ||
        !/^\d+\.\d+\.\d+\.\d+$/.test(r.versions.chromium)
  )
    fail();
  const hashes = classificationFilterHashes(),
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
