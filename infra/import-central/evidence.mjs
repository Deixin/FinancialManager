import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionHashes, revisionChecks } from '../revisions/evidence.mjs';
import { importCases, extraChecks } from './protocol.mjs';
export const importChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    importCases.map((n) => e + '_import_' + n),
  ),
  ...extraChecks,
]);
export const pending = Object.freeze([
  'desktop-import-central-ui-rust-backup-restore-integration',
  'parser-staging-review-commit-and-local-processing-stories',
  'cloud-runtime-authorization-outbox-feed-and-other-platforms',
  'human-homologations-after-complete-system-integration',
]);
export const importHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.prettierrc.json',
      '.github/workflows/import-central.yml',
      'infra/import-central/clean.mjs',
      'infra/import-central/harness.mjs',
      'infra/import-central/run.mjs',
      'infra/import-central/protocol.mjs',
      'infra/import-central/compose.yaml',
      'infra/import-central/evidence.mjs',
      'infra/import-central/generate.mjs',
      'infra/import-central/migrations.mjs',
      'infra/scripts/import-central.test.mjs',
      'packages/domain/src/imports.ts',
      'packages/domain/type-tests/imports.ts',
      'packages/finance-ports/src/imports.ts',
      'packages/storage-schema/src/import-central.ts',
      'packages/storage-schema/src/import-migrations.ts',
      'packages/storage-schema/src/generated-import-migration.ts',
      'packages/storage-schema/src/revision-adapters/import-reads-writes.ts',
      'packages/storage-schema/src/revision-adapters/import-account-projections.ts',
      'packages/storage-schema/src/revision-adapters/import-transaction-projections.ts',
      'packages/persistence-postgres/src/import-central.ts',
      'packages/persistence-postgres/src/modules/import-reads-writes.ts',
      'packages/persistence-postgres/src/modules/import-account-projections.ts',
      'packages/persistence-postgres/src/modules/import-transaction-projections.ts',
      'packages/storage-schema/sqlite/migrations/0003-import-ledger.up.sql',
      'packages/storage-schema/sqlite/migrations/0003-import-ledger.down.sql',
      'apps/api/persistence/postgres/migrations/0003-import-ledger.up.sql',
      'apps/api/persistence/postgres/migrations/0003-import-ledger.down.sql',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateImportEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('IMPORT_EVIDENCE_INVALID');
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
    r.scope !== 'us050-import-central' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, importChecks) ||
    importChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = importHashes(),
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
