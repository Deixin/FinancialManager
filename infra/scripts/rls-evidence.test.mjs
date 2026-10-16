import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredRlsChecks, validateRlsEvidence } from './rls-evidence.mjs';

const evidence = () => ({
  format_version: 1,
  synthetic_only: true,
  scope: 'postgresql-rls-pool-spike',
  passed: true,
  checks: Object.fromEntries(requiredRlsChecks.map((name) => [name, true])),
  schema_sha256: 'a'.repeat(64),
  image_sha256: 'b'.repeat(64),
  postgres_version: '18.6',
  concurrent_requests: 48,
  completed_at_utc: '2026-10-16T02:00:00.000Z',
  containers_and_synthetic_secrets_removed: true,
  versions: { node: '24.19.0', pg: '8.23.1' },
});

test('RLS evidence requires every integration case and successful cleanup', () => {
  assert.equal(validateRlsEvidence(evidence()).passed, true);
  for (const name of requiredRlsChecks) {
    const report = evidence();
    delete report.checks[name];
    assert.throws(() => validateRlsEvidence(report), /RLS_CHECK_MISSING/);
  }
  for (const patch of [
    { passed: false },
    { synthetic_only: false },
    { containers_and_synthetic_secrets_removed: false },
    { postgres_version: '19beta4' },
    { concurrent_requests: 0 },
    { completed_at_utc: 'invalid' },
  ])
    assert.throws(() => validateRlsEvidence({ ...evidence(), ...patch }));
});

test('RLS evidence rejects financial payloads, credentials and invalid provenance', () => {
  for (const patch of [
    { rows: [{ amount_minor: 'synthetic-placeholder' }] },
    { password: 'synthetic-placeholder' },
    { schema_sha256: 'bad' },
    { image_sha256: '' },
    { versions: { ...evidence().versions, password: 'synthetic-placeholder' } },
  ])
    assert.throws(() => validateRlsEvidence({ ...evidence(), ...patch }));
});
