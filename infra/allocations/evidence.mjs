import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  classificationHashes as revisionHashes,
  classificationChecks as revisionChecks,
} from '../classification/evidence.mjs';
import { allocationCases } from './protocol.mjs';
export const allocationChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    allocationCases.map((n) => e + '_allocations_' + n),
  ),
  'allocations_same_financial_graph_cross_engine',
  'allocations_local_anonymous_and_revision_actor',
]);
export const pending = Object.freeze([
  'desktop-split-editor-ipc-ui-and-native-parity',
  'cloud-product-write-outbox-and-feed',
  'document-item-reconciliation-and-proportional-discounts',
  'human-homologations-after-complete-system-integration',
]);
export const allocationHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/allocations.yml',
      'packages/domain/src/allocations.ts',
      'packages/domain/type-tests/allocations.ts',
      'packages/finance-ports/src/allocations.ts',
      'infra/allocations/run.mjs',
      'infra/allocations/clean.mjs',
      'infra/allocations/harness.mjs',
      'infra/allocations/protocol.mjs',
      'infra/allocations/evidence.mjs',
      'infra/allocations/compose.yaml',
      'infra/scripts/allocations.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateAllocationEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('ALLOCATION_EVIDENCE_INVALID');
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
    r.scope !== 'us046-allocations' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, allocationChecks) ||
    allocationChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = allocationHashes(),
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
