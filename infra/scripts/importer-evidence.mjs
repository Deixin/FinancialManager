export const importerChecks = [
  'atomic_migration_checksum_and_reopen',
  'csv_10k_preview_benchmark',
  'ofx_sgml_10k_preview_benchmark',
  'ofx_xml_10k_preview_benchmark',
  'exact_normalization_signs_dates_and_provenance',
  'explicit_csv_mapping_debit_credit_and_literal_formulas',
  'utf8_bom_and_explicit_windows1252',
  'invalid_rows_are_visible_and_preserved',
  'duplicates_divergence_and_legitimate_equal_purchases',
  'type_structure_and_encoding_rejections',
  'xxe_entities_and_unknown_ofx_layout_rejected',
  'size_row_record_column_and_time_limits',
  'progress_and_mid_parse_cancellation_roll_back',
  'abrupt_worker_death_recovers_empty_staging',
  'cancel_completed_500_row_preview_leaves_ledger_unchanged',
  'operational_logs_have_no_source_payload',
  'staging_only_and_financial_ledger_byte_identical',
];
const exactKeys = (object, keys) =>
  object &&
  Object.keys(object).length === keys.length &&
  Object.keys(object).every((key) => keys.includes(key));
const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateImporterEvidence(report) {
  if (
    !exactKeys(report, [
      'format_version',
      'synthetic_only',
      'scope',
      'passed',
      'checks',
      'benchmarks',
      'migration_sha256',
      'source_sha256',
      'completed_at_utc',
      'artifacts_removed',
      'versions',
      'reference_machine',
    ]) ||
    report.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.scope !== 'ofx-csv-10k-parser-spike' ||
    report.passed !== true ||
    report.artifacts_removed !== true ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    !hash(report.source_sha256) ||
    !hash(report.migration_sha256)
  )
    throw new Error('IMPORTER_EVIDENCE_INCOMPLETE');
  if (
    !exactKeys(report.checks, importerChecks) ||
    importerChecks.some((key) => report.checks[key] !== true)
  )
    throw new Error('IMPORTER_CHECK_MISSING');
  if (!Array.isArray(report.benchmarks) || report.benchmarks.length !== 3)
    throw new Error('BENCHMARK_REQUIRED');
  const layouts = [
    'csv-explicit-mapping-v1',
    'ofx-102-bank-card-v1',
    'ofx-2xml-bank-card-v1',
  ];
  for (const [index, result] of report.benchmarks.entries()) {
    if (
      !exactKeys(result, [
        'layout',
        'rows',
        'input_bytes',
        'samples_ms',
        'peak_rss_kib',
        'source_sha256',
        'normalized_sha256',
      ]) ||
      result.layout !== layouts[index] ||
      result.rows !== 10000 ||
      !Number.isInteger(result.input_bytes) ||
      result.input_bytes < 1 ||
      result.input_bytes > 16 * 1024 * 1024 ||
      !Array.isArray(result.samples_ms) ||
      result.samples_ms.length !== 3 ||
      result.samples_ms.some(
        (ms) => !Number.isInteger(ms) || ms < 1 || ms > 30000,
      ) ||
      !Number.isInteger(result.peak_rss_kib) ||
      result.peak_rss_kib < 1 ||
      result.peak_rss_kib > 256 * 1024 ||
      !hash(result.source_sha256) ||
      !hash(result.normalized_sha256)
    )
      throw new Error('BENCHMARK_FAILED');
  }
  if (
    !exactKeys(report.versions, ['node', 'sqlite', 'csv_parse', 'sax']) ||
    !Object.values(report.versions).every((version) =>
      /^\d+\.\d+\.\d+$/.test(version),
    ) ||
    report.versions.csv_parse !== '7.0.3' ||
    report.versions.sax !== '1.6.1'
  )
    throw new Error('UNEXPECTED_PARSER_VERSION');
  const machine = report.reference_machine;
  if (
    !exactKeys(machine, [
      'platform',
      'arch',
      'cpu_model',
      'logical_cpus',
      'memory_gib',
    ]) ||
    !['win32', 'linux', 'darwin'].includes(machine.platform) ||
    !['x64', 'arm64'].includes(machine.arch) ||
    typeof machine.cpu_model !== 'string' ||
    machine.cpu_model.length > 160 ||
    !Number.isInteger(machine.logical_cpus) ||
    machine.logical_cpus < 1 ||
    !Number.isInteger(machine.memory_gib) ||
    machine.memory_gib < 1
  )
    throw new Error('REFERENCE_MACHINE_REQUIRED');
  return report;
}
