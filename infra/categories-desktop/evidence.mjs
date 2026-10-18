import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { movementHashes } from '../movements-desktop/evidence.mjs';
import { categoryHashes } from '../categories/evidence.mjs';
export const browserChecks = Object.freeze([
  'native_only_without_browser_vault',
  'purpose_seed_once_and_edit_keeps_provenance',
  'archive_reactivate_and_active_order',
  'lost_ack_reuses_frozen_create_id',
  'normalized_name_conflict_and_explicit_review',
  'stale_base_is_not_rebased',
  'workspace_switch_drops_late_catalog_and_business_defaults',
  'lock_and_late_save_remove_category_tree',
  'accessibility_reflow_forced_colors_no_storage_or_egress',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_nine_tests_and_52_shared_vectors',
  'twenty_seven_permissions_real_production_handler_and_no_probe',
  ...[
    'category_crud_seed_and_order',
    'archive_keeps_seed_provenance',
    'lost_ack_frozen_category_id',
    'workspace_isolation',
    'lock_removes_financial_tree',
    'no_storage_or_egress',
  ].map((n) => 'webview_' + n),
  'independent_process_reopens_edited_categories',
  'used_category_preserves_financial_graph_and_balances',
  'failed_seed_rolls_back_every_row',
  ...['first', 'before', 'after'].map(
    (n) => 'crash_' + n + '_commit_atomic_seed',
  ),
  'portable_restore_keeps_category_metadata_without_source_key',
  'owned_keys_profiles_and_files_removed',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'subcategory-tag-and-classification-editors-us045-us046',
  'category-version-audit-cloud-feed-outbox-and-durable-receipts',
  'unicode-locale-expansion-pagination-other-platforms-and-signed-release',
]);
export const desktopCategoryHashes = () => ({
  ...movementHashes(),
  ...categoryHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src/local-categories.ts',
      'apps/desktop/src/local-categories-flow.tsx',
      'apps/desktop/src-tauri/src/category_model.rs',
      'apps/desktop/src-tauri/src/local_categories.rs',
      'apps/desktop/src-tauri/src/category_probe.rs',
      'apps/desktop/src-tauri/src/category_tests.rs',
      'apps/desktop/src-tauri/src/bin/categories-probe.rs',
      'apps/desktop/src-tauri/src/bin/categories-smoke.rs',
      'apps/desktop/src-tauri/categories-smoke.js',
      'apps/desktop/src-tauri/fixtures/us044-categories.json',
      'infra/categories-desktop/generate.mjs',
      'infra/categories-desktop/fixture.mjs',
      'infra/categories-desktop/browser.mjs',
      'infra/categories-desktop/native.mjs',
      'infra/categories-desktop/evidence.mjs',
      'infra/scripts/categories-desktop.test.mjs',
      '.github/workflows/desktop-categories.yml',
    ].map((f) => [
      f,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + f, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateDesktopCategoryEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, k) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...k].sort()),
    fail = () => {
      throw Error('DESKTOP_CATEGORY_EVIDENCE_INVALID');
    },
    native = r?.scope === 'us044-desktop-categories-windows',
    checks =
      native && !matchSources && r.format_version === 1
        ? nativeChecks.map((n) =>
            n ===
            'twenty_seven_permissions_real_production_handler_and_no_probe'
              ? 'twenty_five_permissions_real_production_handler_and_no_probe'
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
      'us044-desktop-categories-windows',
      'us044-desktop-categories-browser',
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
  const hashes = desktopCategoryHashes(),
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
