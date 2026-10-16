import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  validateImporterEvidence,
  importerChecks,
} from './importer-evidence.mjs';
import { sourceHash } from '../importers/sources.mjs';
import { migrationHash } from '../../packages/importers/spikes/us-006/staging.mjs';

const report = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-006-parsers-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('import evidence requires every hostile/failure gate and completed source cleanup', () => {
  validateImporterEvidence(report());
  for (const key of importerChecks) {
    const value = report();
    delete value.checks[key];
    assert.throws(() => validateImporterEvidence(value));
  }
  assert.throws(() =>
    validateImporterEvidence({ ...report(), artifacts_removed: false }),
  );
});
test('import evidence rejects slow/incomplete benchmarks, unknown metadata and payloads', () => {
  for (const patch of [
    { token: 'synthetic' },
    { rows: [] },
    { migration_sha256: 'bad' },
    {
      versions: {
        node: '24.19.0',
        sqlite: '3.53.3',
        csv_parse: 'unknown',
        sax: '1.6.1',
      },
    },
  ])
    assert.throws(() => validateImporterEvidence({ ...report(), ...patch }));
  for (const patch of [
    { rows: 9999 },
    { samples_ms: [30001, 100, 100] },
    { samples_ms: [1, 2] },
    { peak_rss_kib: 300000 },
  ]) {
    const value = report();
    Object.assign(value.benchmarks[0], patch);
    assert.throws(() => validateImporterEvidence(value));
  }
});
test('archived US-006 evidence matches the migration and exact parser/harness source manifest', () => {
  const value = validateImporterEvidence(report());
  assert.equal(value.migration_sha256, migrationHash);
  assert.equal(value.source_sha256, sourceHash());
});
