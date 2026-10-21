import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../packages/importers/dist/index.js';
import { corpus, executeCorpus } from '../import-file-validation/corpus.mjs';
import { verifyOracles } from '../import-file-validation/oracle.mjs';
import {
  validateFileEvidence,
  scope,
} from '../import-file-validation/evidence.mjs';
import { readCurrentEvidence } from '../validation/evidence.mjs';

test('US-051 accepts bounded text and rejects synthetic hostile content with safe codes', () => {
  const results = executeCorpus(api, corpus());
  assert.ok(results.length >= 80);
});
test('US-051 CSV and XML structural counts agree with independent parsers', () => {
  assert.equal(verifyOracles(), true);
});
test('US-051 does not mutate the source or return its contents', () => {
  const bytes = new globalThis.TextEncoder().encode('a,b\n1,synthetic-private'),
    before = bytes.slice();
  const result = api.validateImportFile({
    file_name: 'sintetico.csv',
    mime: '',
    encoding: 'utf-8',
    delimiter: ',',
    bytes,
  });
  assert.deepEqual(bytes, before);
  assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
  assert.equal(result.byte_length, bytes.byteLength);
  assert.equal(Object.isFrozen(api.importFileLimits), true);
});
test('US-051 evidence requires fresh current sources and all behavior/resource gates', () => {
  const report = readCurrentEvidence(scope);
  assert.equal(validateFileEvidence(report), report);
  for (const key of Object.keys(report.checks)) {
    const invalid = globalThis.structuredClone(report);
    invalid.checks[key] = false;
    assert.throws(() => validateFileEvidence(invalid));
  }
  for (const key of Object.keys(report.source_sha256)) {
    const invalid = globalThis.structuredClone(report);
    invalid.source_sha256[key] = '0'.repeat(64);
    assert.throws(() => validateFileEvidence(invalid));
  }
  for (const change of [
    { resources_closed: false },
    { cases: 0 },
    { passed: false },
    { pending: [] },
  ]) {
    assert.throws(() => validateFileEvidence({ ...report, ...change }));
  }
});
