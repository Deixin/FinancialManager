import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  categoryHashes as revisionHashes,
  categoryChecks as revisionChecks,
} from '../categories/evidence.mjs';
import { counterpartyCases } from './protocol.mjs';
export const counterpartiesChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    counterpartyCases.map((n) => e + '_counterparties_' + n),
  ),
  'counterparties_same_catalog_cross_engine',
  'sqlite_counterparties_local_without_cloud_identity',
  'postgres_counterparties_rls_owner_nested_unit',
]);
export const pending = Object.freeze([
  'counterparty-versioned-transaction-association',
  'desktop-counterparty-ipc-and-ui',
  'counterparty-catalog-version-audit-cloud-feed-and-outbox',
  'human-homologations-after-complete-system-integration',
]);
export const counterpartiesHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/counterparties.yml',
      'packages/domain/src/counterparties.ts',
      'packages/domain/type-tests/counterparties.ts',
      'packages/finance-ports/src/counterparties.ts',
      'packages/storage-schema/src/counterparty-changes.ts',
      'packages/storage-schema/src/revision-adapters/counterparty-writes.ts',
      'packages/persistence-postgres/src/counterparty-changes.ts',
      'packages/persistence-postgres/src/modules/counterparty-writes.ts',
      'infra/counterparties/run.mjs',
      'infra/counterparties/clean.mjs',
      'infra/counterparties/harness.mjs',
      'infra/counterparties/protocol.mjs',
      'infra/counterparties/evidence.mjs',
      'infra/counterparties/compose.yaml',
      'infra/scripts/counterparties.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateCounterpartyEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('COUNTERPARTY_EVIDENCE_INVALID');
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
    r.scope !== 'us047-counterparties' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, counterpartiesChecks) ||
    counterpartiesChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = counterpartiesHashes(),
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
