import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionCases } from './scenarios.mjs';
export const revisionChecks = Object.freeze([
  'deterministic_fixture_and_generation',
  'migrations_v2',
  'unit_types_and_module_boundaries',
  ...['sqlite', 'postgresql'].flatMap((engine) =>
    revisionCases.map((name) => engine + '_' + name),
  ),
  'same_financial_goldens',
  'sqlite_local_without_cloud_identity',
  'postgres_backend_loss_rollback',
  'api_worker_factories_and_reauthorization',
  'sqlite_reopen',
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
const files = [
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'packages/config/workspace-boundaries.json',
  'packages/config/data-access-boundaries.json',
  'packages/domain/package.json',
  'packages/domain/src/revisions.ts',
  'packages/domain/src/model.ts',
  'packages/domain/src/money.ts',
  'packages/domain/src/time.ts',
  'packages/domain/src/composites.ts',
  'packages/finance-ports/package.json',
  'packages/finance-ports/src/revisions.ts',
  'packages/persistence-postgres/package.json',
  'packages/persistence-postgres/src/revisions.ts',
  'packages/persistence-postgres/src/internal/database.ts',
  'packages/persistence-postgres/src/internal/driver.ts',
  'packages/persistence-postgres/src/internal/scope.ts',
  'packages/persistence-postgres/src/internal/unit-scope.ts',
  'packages/persistence-postgres/src/internal/projection.ts',
  'packages/persistence-postgres/src/modules/accounts.ts',
  'packages/persistence-postgres/src/modules/workspaces.ts',
  'packages/persistence-postgres/src/modules/transaction-writes.ts',
  'packages/persistence-postgres/src/index.ts',
  'packages/storage-schema/package.json',
  'packages/storage-schema/src/revisions.ts',
  'packages/storage-schema/src/revision-adapters/accounts.ts',
  'packages/storage-schema/src/revision-adapters/workspaces.ts',
  'packages/storage-schema/src/revision-adapters/transactions.ts',
  'packages/storage-schema/src/migrations.ts',
  'packages/storage-schema/src/migration-plan.ts',
  'packages/storage-schema/src/generated-migrations.ts',
  'apps/api/src/revision-model.ts',
  'apps/api/src/index.ts',
  'apps/worker/src/revision-model.ts',
  'apps/worker/src/index.ts',
  'infra/scripts/check-data-access.mjs',
  'infra/revisions/scenarios.mjs',
  'infra/revisions/harness.mjs',
  'infra/revisions/protocol.mjs',
  'infra/revisions/run.mjs',
  'infra/revisions/compose.yaml',
  'infra/revisions/types.ts',
  'infra/revisions/tsconfig.json',
  'infra/revisions/evidence.mjs',
  'infra/revisions/clean.mjs',
  'infra/scripts/revisions.test.mjs',
  'infra/fixtures/loader.mjs',
  'infra/fixtures/totals.mjs',
  'packages/test-fixtures/fixtures/fin-002.json',
  'packages/test-fixtures/src/generated/canonical.ts',
  'infra/schema/dual-postgres.mjs',
  'infra/schema/sqlite-adapter.mjs',
  'infra/schema/postgres-migrations.mjs',
  'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.up.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.down.sql',
  'packages/storage-schema/sqlite/migrations/0001-financial-core.sql',
];
export const revisionHashes = () =>
  Object.fromEntries(
    files.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
export function validateRevisionEvidence(report, { matchSources = true } = {}) {
  const exact = (value, names) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...names].sort());
  const fail = () => {
    throw Error('REVISION_EVIDENCE_INVALID');
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
    report.scope !== 'us026-transaction-revisions' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, revisionChecks) ||
    revisionChecks.some((name) => report.checks[name] !== true) ||
    !exact(report.versions, ['node', 'postgresql', 'sqlite']) ||
    !/^24\./.test(report.versions.node) ||
    !/^18\.\d+$/.test(report.versions.postgresql) ||
    !/^3\.\d+\.\d+$/.test(report.versions.sqlite) ||
    (JSON.stringify(report.pending) !==
      JSON.stringify([
        'product-write-routes-feed-outbox-and-idempotency',
        'native-product-runtime-integration',
      ]) &&
      (matchSources ||
        JSON.stringify(report.pending) !==
          JSON.stringify([
            'product-write-routes-feed-outbox-and-idempotency',
            'native-runtime-and-full-us027-suite',
          ]))) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    fail();
  const hashes = revisionHashes();
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
