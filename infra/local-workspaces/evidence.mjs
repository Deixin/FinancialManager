import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { entryHashes } from '../entry/evidence.mjs';
export const browserChecks = Object.freeze([
  'preview_refuses_fake_persistence',
  'offline_local_form_without_identity',
  'required_name_and_purpose',
  'single_submit_and_real_result_handoff',
  'reopen_local_and_preserve_name_as_text',
  'sanitized_failure_and_lost_ack_recovery',
  'accessible_form_list_and_overview',
  'no_web_storage_or_remote_requests',
]);
const legacyNativeChecks = Object.freeze([
  'locked_clippy_build_and_six_rust_tests',
  'create_through_production_commands',
  'reopen_in_another_webview_process',
  'encrypted_at_rest',
  'wrong_key_rejected',
  'plaintext_rejected',
  'no_cloud_identity_tables',
  'migrations_v2',
  'missing_key_preserves_database',
  'reopened_exactly',
  'workspace_isolation',
  'recover_after_key_process_exit',
  'recover_after_commit_process_exit',
  'only_three_product_permissions',
  'owned_keys_profiles_and_files_removed',
]);
export const nativeChecks = Object.freeze(
  legacyNativeChecks.map((name) =>
    name === 'only_three_product_permissions'
      ? 'only_narrow_product_permissions'
      : name,
  ),
);
export const pending = Object.freeze([
  'native-vault-expanded-g07-vault-us032',
  'financial-account-and-movement-ui',
  'backup-restore-product-flow',
  'cloud-auth-product-integration',
  'signed-desktop-release',
]);
export const workspaceHashes = () => ({
  ...entryHashes(),
  ...Object.fromEntries(
    [
      ...[
        'lib.rs',
        'identity.rs',
        'keys.rs',
        'workspace_model.rs',
        'local_workspaces.rs',
        'migrations.rs',
        'migration_catalog.rs',
        'commands.rs',
        'local_workspace_tests.rs',
        'bin/workspace-probe.rs',
        'bin/workspace-smoke.rs',
      ].map((name) => 'apps/desktop/src-tauri/src/' + name),
      'apps/desktop/src-tauri/workspace-smoke.js',
      ...['local-workspaces.ts', 'local-workspace-flow.tsx'].map(
        (name) => 'apps/desktop/src/' + name,
      ),
      ...[
        'generate.mjs',
        'browser-fixture.mjs',
        'browser.mjs',
        'native.mjs',
        'evidence.mjs',
      ].map((name) => 'infra/local-workspaces/' + name),
      'infra/scripts/local-workspaces.test.mjs',
      ...[
        '0001-financial-core.sql',
        '0002-balance-reference-lookup.up.sql',
        '0002-balance-reference-lookup.down.sql',
      ].map((name) => 'packages/storage-schema/sqlite/migrations/' + name),
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateWorkspaceEvidence(
  report,
  { matchSources = true } = {},
) {
  const exact = (value, keys) =>
      value &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('WORKSPACE_EVIDENCE_INVALID');
    };
  const native = report?.scope === 'us031-local-workspace-windows',
    checks = native
      ? report?.format_version === 1
        ? legacyNativeChecks
        : nativeChecks
      : browserChecks;
  if (
    !exact(report, [
      'format_version',
      'scope',
      'passed',
      'checks',
      'versions',
      'pending',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
    ]) ||
    ![1, 2].includes(report.format_version) ||
    (matchSources && report.format_version !== 2) ||
    ![
      'us031-local-workspace-windows',
      'us031-local-workspace-browser',
    ].includes(report.scope) ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, checks) ||
    checks.some((name) => report.checks[name] !== true) ||
    JSON.stringify(report.pending) !== JSON.stringify(pending) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    fail();
  if (
    native
      ? !exact(report.versions, ['rust', 'tauri', 'platform']) ||
        !/^rustc 1\.99\.0/.test(report.versions.rust) ||
        report.versions.tauri !== '2.12.3' ||
        report.versions.platform !== 'win32-x64'
      : !exact(report.versions, ['node', 'chromium']) ||
        !/^24\./.test(report.versions.node) ||
        !/^\d+\.\d+\.\d+\.\d+$/.test(report.versions.chromium)
  )
    fail();
  const hashes = workspaceHashes(),
    files = Object.keys(hashes);
  if (
    !exact(report.source_sha256, files) ||
    files.some((name) =>
      matchSources
        ? report.source_sha256[name] !== hashes[name]
        : !/^[a-f0-9]{64}$/.test(report.source_sha256[name]),
    )
  )
    fail();
  return report;
}
