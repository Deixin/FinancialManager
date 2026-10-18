import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { revisionHashes, revisionChecks } from '../revisions/evidence.mjs';
import { cardPaymentCases } from './protocol.mjs';
export const cardPaymentChecks = Object.freeze([
  ...revisionChecks,
  ...['sqlite', 'postgresql'].flatMap((e) =>
    cardPaymentCases.map((n) => e + '_card_payment_' + n),
  ),
  'card_payment_same_versions_and_snapshots_cross_engine',
  'card_payment_local_without_cloud_identity',
]);
export const pending = Object.freeze([
  'desktop-card-payment-ipc-and-ui',
  'statement-import-and-payment-reconciliation',
  'cloud-feed-outbox-and-durable-receipts',
  'human-homologations-after-complete-system-integration',
]);
export const cardPaymentHashes = () => ({
  ...revisionHashes(),
  ...Object.fromEntries(
    [
      '.github/workflows/card-payments.yml',
      'infra/card-payments/clean.mjs',
      'packages/finance-ports/src/manual-movements.ts',
      'packages/domain/src/manual-movements.ts',
      'packages/domain/src/card-payments.ts',
      'packages/domain/type-tests/card-payments.ts',
      'packages/domain/src/reports.ts',
      'packages/domain/src/balances.ts',
      'packages/finance-ports/src/card-payments.ts',
      'infra/card-payments/run.mjs',
      'infra/card-payments/protocol.mjs',
      'infra/card-payments/compose.yaml',
      'infra/card-payments/evidence.mjs',
      'infra/scripts/card-payments.test.mjs',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + file, import.meta.url)))
        .digest('hex'),
    ]),
  ),
});
export function validateCardPaymentEvidence(r, { matchSources = true } = {}) {
  const exact = (v, keys) =>
      v &&
      JSON.stringify(Object.keys(v).sort()) ===
        JSON.stringify([...keys].sort()),
    fail = () => {
      throw Error('CARD_PAYMENT_EVIDENCE_INVALID');
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
    r.scope !== 'us043-card-payments' ||
    r.synthetic_only !== true ||
    r.passed !== true ||
    r.resources_closed !== true ||
    !exact(r.checks, cardPaymentChecks) ||
    cardPaymentChecks.some((k) => r.checks[k] !== true) ||
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
  const hashes = cardPaymentHashes(),
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
