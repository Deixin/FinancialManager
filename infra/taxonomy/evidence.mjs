import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  categoryHashes as revisionHashes,
  categoryChecks as revisionChecks,
} from '../categories/evidence.mjs';
import { taxonomyCases } from './protocol.mjs';
export const taxonomyChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    taxonomyCases.map((n) => e + '_taxonomy_' + n),
  ),
  'taxonomy_same_catalog_cross_engine',
  'sqlite_taxonomy_local_without_cloud_identity',
  'postgres_taxonomy_rls_owner_nested_unit',
]);
export const pending = Object.freeze([
  'taxonomy-transaction-association-and-filters',
  'desktop-taxonomy-ipc-and-ui',
  'taxonomy-version-audit-cloud-feed-and-outbox',
  'human-homologations-after-complete-system-integration',
]);
export const taxonomyHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/taxonomy.yml',
      'packages/domain/src/taxonomy.ts',
      'packages/domain/type-tests/taxonomy.ts',
      'packages/finance-ports/src/taxonomy.ts',
      'packages/storage-schema/src/taxonomy-changes.ts',
      'packages/storage-schema/src/revision-adapters/taxonomy-writes.ts',
      'packages/persistence-postgres/src/taxonomy-changes.ts',
      'packages/persistence-postgres/src/modules/taxonomy-writes.ts',
      'infra/taxonomy/run.mjs',
      'infra/taxonomy/clean.mjs',
      'infra/taxonomy/harness.mjs',
      'infra/taxonomy/protocol.mjs',
      'infra/taxonomy/evidence.mjs',
      'infra/taxonomy/compose.yaml',
      'infra/scripts/taxonomy.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateTaxonomyEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('TAXONOMY_EVIDENCE_INVALID');
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
    r.scope !== 'us045-taxonomy' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, taxonomyChecks) ||
    taxonomyChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = taxonomyHashes(),
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
