import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateVaultEvidence, vaultChecks } from '../vault/evidence.mjs';
const load = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-032-vault-windows-2026-10-18-us044-desktop.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('vault evidence requires every native fault, interruption and ciphertext gate', () => {
  assert.equal(validateVaultEvidence(load()).passed, true);
  for (const gate of vaultChecks) {
    const report = load();
    delete report.checks[gate];
    assert.throws(
      () => validateVaultEvidence(report),
      /VAULT_EVIDENCE_INVALID/,
    );
    report.checks[gate] = false;
    assert.throws(
      () => validateVaultEvidence(report),
      /VAULT_EVIDENCE_INVALID/,
    );
  }
});
test('vault evidence rejects unsafe payloads, incomplete cleanup and stale sources', () => {
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.synthetic_only = false;
    },
    (r) => {
      r.dataset_version = 2;
    },
    (r) => {
      r.versions.sqlcipher = 'SQLite';
    },
    (r) => {
      r.versions.platform = 'linux-x64';
    },
    (r) => {
      r.completed_at_utc = 'invalid';
    },
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.secret = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (r) => {
      r.checks.financial_snapshot = {};
    },
  ]) {
    const report = load();
    mutate(report);
    assert.throws(
      () => validateVaultEvidence(report),
      /VAULT_EVIDENCE_INVALID/,
    );
  }
});
test('historical vault evidence retains the complete manifest and rejects malformed hashes', () => {
  const historical = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-032-vault-windows-2026-10-17.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(
    validateVaultEvidence(historical, { matchSources: false }).passed,
    true,
  );
  const report = load();
  report.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateVaultEvidence(report, { matchSources: false }).passed,
    true,
  );
  report.source_sha256['package.json'] = 'invalid';
  assert.throws(
    () => validateVaultEvidence(report, { matchSources: false }),
    /VAULT_EVIDENCE_INVALID/,
  );
  delete report.source_sha256['package.json'];
  assert.throws(
    () => validateVaultEvidence(report, { matchSources: false }),
    /VAULT_EVIDENCE_INVALID/,
  );
});
