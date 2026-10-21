import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as api from '../../packages/importers/dist/index.js';
import { corpus, xmlHeader, bankBody } from './corpus.mjs';

const require = createRequire(
  new URL('../../packages/importers/package.json', import.meta.url),
);
const { parse } = require('csv-parse/sync');
const sax = require('sax');

export function verifyOracles() {
  const encoder = new globalThis.TextEncoder();
  for (const test of corpus().filter(
    (test) =>
      !test.error &&
      test.request.file_name.toLowerCase().endsWith('.csv') &&
      test.request.encoding === 'utf-8',
  )) {
    const bytes = encoder.encode(test.text),
      before = bytes.slice();
    const actual = api.validateImportFile({ ...test.request, bytes });
    const rows = parse(test.text, {
      bom: true,
      delimiter: test.request.delimiter,
      relax_column_count: true,
      cast: false,
    });
    assert.equal(actual.records, rows.length - 1);
    assert.equal(actual.columns, Math.max(...rows.map((row) => row.length)));
    assert.deepEqual(bytes, before);
  }
  const text = xmlHeader + bankBody;
  const xml = sax.parser(true, { strictEntities: true });
  let records = 0,
    depth = 0,
    maximum = 0;
  xml.onopentag = (tag) => {
    depth++;
    maximum = Math.max(maximum, depth);
    if (tag.name === 'STMTTRN') records++;
  };
  xml.onclosetag = () => {
    depth--;
  };
  xml.write(text).close();
  const result = api.validateImportFile({
    file_name: 'sintetico.ofx',
    mime: '',
    encoding: 'utf-8',
    delimiter: null,
    bytes: encoder.encode(text),
  });
  assert.equal(result.records, records);
  assert.equal(result.depth, maximum);
  return true;
}
