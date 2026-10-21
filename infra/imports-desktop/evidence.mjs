import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desktopCounterpartyHashes } from '../counterparties-desktop/evidence.mjs';
import { sourceHashes as fileHashes } from '../import-file-validation/evidence.mjs';
export const browserChecks = Object.freeze([
  'filters_detail_and_history_links',
  'lost_ack_and_malformed_ack_keep_frozen_intent',
  'workspace_switch_discards_late_write',
  'lock_discards_late_write_and_private_tree',
  'accessibility_reflow_no_storage_egress_or_errors',
  'file_picker_unlock_validation_and_safe_rejection',
  'file_cancel_discards_late_result_and_preserves_ledger',
  'file_validation_accessible_private_and_no_storage',
]);
export const nativeChecks = Object.freeze([
  'locked_clippy_seven_sqlcipher_tests_and_102_shared_vectors',
  'production_35_narrow_permissions',
  'independent_process_reopens_ledger',
  'shared_port_matches_native_pages_details_prepare_and_replay',
  'webview_real_commands_and_frozen_retry',
  'portable_restore_without_source_credentials',
  'owned_keys_profiles_files_removed',
  'file_gate_seven_native_tests_and_shared_rust_parity',
  'file_webview_real_ipc_selection_unlock_and_validation',
]);
export const pending = Object.freeze([
  'human-homologations-after-complete-system-integration',
  'cloud-mobile-sync-and-other-platforms',
  'parsers-staging-review-financial-commit-us051-us057',
]);
export function hashes() {
  return {
    ...desktopCounterpartyHashes(),
    ...fileHashes(),
    ...Object.fromEntries(
      [
        'apps/desktop/src/local-import-file.ts',
        'apps/desktop/src/local-import-file-flow.tsx',
        'apps/desktop/src-tauri/src/file_model.rs',
        'apps/desktop/src-tauri/src/file_csv.rs',
        'apps/desktop/src-tauri/src/file_ofx.rs',
        'apps/desktop/src-tauri/src/file_unicode.rs',
        'apps/desktop/src-tauri/src/file_tests.rs',
        'apps/desktop/src-tauri/src/import_file_source.rs',
        'apps/desktop/src-tauri/src/local_import_file.rs',
        'apps/desktop/src-tauri/src/bin/file-probe.rs',
        'apps/desktop/src-tauri/src/bin/file-smoke.rs',
        'apps/desktop/src-tauri/file-smoke.js',
        'infra/import-files-desktop/generate.mjs',
        'infra/import-files-desktop/parity.mjs',
        'packages/domain/src/imports.ts',
        'packages/finance-ports/src/imports.ts',
        'apps/desktop/src/local-imports.ts',
        'apps/desktop/src/local-imports-flow.tsx',
        'apps/desktop/src-tauri/src/import_model.rs',
        'apps/desktop/src-tauri/src/local_imports.rs',
        'apps/desktop/src-tauri/src/import_probe.rs',
        'apps/desktop/src-tauri/src/import_tests.rs',
        'apps/desktop/src-tauri/src/bin/imports-probe.rs',
        'apps/desktop/src-tauri/src/bin/imports-smoke.rs',
        'apps/desktop/src-tauri/imports-smoke.js',
        'apps/desktop/src-tauri/fixtures/us050-imports.json',
        'packages/storage-schema/sqlite/migrations/0003-import-ledger.up.sql',
        'packages/storage-schema/sqlite/migrations/0003-import-ledger.down.sql',
        'infra/imports-desktop/generate.mjs',
        'infra/imports-desktop/fixture.mjs',
        'infra/imports-desktop/parity.mjs',
        'infra/imports-desktop/browser.mjs',
        'infra/imports-desktop/native.mjs',
        'infra/imports-desktop/evidence.mjs',
        'infra/scripts/imports-desktop.test.mjs',
        '.github/workflows/desktop-imports.yml',
      ].map((f) => [
        f,
        createHash('sha256')
          .update(readFileSync(new URL('../../' + f, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  };
}
export function validateEvidence(r, { matchSources = true } = {}) {
  const checks =
    r?.scope === 'us050-desktop-imports-windows'
      ? nativeChecks
      : r?.scope === 'us050-desktop-imports-browser'
        ? browserChecks
        : null;
  if (
    !checks ||
    r.format_version !== 1 ||
    r.passed !== true ||
    r.synthetic_only !== true ||
    r.resources_closed !== true ||
    Object.keys(r).sort().join(',') !==
      [
        'format_version',
        'scope',
        'passed',
        'synthetic_only',
        'checks',
        'versions',
        'pending',
        'resources_closed',
        'source_sha256',
      ]
        .sort()
        .join(',') ||
    !r.checks ||
    Object.keys(r.checks).sort().join(',') !== [...checks].sort().join(',') ||
    checks.some((k) => r.checks[k] !== true) ||
    JSON.stringify(r.pending) !== JSON.stringify(pending) ||
    !r.versions ||
    !Object.keys(r.versions).length ||
    !r.source_sha256 ||
    JSON.stringify(Object.entries(r.source_sha256).sort()) !==
      JSON.stringify(
        Object.entries(matchSources ? hashes() : r.source_sha256).sort(),
      )
  )
    throw Error('IMPORT_DESKTOP_EVIDENCE_INVALID');
  return r;
}
