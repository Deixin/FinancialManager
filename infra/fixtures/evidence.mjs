import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const fixtureChecks = Object.freeze([
  'deterministic_fixture_and_generation',
  'migrations_v2',
  'atomic_load_rollback',
  'same_dataset_persisted',
  'golden_balances_reports_allocations',
  'exact_i64_and_reference_cutoffs',
  'duplicate_load_preserves_data',
  'workspace_isolation_with_rls',
  'document_search_vector_only',
  'sqlite_reopen',
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
const files = [
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  '.prettierrc.json',
  'packages/test-fixtures/package.json',
  'packages/test-fixtures/fixtures/fin-002.json',
  'packages/test-fixtures/src/canonical.ts',
  'packages/test-fixtures/src/generated/canonical.ts',
  'infra/fixtures/model.mjs',
  'infra/fixtures/generate.mjs',
  'infra/fixtures/loader.mjs',
  'infra/fixtures/totals.mjs',
  'infra/fixtures/probe.mjs',
  'infra/fixtures/run.mjs',
  'infra/fixtures/compose.yaml',
  'infra/fixtures/evidence.mjs',
  'infra/fixtures/clean.mjs',
  'infra/scripts/canonical-fixtures.test.mjs',
  'infra/schema/dual-postgres.mjs',
  'infra/schema/sqlite-adapter.mjs',
  'infra/schema/postgres-migrations.mjs',
  'apps/api/persistence/postgres/migrate.mjs',
  'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.up.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.down.sql',
  'packages/storage-schema/sqlite/migrations/0001-financial-core.sql',
  'packages/storage-schema/src/generated-migrations.ts',
  'packages/storage-schema/src/migrations.ts',
  'packages/storage-schema/src/index.ts',
  'packages/storage-schema/src/migration-plan.ts',
  'packages/domain/src/model.ts',
  'packages/domain/src/money.ts',
  'packages/domain/src/balances.ts',
  'packages/domain/src/reports.ts',
];
export const fixtureHashes = () =>
  Object.fromEntries(
    files.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
export function validateFixtureEvidence(report, { matchSources = true } = {}) {
  const exact = (value, names) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...names].sort());
  const fail = () => {
    throw Error('FIXTURE_EVIDENCE_INVALID');
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
    report.scope !== 'us025-canonical-dual-engine-fixtures' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, fixtureChecks) ||
    fixtureChecks.some((key) => report.checks[key] !== true) ||
    !exact(report.versions, ['node', 'postgresql', 'sqlite']) ||
    !/^24\./.test(report.versions.node) ||
    !/^18\.\d+$/.test(report.versions.postgresql) ||
    !/^3\.\d+\.\d+$/.test(report.versions.sqlite) ||
    JSON.stringify(report.pending) !==
      JSON.stringify([
        'document-search-product-schema-and-ct08-integration',
        'native-runtime-and-full-us027-suite',
      ]) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    fail();
  const hashes = fixtureHashes();
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
