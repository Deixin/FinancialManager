import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionHashes, revisionChecks } from '../revisions/evidence.mjs';
import { categoryCases } from './protocol.mjs';
export const categoryChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    categoryCases.map((n) => e + '_category_' + n),
  ),
  'category_same_profiles_metadata_and_order_cross_engine',
  'sqlite_category_local_without_cloud_identity',
  'postgres_category_rls_owner_and_nested_unit',
]);
export const pending = Object.freeze([
  'desktop-category-ipc-and-ui',
  'subcategory-tag-and-classification-editors',
  'category-version-audit-cloud-feed-and-outbox',
  'human-homologations-after-complete-system-integration',
]);
export const categoryHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/categories.yml',
      'infra/categories/clean.mjs',
      'infra/categories/harness.mjs',
      'packages/domain/src/categories.ts',
      'packages/domain/type-tests/categories.ts',
      'packages/finance-ports/src/categories.ts',
      'packages/storage-schema/src/category-changes.ts',
      'packages/storage-schema/src/revision-adapters/category-writes.ts',
      'packages/persistence-postgres/src/category-changes.ts',
      'packages/persistence-postgres/src/modules/category-writes.ts',
      'infra/categories/run.mjs',
      'infra/categories/protocol.mjs',
      'infra/categories/compose.yaml',
      'infra/categories/evidence.mjs',
      'infra/scripts/categories.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateCategoryEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('CATEGORY_EVIDENCE_INVALID');
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
    r.scope !== 'us044-categories' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, categoryChecks) ||
    categoryChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = categoryHashes(),
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
