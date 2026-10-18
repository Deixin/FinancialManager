import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  taxonomyHashes as revisionHashes,
  taxonomyChecks as revisionChecks,
} from '../taxonomy/evidence.mjs';
import { classificationCases } from './protocol.mjs';
export const classificationChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    classificationCases.map((n) => e + '_classification_' + n),
  ),
  'classification_same_financial_graph_cross_engine',
  'classification_local_anonymous_and_revision_actor',
]);
export const pending = Object.freeze([
  'desktop-classification-ipc-ui-and-native-parity',
  'cloud-product-write-outbox-and-feed',
  'classification-snapshot-filter-host-authorization-and-complete-coverage',
  'split-allocation-editor-us046',
  'human-homologations-after-complete-system-integration',
]);
export const classificationHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/classification.yml',
      'packages/domain/src/classification.ts',
      'packages/domain/type-tests/classification.ts',
      'packages/finance-ports/src/classification.ts',
      'infra/classification/run.mjs',
      'infra/classification/clean.mjs',
      'infra/classification/harness.mjs',
      'infra/classification/protocol.mjs',
      'infra/classification/evidence.mjs',
      'infra/classification/compose.yaml',
      'infra/scripts/classification.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateClassificationEvidence(
  r,
  { matchSources = true } = {},
) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('CLASSIFICATION_EVIDENCE_INVALID');
    };
  if (
    !exact(r, [
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
    r.format_version !== 1 ||
    r.dataset_id !== 'FIN-002' ||
    r.dataset_version !== 1 ||
    r.scope !== 'us045-classification' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, classificationChecks) ||
    classificationChecks.some((k) => r.checks[k] !== true) ||
    JSON.stringify(r.pending) !== JSON.stringify(pending)
  )
    fail();
  if (
    !exact(r.versions, ['node', 'postgresql', 'sqlite']) ||
    !/^24\./.test(r.versions.node) ||
    !/^18\.\d+$/.test(r.versions.postgresql) ||
    !/^3\.\d+\.\d+$/.test(r.versions.sqlite) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.completed_at_utc) ||
    !Number.isFinite(Date.parse(r.completed_at_utc)) ||
    new Date(r.completed_at_utc).toISOString() !== r.completed_at_utc
  )
    fail();
  const hashes = classificationHashes(),
    files = Object.keys(hashes);
  if (
    !exact(r.source_sha256, files) ||
    files.some((k) =>
      matchSources
        ? r.source_sha256[k] !== hashes[k]
        : !/^[a-f0-9]{64}$/.test(r.source_sha256[k]),
    )
  )
    fail();
  return r;
}
