import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { queryGates } from './kysely-gate.mjs';
import { repositoryGates } from './repository-probe.mjs';
export const repositoryChecks = Object.freeze([
  ...queryGates,
  ...repositoryGates,
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
const files = [
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'packages/config/workspace-boundaries.json',
  'packages/config/data-access-boundaries.json',
  'packages/finance-ports/package.json',
  'packages/finance-ports/tsconfig.json',
  'packages/finance-ports/src/index.ts',
  'packages/persistence-postgres/package.json',
  'packages/persistence-postgres/tsconfig.json',
  'packages/persistence-postgres/src/index.ts',
  'packages/persistence-postgres/src/internal/database.ts',
  'packages/persistence-postgres/src/internal/driver.ts',
  'packages/persistence-postgres/src/internal/scope.ts',
  'packages/persistence-postgres/src/internal/projection.ts',
  'packages/persistence-postgres/src/modules/accounts.ts',
  'packages/persistence-postgres/src/modules/transactions.ts',
  'apps/api/src/read-model.ts',
  'apps/api/src/index.ts',
  'apps/api/package.json',
  'apps/worker/src/read-model.ts',
  'apps/worker/src/index.ts',
  'apps/worker/package.json',
  'infra/scripts/check-data-access.mjs',
  'infra/query/run.mjs',
  'infra/query/kysely-gate.mjs',
  'infra/query/gate-types.ts',
  'infra/query/port-types.ts',
  'infra/query/tsconfig.gate.json',
  'infra/query/repository-probe.mjs',
  'infra/query/compose.yaml',
  'infra/query/evidence.mjs',
  'infra/schema/dual-postgres.mjs',
  'infra/schema/postgres-migrations.mjs',
  'apps/api/persistence/postgres/migrate.mjs',
  'packages/storage-schema/src/migration-plan.ts',
  'packages/storage-schema/src/migrations.ts',
  'infra/schema/us021-corpus.mjs',
  'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.up.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.down.sql',
];
export const repositoryHashes = () =>
  Object.fromEntries(
    files.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
export function validateRepositoryEvidence(
  report,
  { matchSources = true } = {},
) {
  const exact = (object, names) =>
    object &&
    JSON.stringify(Object.keys(object).sort()) ===
      JSON.stringify([...names].sort());
  const fail = () => {
    throw new Error('REPOSITORY_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'passed',
      'checks',
      'versions',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
      'pending',
    ]) ||
    report.format_version !== 1 ||
    report.scope !== 'us024-scoped-postgresql-repositories' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, repositoryChecks) ||
    repositoryChecks.some((name) => report.checks[name] !== true) ||
    !exact(report.versions, ['node', 'kysely', 'pg', 'postgresql']) ||
    !/^24\./.test(report.versions.node) ||
    report.versions.kysely !== '0.29.6' ||
    report.versions.pg !== '8.23.1' ||
    !/^18\.\d+$/.test(report.versions.postgresql) ||
    JSON.stringify(report.pending) !==
      JSON.stringify([
        'product-policy-engine-and-http-handlers',
        'write-ports-with-revisions-idempotency-outbox',
        'native-product-adapters',
      ]) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    fail();
  const hashes = repositoryHashes();
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
