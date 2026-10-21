import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { corpus, xmlHeader } from '../import-file-validation/corpus.mjs';
import { validateImportFile } from '../../packages/importers/dist/index.js';
export function fileVectors() {
  const cases = corpus().map(({ name, request, text }) => ({
    name,
    request,
    text,
  }));
  const request = {
    file_name: 'SYNTHETIC.csv',
    mime: '',
    encoding: 'utf-8',
    delimiter: ',',
  };
  cases.push(
    ...[
      { name: 'invalid-utf8', bytes: [0xc0, 0xaf] },
      { name: 'utf16', bytes: [255, 254, 97, 0] },
      { name: 'file-limit', zeros: 16 * 1024 * 1024 + 1 },
      { name: 'file-boundary-invalid', zeros: 16 * 1024 * 1024 },
      { name: 'cancelled', text: 'a,b\n1,2', cancelled: true },
      { name: 'full-file-boundary', recipe: 'CSV_16MIB' },
      ...[
        '\u00ad',
        '\u061c',
        '\u200b',
        '\u202e',
        '\u2066',
        '\ufeff',
        '\u{e0001}',
      ].map((char, n) => ({
        name: 'format-name-' + n,
        text: 'a,b\n1,2',
        request: { ...request, file_name: 'SYNTHETIC' + char + '.csv' },
      })),
      { name: 'utf16-csv-field-boundary', text: 'a,b\n1,' + '😀'.repeat(1024) },
      { name: 'utf16-csv-field-overflow', text: 'a,b\n1,' + '😀'.repeat(1025) },
      {
        name: 'utf16-xml-field-overflow',
        text: xmlHeader + '<OFX><NAME>' + '😀'.repeat(1025) + '</NAME></OFX>',
        request: { ...request, file_name: 'SYNTHETIC.ofx', delimiter: null },
      },
      {
        name: 'mime-space-before-semicolon',
        text: 'a,b\n1,2',
        request: { ...request, mime: 'text/csv \t; charset=UTF-8' },
      },
      {
        name: 'mime-trailing-space',
        text: 'a,b\n1,2',
        request: { ...request, mime: 'text/csv ' },
      },
    ].map((v) => ({ request, ...v })),
  );
  for (let code = 0; code <= 255; code++)
    cases.push({
      name: 'cp1252-byte-' + code,
      request: { ...request, encoding: 'windows-1252' },
      bytes: [97, 44, 98, 10, 49, 44, code],
    });
  cases.push(
    {
      name: 'filename-utf16-boundary',
      request: { ...request, file_name: '😀'.repeat(125) + 'a.csv' },
      text: 'a,b\n1,2',
    },
    {
      name: 'filename-utf16-overflow',
      request: { ...request, file_name: '😀'.repeat(126) + '.csv' },
      text: 'a,b\n1,2',
    },
  );
  return cases;
}
function bytes(v) {
  if (v.recipe === 'CSV_16MIB')
    return new globalThis.TextEncoder().encode(
      'a,b,c,d\n' +
        ['x', 'y', 'z', 'w']
          .map((c) => c.repeat(1023))
          .join(',')
          .concat('\n')
          .repeat(4095) +
        [
          'x'.repeat(1021),
          'y'.repeat(1021),
          'z'.repeat(1021),
          'w'.repeat(1022),
        ].join(','),
    );
  if (v.zeros !== undefined) return new Uint8Array(v.zeros);
  if (v.bytes) return Uint8Array.from(v.bytes);
  if (v.request.encoding === 'windows-1252')
    return Uint8Array.from(
      [...v.text].map((c) => (c === '€' ? 128 : c.charCodeAt(0))),
    );
  return new globalThis.TextEncoder().encode(v.text);
}
export function expectedVectors(vectors) {
  return vectors.map((v) => {
    try {
      const controller = new globalThis.AbortController();
      if (v.cancelled) controller.abort();
      return {
        name: v.name,
        result: validateImportFile(
          { ...v.request, bytes: bytes(v) },
          controller.signal,
        ),
      };
    } catch (e) {
      return { name: v.name, error: e.code };
    }
  });
}
export function verifyFileParity(executable, owned) {
  const vectors = fileVectors(),
    input = path.join(owned, 'vectors.json'),
    output = path.join(owned, 'parity.json');
  writeFileSync(input, JSON.stringify(vectors));
  const processResult = spawnSync(executable, [input, output], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 35000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(processResult.status, 0, 'FILE_PARITY_PROBE_FAILED');
  assert.equal(processResult.stderr, '');
  const actual = JSON.parse(readFileSync(output));
  const expected = expectedVectors(vectors);
  for (let n = 0; n < actual.length; n++)
    assert.deepEqual(actual[n], expected[n], vectors[n]?.name);
  assert.equal(actual.length, vectors.length);
  return vectors.length;
}
