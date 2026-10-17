import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { workspaceHashes } from '../local-workspaces/evidence.mjs';
export const vaultChecks = Object.freeze([
  'rustfmt_clippy_eight_fault_tests',
  'locked_default_and_probe_build',
  'runtime_sqlcipher_and_eight_pragmas',
  'migration_after_ddl',
  'migration_after_history',
  'migration_before_commit',
  'hot_journal_ciphertext',
  'hot_journal_recovery_preserves_financial_state',
  'cross_process_installation_lock',
  'default_binary_and_ipc_exclude_probe',
  'owned_credentials_and_files_removed',
]);
export const pending = Object.freeze([
  'optional-pin-biometrics-us033',
  'product-backup-restore-new-installation-us034-us035',
  'durable-outbox-sync-product-integration',
  'signed-desktop-release-and-other-platforms',
]);
export const vaultHashes = () => ({
  ...workspaceHashes(),
  ...Object.fromEntries(
    [
      'apps/desktop/src-tauri/src/vault_probe.rs',
      'apps/desktop/src-tauri/src/bin/vault-probe.rs',
      'apps/desktop/src-tauri/tests/vault.rs',
      'packages/test-fixtures/fixtures/fin-002.json',
      'infra/vault/native.mjs',
      'infra/vault/evidence.mjs',
      'infra/scripts/desktop-vault.test.mjs',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateVaultEvidence(report, { matchSources = true } = {}) {
  const exact = (value, names) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...names].sort());
  const fail = () => {
    throw Error('VAULT_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'scope',
      'passed',
      'synthetic_only',
      'dataset_id',
      'dataset_version',
      'checks',
      'versions',
      'pending',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
    ]) ||
    report.format_version !== 1 ||
    report.scope !== 'us032-product-vault-windows' ||
    report.passed !== true ||
    report.synthetic_only !== true ||
    report.dataset_id !== 'FIN-002' ||
    report.dataset_version !== 1 ||
    report.resources_closed !== true ||
    !exact(report.checks, vaultChecks) ||
    vaultChecks.some((name) => report.checks[name] !== true) ||
    JSON.stringify(report.pending) !== JSON.stringify(pending) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    new Date(report.completed_at_utc).toISOString() !== report.completed_at_utc
  )
    fail();
  if (
    !exact(report.versions, [
      'node',
      'rust',
      'tauri',
      'sqlcipher',
      'sqlite',
      'platform',
    ]) ||
    !/^24\./.test(report.versions.node) ||
    !/^rustc 1\.99\.0/.test(report.versions.rust) ||
    report.versions.tauri !== '2.12.3' ||
    report.versions.sqlcipher !== '4.14.0 community' ||
    !/^3\.\d+\.\d+$/.test(report.versions.sqlite) ||
    report.versions.platform !== 'win32-x64'
  )
    fail();
  const hashes = vaultHashes(),
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
