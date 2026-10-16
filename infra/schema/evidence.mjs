import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const gates = Object.freeze([
  'roles_and_default_deny',
  'migration_failure_rollback',
  'migration_idempotency_checksum_and_concurrency',
  'twelve_tables_forced_rls_and_composite_keys',
  'authorized_synthetic_seed',
  'cross_workspace_read_write_and_forged_context',
  'cross_workspace_foreign_keys',
  'required_fields_enums_ids_and_currency',
  'exact_i64_and_overflow',
  'date_and_utc_millisecond_roundtrip',
  'normalized_active_names',
  'subcategory_matches_category',
  'allocation_atomicity_and_extreme_amount',
  'concurrent_allocations_serialize',
  'revision_unique_immutable_and_soft_delete',
  'reference_and_account_card_constraints',
  'keyset_pagination_and_indexes',
  'restricted_roles_cannot_ddl_truncate_or_migrate',
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
export const pending = Object.freeze([
  'membership-policy-engine-and-account-scope',
  'typed-query-g07-query',
  'sqlcipher-and-cross-engine-g07-time',
  'revision-service-sync-and-tombstones',
  'product-runtime-integration',
]);
export const sources = Object.freeze([
  'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
  'apps/api/persistence/postgres/migrate.mjs',
  'infra/schema/compose.yaml',
  'infra/schema/fixtures.mjs',
  'infra/schema/homologate.mjs',
  'infra/schema/run.mjs',
  'infra/schema/evidence.mjs',
]);
export const sourceHashes = () =>
  Object.fromEntries(
    sources.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  );
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function validateSchemaEvidence(report) {
  const reject = () => {
    throw new Error('SCHEMA_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'started_at_utc',
      'completed_at_utc',
      'checks',
      'pending',
      'versions',
      'source_sha256',
      'passed',
      'resources_closed',
    ]) ||
    report.format_version !== 1 ||
    report.scope !== 'us020-postgresql-financial-core' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true
  )
    reject();
  if (
    !exact(report.checks, gates) ||
    gates.some((gate) => report.checks[gate] !== true)
  )
    reject();
  if (
    !Array.isArray(report.pending) ||
    [...report.pending].sort().join(',') !== [...pending].sort().join(',')
  )
    reject();
  if (
    !exact(report.versions, ['node', 'postgresql', 'pg']) ||
    !/^24\.\d+\.\d+$/.test(report.versions.node) ||
    !/^18\.\d+$/.test(report.versions.postgresql) ||
    !/^\d+\.\d+\.\d+$/.test(report.versions.pg)
  )
    reject();
  for (const key of ['started_at_utc', 'completed_at_utc'])
    if (
      typeof report[key] !== 'string' ||
      !Number.isFinite(Date.parse(report[key])) ||
      new Date(report[key]).toISOString() !== report[key]
    )
      reject();
  if (report.completed_at_utc < report.started_at_utc) reject();
  const hashes = sourceHashes();
  if (
    !exact(report.source_sha256, sources) ||
    sources.some((key) => hashes[key] !== report.source_sha256[key])
  )
    reject();
  return report;
}
