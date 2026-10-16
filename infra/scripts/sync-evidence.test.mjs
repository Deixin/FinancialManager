import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requiredSyncChecks, validateSyncEvidence } from './sync-evidence.mjs';

function complete() {
  return {
    format_version: 1,
    synthetic_only: true,
    scope: 'two-client-sync-spike',
    passed: true,
    checks: Object.fromEntries(requiredSyncChecks.map((key) => [key, true])),
    schema_sha256: 'a'.repeat(64),
    image_sha256: 'b'.repeat(64),
    postgres_version: '18.6',
    independent_client_processes: 48,
    concurrent_pushes: 12,
    completed_at_utc: '2026-10-16T03:10:00Z',
    containers_and_synthetic_secrets_removed: true,
    client_stores_removed: true,
    versions: { node: '24.19.0', pg: '8.23.1' },
  };
}
test('sync evidence rejects missing crash/convergence checks and incomplete cleanup', () => {
  validateSyncEvidence(complete());
  for (const name of requiredSyncChecks) {
    const report = complete();
    delete report.checks[name];
    assert.throws(() => validateSyncEvidence(report));
  }
  for (const field of [
    'containers_and_synthetic_secrets_removed',
    'client_stores_removed',
  ]) {
    const report = complete();
    report[field] = false;
    assert.throws(() => validateSyncEvidence(report));
  }
});
test('sync evidence rejects secret/payload fields, unsupported versions and invalid hashes', () => {
  for (const extra of [
    { token: 'synthetic-secret' },
    { records: [] },
    { schema_sha256: 'invalid' },
    { postgres_version: 'unknown' },
    { independent_client_processes: 1 },
    { concurrent_pushes: 0 },
    {
      versions: { node: '24.19.0', pg: '8.23.1', password: 'synthetic-secret' },
    },
  ])
    assert.throws(() => validateSyncEvidence({ ...complete(), ...extra }));
});
test('archived US-005 evidence contains all real protocol gates and sanitized metadata', () => {
  const report = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-005-sync-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  validateSyncEvidence(report);
  const migration = readFileSync(
    new URL(
      '../../apps/api/spikes/us-005/migrations/0001-synthetic-sync.sql',
      import.meta.url,
    ),
  );
  assert.equal(
    report.schema_sha256,
    createHash('sha256').update(migration).digest('hex'),
  );
});
