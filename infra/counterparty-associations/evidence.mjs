import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  allocationHashes as revisionHashes,
  allocationChecks as revisionChecks,
} from '../allocations/evidence.mjs';
import { associationCases } from './protocol.mjs';
import {
  counterpartiesChecks,
  counterpartiesHashes,
} from '../counterparties/evidence.mjs';
export const associationChecks = Object.freeze([
  ...new Set([
    ...revisionChecks,
    ...counterpartiesChecks,
    ...['sqlite', 'postgresql'].flatMap((e) =>
      associationCases.map((n) => e + '_counterparty_associations_' + n),
    ),
    'counterparty_associations_same_financial_graph_cross_engine',
    'counterparty_associations_local_anonymous_and_revision_actor',
  ]),
]);
export const pending = Object.freeze([
  'desktop-counterparty-catalog-association-ui-and-native-parity',
  'cloud-product-write-outbox-and-feed',
  'counterparty-catalog-version-audit-and-durable-write-receipts',
  'human-homologations-after-complete-system-integration',
]);
export const associationHashes = () => ({
  ...revisionHashes(),
  ...counterpartiesHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/counterparty-associations.yml',
      'packages/domain/src/counterparty-associations.ts',
      'packages/domain/type-tests/counterparty-associations.ts',
      'packages/finance-ports/src/counterparty-associations.ts',
      'infra/counterparty-associations/run.mjs',
      'infra/counterparty-associations/clean.mjs',
      'infra/counterparty-associations/harness.mjs',
      'infra/counterparty-associations/protocol.mjs',
      'infra/counterparty-associations/evidence.mjs',
      'infra/counterparty-associations/compose.yaml',
      'infra/scripts/counterparty-associations.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateAssociationEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('ASSOCIATION_EVIDENCE_INVALID');
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
    r.scope !== 'us047-associations' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, associationChecks) ||
    associationChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = associationHashes(),
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
