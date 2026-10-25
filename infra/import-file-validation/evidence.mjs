import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const scope = 'us051-defensive-files';
export const checks = Object.freeze([
  'node_hostile_corpus',
  'chromium_same_corpus',
  'csv_independent_oracle',
  'xml_independent_oracle',
  'size_rows_fields_columns_depth_nodes_bounds',
  'isolated_node_deadline_memory',
  'no_browser_egress_storage_execution',
  'safe_errors_metadata_only',
  'no_input_mutation',
  'no_archive_expansion',
  'ofx_normalization_node_chromium_parity',
  'ofx_independent_xml_hash_and_golden_oracles',
  'ofx_10000_rows_and_invalid_rows_retained',
]);
export const pending = Object.freeze([
  'desktop-ofx-normalization-native-integration-and-rust-parity',
  'xlsx-pdf-fiscal-xml-bounded-readers',
  'other-parsers-staging-review-and-financial-commit',
  'cloud-mobile-runtime-integration-and-human-homologation',
]);
export function sourceHashes() {
  return Object.fromEntries(
    [
      '.github/workflows/import-file-validation.yml',
      'packages/importers/src/index.ts',
      'packages/importers/src/file-validation.ts',
      'packages/importers/src/file-validation-policy.ts',
      'packages/importers/src/file-validation-csv.ts',
      'packages/importers/src/file-validation-ofx.ts',
      'packages/importers/src/ofx-parser.ts',
      'packages/importers/src/ofx-contract.ts',
      'packages/importers/src/ofx-reader.ts',
      'packages/importers/src/ofx-normalization.ts',
      'infra/ofx-parser/corpus.mjs',
      'infra/ofx-parser/oracle.mjs',
      'packages/importers/package.json',
      'packages/importers/README.md',
      'packages/importers/tsconfig.json',
      'infra/import-file-validation/corpus.mjs',
      'infra/import-file-validation/probe.mjs',
      'infra/import-file-validation/run.mjs',
      'infra/import-file-validation/evidence.mjs',
      'infra/import-file-validation/oracle.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  );
}
export function validateFileEvidence(report, { matchSources = true } = {}) {
  const exact = (value, keys) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const fail = () => {
    throw Error('FILE_VALIDATION_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'passed',
      'checks',
      'pending',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
      'versions',
      'cases',
      'ofx_cases',
      'metrics',
    ]) ||
    report.format_version !== 2 ||
    report.scope !== scope ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, checks) ||
    checks.some((key) => report.checks[key] !== true) ||
    JSON.stringify(report.pending) !== JSON.stringify(pending) ||
    !exact(report.versions, ['node', 'chromium']) ||
    !/^24\./.test(report.versions.node) ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(report.versions.chromium) ||
    !Number.isSafeInteger(report.cases) ||
    report.cases < 80 ||
    !Number.isSafeInteger(report.ofx_cases) ||
    report.ofx_cases < 65 ||
    !exact(report.metrics, [
      'node_duration_ms',
      'ofx_duration_ms',
      'peak_rss_bytes',
      'browser_heap_bytes',
    ]) ||
    !Number.isFinite(report.metrics.node_duration_ms) ||
    report.metrics.node_duration_ms < 0 ||
    report.metrics.node_duration_ms > 30000 ||
    !Number.isFinite(report.metrics.ofx_duration_ms) ||
    report.metrics.ofx_duration_ms <= 0 ||
    report.metrics.ofx_duration_ms > 30000 ||
    !Number.isSafeInteger(report.metrics.peak_rss_bytes) ||
    report.metrics.peak_rss_bytes <= 0 ||
    report.metrics.peak_rss_bytes > 256 * 1024 * 1024 ||
    !Number.isSafeInteger(report.metrics.browser_heap_bytes) ||
    report.metrics.browser_heap_bytes <= 0 ||
    report.metrics.browser_heap_bytes > 128 * 1024 * 1024 ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    new Date(report.completed_at_utc).toISOString() !== report.completed_at_utc
  )
    fail();
  const hashes = sourceHashes();
  if (
    !exact(report.source_sha256, Object.keys(hashes)) ||
    Object.keys(hashes).some((file) =>
      matchSources
        ? report.source_sha256[file] !== hashes[file]
        : !/^[a-f0-9]{64}$/.test(report.source_sha256[file]),
    )
  )
    fail();
  return report;
}
