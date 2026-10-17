import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  requiredProfileChecks,
  requiredEnvironmentChecks,
  validateEnvironmentEvidence,
} from './environments-evidence.mjs';
import { manifest, sourceHashes } from '../environments/runtime.mjs';
import { profileNames } from '../environments/model.mjs';

const fixture = () => ({
  format_version: 1,
  scope: 'docker-local-foundation-environments',
  synthetic_only: true,
  started_at_utc: '2026-10-16T12:00:00.000Z',
  completed_at_utc: '2026-10-16T12:05:00.000Z',
  passed: true,
  profiles: Object.fromEntries(
    profileNames.map((profile) => [
      profile,
      {
        profile,
        passed: true,
        database_version: '18.6',
        checks: Object.fromEntries(
          requiredProfileChecks.map((name) => [name, true]),
        ),
      },
    ]),
  ),
  checks: Object.fromEntries(
    requiredEnvironmentChecks.map((name) => [name, true]),
  ),
  versions: { node: '24.19.0', docker: '29.8.2', compose: '5.6.0' },
  images: { ...manifest.images },
  source_sha256: sourceHashes(),
  pending: [
    'product-api-bff-worker',
    'object-storage-adapter',
    'remote-staging-and-production',
    'native-client-runtime-integration',
  ],
});

test('environment evidence requires every real service, profile, cleanup and scope gate', () => {
  assert.equal(validateEnvironmentEvidence(fixture()).passed, true);
  for (const profile of profileNames) {
    const report = fixture();
    delete report.profiles[profile];
    assert.throws(
      () => validateEnvironmentEvidence(report),
      /ENVIRONMENT_EVIDENCE_INVALID/,
    );
  }
  for (const check of requiredProfileChecks) {
    const report = fixture();
    report.profiles.staging.checks[check] = false;
    assert.throws(
      () => validateEnvironmentEvidence(report),
      /ENVIRONMENT_EVIDENCE_INVALID/,
    );
  }
  for (const check of requiredEnvironmentChecks) {
    const report = fixture();
    report.checks[check] = false;
    assert.throws(
      () => validateEnvironmentEvidence(report),
      /ENVIRONMENT_EVIDENCE_INVALID/,
    );
  }
});

test('environment evidence refuses payloads, remote deployment claims, invalid time and modified sources', () => {
  const changes = [
    (report) => {
      report.credentials = 'synthetic-secret';
    },
    (report) => {
      report.profiles.local.password = 'synthetic-secret';
    },
    (report) => {
      report.scope = 'remote-production';
    },
    (report) => {
      report.synthetic_only = false;
    },
    (report) => {
      report.pending = [];
    },
    (report) => {
      report.completed_at_utc = '2026-10-16T11:00:00.000Z';
    },
    (report) => {
      report.versions.node = 'synthetic payload';
    },
    (report) => {
      report.images.postgres = 'postgres:latest';
    },
    (report) => {
      report.source_sha256['runtime.mjs'] = '0'.repeat(64);
    },
  ];
  for (const change of changes) {
    const report = fixture();
    change(report);
    assert.throws(
      () => validateEnvironmentEvidence(report),
      /ENVIRONMENT_EVIDENCE_INVALID/,
    );
  }
});

test('latest environment evidence matches current sources and historical evidence retains its gates', () => {
  for (const [name, matchSources] of [
    ['us-014-environments-2026-10-16.json', false],
    ['us-014-environments-2026-10-16-us015.json', false],
    ['us-014-environments-2026-10-16-us016.json', false],
    ['us-014-environments-2026-10-16-us017.json', false],
    ['us-014-environments-2026-10-16-us020.json', false],
    ['us-014-environments-2026-10-16-us021.json', false],
    ['us-014-environments-2026-10-16-us022.json', false],
    ['us-014-environments-2026-10-16-us023.json', false],
    ['us-014-environments-2026-10-16-us024.json', false],
    ['us-014-environments-2026-10-16-us025.json', false],
    ['us-014-environments-2026-10-16-us026.json', false],
    ['us-014-environments-2026-10-16-us027.json', false],
    ['us-014-environments-2026-10-16-us030.json', false],
    ['us-014-environments-2026-10-17-us031.json', false],
    ['us-014-environments-2026-10-17-us032.json', false],
    ['us-014-environments-2026-10-17-us033.json', false],
    ['us-014-environments-2026-10-17-us034.json', false],
    ['us-014-environments-2026-10-17-us035.json', false],
    ['us-014-environments-2026-10-17-us036.json', false],
    ['us-014-environments-2026-10-17-us040-desktop.json', true],
  ]) {
    const filename = new URL(
      '../../docs/quality/evidence/' + name,
      import.meta.url,
    );
    assert.equal(
      existsSync(filename),
      true,
      'Run and archive the full four-profile protocol first',
    );
    const report = JSON.parse(readFileSync(filename, 'utf8'));
    // Historical hashes describe that run; the new real run must match HEAD's files.
    assert.equal(
      validateEnvironmentEvidence(report, { matchSources }).passed,
      true,
    );
  }
});
