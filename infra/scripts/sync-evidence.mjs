export const requiredSyncChecks = [
  'migration_atomic_checksum_and_force_rls',
  'int64_workspace_account_and_session_boundaries',
  'durable_outbox_abrupt_restart_and_atomic_enqueue',
  'disconnection_retains_pending_proposal',
  'lost_response_retry_is_idempotent',
  'idempotency_payload_and_actor_binding',
  'independent_fields_merge_without_clock_priority',
  'same_field_conflict_preserves_base_local_remote',
  'authorized_resolution_creates_audited_revision',
  'changed_then_reverted_field_still_conflicts',
  'concurrent_delete_and_edit_require_resolution',
  'pull_data_and_cursor_rollback_after_process_death',
  'server_failure_rolls_back_revision_feed_and_receipt',
  'concurrent_push_commit_order_and_no_silent_loss',
  'immutable_paginated_feed_and_convergence',
  'revoked_member_cannot_push_pull_or_replay',
  'revoked_device_cannot_replay',
  'revoked_account_scope_cannot_read_or_replay',
  'expired_cursor_requires_snapshot',
  'generation_change_quarantines_old_outbox',
  'docker_loopback_and_ephemeral_storage',
  'operational_logs_sanitized',
];
export function validateSyncEvidence(report) {
  const fields = [
    'format_version',
    'synthetic_only',
    'scope',
    'passed',
    'checks',
    'schema_sha256',
    'image_sha256',
    'postgres_version',
    'independent_client_processes',
    'concurrent_pushes',
    'completed_at_utc',
    'containers_and_synthetic_secrets_removed',
    'client_stores_removed',
    'versions',
  ];
  if (
    report?.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.scope !== 'two-client-sync-spike' ||
    report.passed !== true ||
    report.containers_and_synthetic_secrets_removed !== true ||
    report.client_stores_removed !== true ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    report.postgres_version !== '18.6' ||
    report.concurrent_pushes !== 12 ||
    !Number.isInteger(report.independent_client_processes) ||
    report.independent_client_processes < 20
  )
    throw new Error('SYNC_EVIDENCE_INCOMPLETE');
  for (const name of requiredSyncChecks)
    if (report.checks?.[name] !== true) throw new Error('SYNC_CHECK_MISSING');
  if (
    Object.keys(report).some((name) => !fields.includes(name)) ||
    Object.keys(report.checks).some(
      (name) => !requiredSyncChecks.includes(name),
    )
  )
    throw new Error('SYNC_UNEXPECTED_FIELD');
  for (const name of ['schema_sha256', 'image_sha256'])
    if (!/^[0-9a-f]{64}$/.test(report[name] ?? ''))
      throw new Error('SYNC_HASH_REQUIRED');
  if (
    !report.versions ||
    Object.keys(report.versions).length !== 2 ||
    ['node', 'pg'].some(
      (key) => !/^\d+\.\d+\.\d+$/.test(report.versions[key] ?? ''),
    )
  )
    throw new Error('SYNC_UNEXPECTED_VERSION');
  return report;
}
