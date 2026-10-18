import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionHashes, revisionChecks } from '../revisions/evidence.mjs';
import { manualCases } from './protocol.mjs';
export const manualChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    manualCases.map((n) => e + '_manual_' + n),
  ),
  'manual_same_versions_and_snapshots_cross_engine',
  'manual_local_without_cloud_identity',
]);
export const pending = Object.freeze([
  'desktop-manual-movement-ipc-and-ui',
  'cloud-feed-outbox-and-durable-receipts',
  'human-homologations-after-complete-system-integration',
]);
export const manualHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/manual-movements.yml',
      'infra/manual-movements/clean.mjs',
      'packages/domain/src/manual-movements.ts',
      'packages/finance-ports/src/manual-movements.ts',
      'infra/manual-movements/run.mjs',
      'infra/manual-movements/protocol.mjs',
      'infra/manual-movements/compose.yaml',
      'infra/manual-movements/evidence.mjs',
      'infra/scripts/manual-movements.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateManualEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('MANUAL_EVIDENCE_INVALID');
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
    r.scope !== 'us041-manual-movements' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, manualChecks) ||
    manualChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = manualHashes(),
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
