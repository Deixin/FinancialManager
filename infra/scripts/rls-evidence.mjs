export const requiredRlsChecks = [
  'schema_migration_and_force_rls',
  'migration_rollback_and_checksum',
  'runtime_least_privilege',
  'missing_partial_and_invalid_context',
  'authorized_crud',
  'int64_exact_roundtrip',
  'unfiltered_select_update_delete_isolation',
  'cross_workspace_insert_update_upsert_rejected',
  'account_scope_join_total_export',
  'read_only_and_export_capability',
  'composite_foreign_key',
  'revocation_rechecked_per_statement',
  'pool_reuse_commit_rollback_and_session_reset',
  'prepared_statement_context_reuse',
  'concurrent_pool_isolation',
  'savepoint_rollback_preserves_context',
  'connection_loss_rolls_back_and_replaces_socket',
  'owner_force_and_escalation_rejected',
  'docker_loopback_and_ephemeral_storage',
  'operational_logs_sanitized',
];

export function validateRlsEvidence(report) {
  if (
    report?.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.scope !== 'postgresql-rls-pool-spike' ||
    report.passed !== true ||
    report.containers_and_synthetic_secrets_removed !== true ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    report.postgres_version !== '18.6' ||
    report.concurrent_requests !== 48
  )
    throw new Error('RLS_EVIDENCE_INCOMPLETE');
  for (const name of requiredRlsChecks)
    if (report.checks?.[name] !== true)
      throw new Error('RLS_CHECK_MISSING: ' + name);
  const fields = [
    'format_version',
    'synthetic_only',
    'scope',
    'passed',
    'checks',
    'schema_sha256',
    'image_sha256',
    'postgres_version',
    'concurrent_requests',
    'completed_at_utc',
    'containers_and_synthetic_secrets_removed',
    'versions',
  ];
  if (
    Object.keys(report).some((name) => !fields.includes(name)) ||
    Object.keys(report.checks).some((name) => !requiredRlsChecks.includes(name))
  )
    throw new Error('RLS_UNEXPECTED_FIELD');
  for (const name of ['schema_sha256', 'image_sha256'])
    if (!/^[0-9a-f]{64}$/.test(report[name] ?? ''))
      throw new Error('RLS_HASH_REQUIRED');
  const versionKeys = ['node', 'pg'];
  if (
    !report.versions ||
    Object.keys(report.versions).length !== 2 ||
    versionKeys.some(
      (name) =>
        typeof report.versions[name] !== 'string' ||
        !/^\d+\.\d+\.\d+$/.test(report.versions[name]),
    )
  )
    throw new Error('RLS_UNEXPECTED_VERSION');
  return report;
}
