import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  uuidText,
  dateText,
  instantText,
  decimalText,
} from '../physical/types.mjs';
import { runProbe, fixture, schemaHash } from '../physical/probe.mjs';
import {
  validatePhysicalEvidence,
  physicalChecks,
} from './physical-evidence.mjs';

test('physical UUID codec preserves existing UUIDs and rejects noncanonical/nil IDs', () => {
  for (const value of [fixture.workspace, ...fixture.ids])
    assert.equal(uuidText(value), value);
  for (const value of [
    fixture.ids[0].toUpperCase(),
    fixture.ids[0].replaceAll('-', ''),
    '00000000-0000-0000-0000-000000000000',
    42,
    null,
  ])
    assert.throws(() => uuidText(value), { code: 'INVALID_UUID' });
});
test('physical calendar/instant/decimal codecs avoid timezone and precision coercion', () => {
  assert.equal(dateText('2024-02-29'), '2024-02-29');
  for (const value of [
    '0001-01-01T00:00:00.000Z',
    '9999-12-31T23:59:59.999Z',
    ...fixture.instants,
  ])
    assert.equal(instantText(value), value);
  for (const value of ['2026-02-29', '2026-04-31', '2026-10-16T00:00:00.000Z'])
    assert.throws(() => dateText(value), { code: 'INVALID_DATE' });
  for (const value of [
    '2026-10-16T00:00:00Z',
    '2026-10-16T00:00:00.000001Z',
    '2026-10-16T00:00:00.000+00:00',
    '2026-10-16T24:00:00.000Z',
    1729036800000,
  ])
    assert.throws(() => instantText(value), { code: 'INVALID_INSTANT' });
  for (const value of ['0', '-0.1', ...fixture.decimals])
    assert.equal(decimalText(value), value);
  for (const value of ['-0', '01', '1.0', '0.00', '1e-18', 1.5])
    assert.throws(() => decimalText(value), { code: 'INVALID_DECIMAL_EXACT' });
});
test('physical SQLite probe enforces migration, type, FK, ordering and recovery behavior', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fm-us007-synthetic-'));
  try {
    const result = runProbe(path.join(directory, 'synthetic.sqlite'));
    assert.equal(result.passed, true);
    assert.equal(result.schema_sha256, schemaHash);
    assert.deepEqual(
      Object.keys(result.checks).sort(),
      [...physicalChecks].sort(),
    );
    assert.ok(Object.values(result.checks).every((value) => value === true));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('fm-us007-synthetic-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
test('physical evidence matches the schema and refuses missing gates or native/payload claims', () => {
  const report = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-007-physical-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  validatePhysicalEvidence(report);
  assert.equal(report.schema_sha256, schemaHash);
  for (const key of physicalChecks) {
    const checks = { ...report.checks };
    delete checks[key];
    assert.throws(() => validatePhysicalEvidence({ ...report, checks }));
  }
  for (const patch of [
    { database_removed: false },
    { sqlcipher_validated: true },
    { rows: [] },
    { token: 'synthetic' },
    { schema_sha256: 'invalid' },
  ])
    assert.throws(() => validatePhysicalEvidence({ ...report, ...patch }));
});
