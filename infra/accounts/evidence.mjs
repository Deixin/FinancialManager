import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionChecks, revisionHashes } from '../revisions/evidence.mjs';
import { accountCases } from './protocol.mjs';
export const pending = Object.freeze([
  'desktop-account-ipc-and-ui-integration',
  'cloud-write-routes-and-durable-operation-receipts',
  'account-audit-outbox-and-version-lineage',
  'human-homologations-after-complete-system-integration',
]);
export const accountChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((engine) =>
    accountCases.map((name) => engine + '_accounts_' + name),
  ),
  'accounts_same_state_and_reference_history_cross_engine',
  'postgres_accounts_snapshot_balance_matches_seven_fixture_goldens',
  'postgres_accounts_repeatable_snapshot_during_independent_commit',
  'postgres_accounts_reject_owner_and_nested_unit',
  'sqlite_accounts_anonymous_local_authority',
]);
export const accountHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      'packages/domain/src/accounts.ts',
      'packages/domain/src/index.ts',
      'packages/finance-ports/src/account-changes.ts',
      'packages/finance-ports/src/index.ts',
      'packages/storage-schema/src/account-changes.ts',
      'packages/storage-schema/src/index.ts',
      'packages/storage-schema/src/revision-adapters/account-writes.ts',
      'packages/persistence-postgres/src/account-changes.ts',
      'packages/persistence-postgres/src/modules/account-writes.ts',
      'infra/accounts/run.mjs',
      'infra/accounts/compose.yaml',
      'infra/accounts/protocol.mjs',
      'infra/accounts/evidence.mjs',
      'infra/scripts/accounts.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateAccountEvidence(report, { matchSources = true } = {}) {
  const exact = (v, keys) =>
    v &&
    JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());
  const fail = () => {
    throw Error('ACCOUNT_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'dataset_id',
      'dataset_version',
      'scope',
      'synthetic_only',
      'passed',
      'checks',
      'versions',
      'pending',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
    ]) ||
    report.format_version !== 1 ||
    report.dataset_id !== 'FIN-002' ||
    report.dataset_version !== 1 ||
    report.scope !== 'us040-shared-accounts' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, accountChecks) ||
    accountChecks.some((n) => report.checks[n] !== true) ||
    JSON.stringify(report.pending) !== JSON.stringify(pending)
  )
    fail();
  if (
    !exact(report.versions, ['node', 'postgresql', 'sqlite']) ||
    !/^24\./.test(report.versions.node) ||
    !/^18\.\d+$/.test(report.versions.postgresql) ||
    !/^3\.\d+\.\d+$/.test(report.versions.sqlite)
  )
    fail();
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    new Date(report.completed_at_utc).toISOString() !== report.completed_at_utc
  )
    fail();
  const hashes = accountHashes(),
    files = Object.keys(hashes);
  if (
    !exact(report.source_sha256, files) ||
    files.some((n) =>
      matchSources
        ? hashes[n] !== report.source_sha256[n]
        : !/^[a-f0-9]{64}$/.test(report.source_sha256[n]),
    )
  )
    fail();
  return report;
}
