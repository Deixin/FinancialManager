export const physicalChecks = [
  'atomic_migration_and_checksum',
  'uuid_text_roundtrip_uniqueness_and_v7_vector_order',
  'uuid_noncanonical_and_nil_rejected',
  'composite_workspace_foreign_key',
  'utc_millisecond_text_roundtrip_and_order',
  'offset_precision_and_invalid_instants_rejected',
  'financial_date_calendar_validation',
  'decimal_exact_text_preserves_precision',
  'rollback_and_persistent_reopen',
];
export function validatePhysicalEvidence(report) {
  const keys = [
    'format_version',
    'synthetic_only',
    'scope',
    'passed',
    'checks',
    'schema_sha256',
    'sqlite_version',
    'node_version',
    'completed_at_utc',
    'database_removed',
  ];
  if (
    report?.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.scope !== 'sqlite-physical-representations' ||
    report.passed !== true ||
    report.database_removed !== true ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    !/^[a-f0-9]{64}$/.test(report.schema_sha256 ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(report.node_version ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(report.sqlite_version ?? '') ||
    Object.keys(report).some((key) => !keys.includes(key)) ||
    !report.checks ||
    Object.keys(report.checks).length !== physicalChecks.length ||
    physicalChecks.some((key) => report.checks[key] !== true)
  )
    throw new Error('PHYSICAL_EVIDENCE_INCOMPLETE');
  return report;
}
