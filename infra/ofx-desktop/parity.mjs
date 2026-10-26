import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as api from '../../packages/importers/dist/index.js';
import {
  executeOfxCorpus,
  destination,
  request,
  statement,
  transaction,
} from '../ofx-parser/corpus.mjs';
export async function ofxVectors() {
  const vectors = [];
  await executeOfxCorpus({
    ...api,
    parseOfx: async (request, destination, signal) => {
      const v = {
        name: 'ofx-' + vectors.length,
        mode: 'OFX_NORMALIZE',
        request: Object.fromEntries(
          Object.entries(request).filter(([k]) => k !== 'bytes'),
        ),
        destination: { ...destination },
        bytes: Array.from(request.bytes),
        cancelled: false,
      };
      vectors.push(v);
      try {
        v.expected = {
          result: await api.parseOfx(request, destination, signal),
        };
        return v.expected.result;
      } catch (error) {
        v.expected = { error: error.code };
        throw error;
      } finally {
        v.cancelled = !!signal?.aborted;
      }
    },
  });
  // Clock injection is JS-specific; native Budget deadline and cancellation
  // tests remain mandatory and the shared protocol retains both clock cases.
  const extra = [
    statement(transaction({ MEMO: '\u00a0A\u0301\u2000 B\ufeff' })),
    statement(transaction({ MEMO: '😀'.repeat(256) })),
    statement(transaction({ MEMO: '😀'.repeat(257) })),
    statement(transaction({ FITID: '😀'.repeat(128) })),
    statement(transaction({ FITID: '😀'.repeat(129) })),
    statement(transaction(), { to: '20260230' }).replace(
      /<ACCTID>.*?<\/ACCTID>/,
      '',
    ),
    statement(transaction(), { to: '20260230' }).replace(
      /<BANKACCTFROM>.*?<\/BANKACCTFROM>/,
      '',
    ),
    statement(transaction(), { to: '20260230' })
      .replace(/<STATUS>.*?<\/STATUS>/, '')
      .replace(
        '</STMTRS>',
        '</STMTRS><STATUS><CODE>2000</CODE><SEVERITY>ERROR</SEVERITY></STATUS>',
      ),
  ];
  for (const text of extra) {
    const req = request(text);
    const { bytes, ...metadata } = req;
    const v = {
      name: 'ofx-extra-' + vectors.length,
      mode: 'OFX_NORMALIZE',
      request: metadata,
      destination,
      bytes: Array.from(bytes),
      cancelled: false,
    };
    try {
      v.expected = { result: await api.parseOfx(req, destination) };
    } catch (error) {
      v.expected = { error: error.code };
    }
    vectors.push(v);
  }
  return vectors.filter((v) => v.expected.error !== 'TIME_LIMIT');
}
export async function verifyOfxParity(probe, directory) {
  const vectors = await ofxVectors(),
    input = path.join(directory, 'ofx-vectors.json'),
    output = path.join(directory, 'ofx-results.json');
  writeFileSync(
    input,
    JSON.stringify(
      vectors.map(({ expected, ...v }) => {
        void expected;
        return v;
      }),
    ),
  );
  const child = spawnSync(probe, [input, output], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  const actual = JSON.parse(readFileSync(output));
  assert.equal(actual.length, vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    try {
      assert.deepEqual(actual[i], {
        name: vectors[i].name,
        ...vectors[i].expected,
      });
    } catch (error) {
      throw new Error('OFX_PARITY_MISMATCH_' + i, { cause: error });
    }
  }
  assert.ok(vectors.length >= 77);
  return vectors.length;
}
