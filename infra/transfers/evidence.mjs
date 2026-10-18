import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionHashes, revisionChecks } from '../revisions/evidence.mjs';
import { transferCases } from './protocol.mjs';
export const transferChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    transferCases.map((n) => e + '_transfer_' + n),
  ),
  'transfer_same_versions_and_snapshots_cross_engine',
  'transfer_local_without_cloud_identity',
]);
export const pending = Object.freeze([
  'desktop-transfer-ipc-and-ui',
  'cloud-feed-outbox-and-durable-receipts',
  'human-homologations-after-complete-system-integration',
]);
export const transferHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/transfers.yml',
      'infra/transfers/clean.mjs',
      'packages/domain/src/transfers.ts',
      'packages/finance-ports/src/transfers.ts',
      'infra/transfers/run.mjs',
      'infra/transfers/protocol.mjs',
      'infra/transfers/compose.yaml',
      'infra/transfers/evidence.mjs',
      'infra/scripts/transfers.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateTransferEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('TRANSFER_EVIDENCE_INVALID');
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
    r.scope !== 'us042-transfers' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, transferChecks) ||
    transferChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = transferHashes(),
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
