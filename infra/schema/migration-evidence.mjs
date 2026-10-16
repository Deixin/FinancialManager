import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const migrationGates = Object.freeze([
  'fresh_upgrade_and_supported_downgrade',
  'sqlite_process_interruption_up_and_down',
  'postgres_process_interruption_up_and_down',
  'serialized_concurrent_migrators',
  'checksum_history_and_unsupported_plans',
  'financial_corpus_and_snapshots_preserved',
  'legacy_clients_fail_closed_on_new_schema',
  'rls_and_metadata_privileges_preserved',
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
const sources = [
  'packages/storage-schema/src/index.ts',
  'packages/storage-schema/src/generated.ts',
  'packages/storage-schema/src/migration-plan.ts',
  'packages/storage-schema/src/migrations.ts',
  'packages/storage-schema/src/generated-migrations.ts',
  'packages/storage-schema/sqlite/migrations/0001-financial-core.sql',
  'packages/storage-schema/sqlite/migrations/0002-balance-reference-lookup.up.sql',
  'packages/storage-schema/sqlite/migrations/0002-balance-reference-lookup.down.sql',
  'apps/api/persistence/postgres/migrate.mjs',
  'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.up.sql',
  'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.down.sql',
  'infra/schema/generate-migrations.mjs',
  'infra/schema/postgres-migrations.mjs',
  'infra/schema/migration-worker.mjs',
  'infra/schema/migrations.mjs',
  'infra/schema/migrations-compose.yaml',
  'infra/schema/migration-evidence.mjs',
  'infra/schema/sqlite-adapter.mjs',
  'infra/schema/dual-postgres.mjs',
  'infra/schema/us021-corpus.mjs',
  'packages/storage-schema/src/synthetic-probe.ts',
  'packages/storage-schema/src/generated-probe.ts',
];
export const migrationHashes = () =>
  Object.fromEntries(
    sources.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
export function validateMigrationEvidence(report) {
  const exactKeys = (object, keys) =>
    object &&
    JSON.stringify(Object.keys(object).sort()) ===
      JSON.stringify([...keys].sort());
  const fail = () => {
    throw new Error('MIGRATION_EVIDENCE_INVALID');
  };
  if (
    !exactKeys(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'passed',
      'checks',
      'engines',
      'cases_per_engine',
      'interruptions_per_engine',
      'source_sha256',
      'completed_at_utc',
      'resources_closed',
      'pending',
    ]) ||
    report.format_version !== 1 ||
    report.scope !== 'us022-transactional-dual-engine-migrations' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exactKeys(report.checks, migrationGates) ||
    !migrationGates.every((name) => report.checks[name] === true) ||
    !exactKeys(report.engines, ['postgresql', 'sqlite']) ||
    !/^18\.\d+$/.test(report.engines.postgresql) ||
    !/^3\.\d+\.\d+$/.test(report.engines.sqlite) ||
    report.cases_per_engine !== 33 ||
    report.interruptions_per_engine !== 6 ||
    typeof report.completed_at_utc !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    JSON.stringify(report.pending) !==
      JSON.stringify([
        'product-vault-and-native-host-integration',
        'destructive-migrations-with-protected-backup',
        'api-client-version-adapters',
      ]) ||
    !exactKeys(report.source_sha256, sources)
  )
    fail();
  const hashes = migrationHashes();
  if (!sources.every((name) => report.source_sha256[name] === hashes[name]))
    fail();
  return report;
}
