import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionHashes } from '../revisions/evidence.mjs';
import { invariantCases } from './scenarios.mjs';
export const invariantChecks = Object.freeze([
  'deterministic_fixture_and_generation',
  'migrations_v2',
  'sqlite_schema_corpus',
  'postgresql_schema_corpus',
  ...invariantCases,
  'sqlite_reopen',
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
export const invariantHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      'packages/domain/src/balances.ts',
      'packages/domain/src/reports.ts',
      'packages/storage-schema/src/synthetic-probe.ts',
      'packages/storage-schema/src/generated-probe.ts',
      'infra/schema/us021-corpus.mjs',
      'infra/fixtures/evidence.mjs',
      ...[
        'oracle.mjs',
        'scenarios.mjs',
        'protocol.mjs',
        'evidence.mjs',
        'run.mjs',
        'clean.mjs',
        'compose.yaml',
      ].map((name) => 'infra/invariants/' + name),
      'infra/scripts/invariants.test.mjs',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateInvariantEvidence(
  report,
  { matchSources = true } = {},
) {
  const exact = (value, names) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...names].sort());
  const fail = () => {
    throw Error('INVARIANT_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'dataset_id',
      'dataset_version',
      'corpus_id',
      'corpus_version',
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
    report.corpus_id !== 'FIN-INVARIANTS-001' ||
    report.corpus_version !== 1 ||
    report.scope !== 'us027-cross-engine-invariants' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, invariantChecks) ||
    invariantChecks.some((name) => report.checks[name] !== true) ||
    !exact(report.versions, ['node', 'postgresql', 'sqlite']) ||
    !/^24\./.test(report.versions.node) ||
    !/^18\.\d+$/.test(report.versions.postgresql) ||
    !/^3\.\d+\.\d+$/.test(report.versions.sqlite) ||
    JSON.stringify(report.pending) !==
      JSON.stringify([
        'product-write-routes-feed-outbox-and-idempotency',
        'native-product-runtime-integration',
        'document-search-product-schema-and-ct08-integration',
      ]) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    fail();
  const hashes = invariantHashes(),
    files = Object.keys(hashes);
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
