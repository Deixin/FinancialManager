import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseOfx } from '../../packages/importers/dist/index.js';
import { destination, statement, transaction, request } from './corpus.mjs';
const require = createRequire(
  new URL('../../packages/importers/package.json', import.meta.url),
);
const sax = require('sax');
export async function verifyOfxOracle() {
  const text = statement(
    transaction({ MEMO: 'SYNTHETIC &amp;lt; &amp; &#x1F600;' }) +
      transaction({
        FITID: 'SYNTHETIC-2',
        TRNAMT: '+1.23',
        MEMO: 'SYNTHETIC credit',
      }),
  );
  const xml = sax.parser(true, { strictEntities: true }),
    rows = [],
    stack = [];
  let current;
  xml.onopentag = (tag) => {
    stack.push(tag.name);
    if (tag.name === 'STMTTRN') current = {};
  };
  xml.ontext = (value) => {
    if (stack.at(-2) === 'STMTTRN')
      current[stack.at(-1)] = (current[stack.at(-1)] ?? '') + value;
  };
  xml.onclosetag = (name) => {
    if (name === 'STMTTRN') rows.push(current);
    stack.pop();
  };
  xml.write(text).close();
  const req = request(text),
    result = await parseOfx(req, destination);
  assert.equal(
    result.source.file_hash,
    createHash('sha256').update(req.bytes).digest('hex'),
  );
  assert.equal(
    result.source.source_account_hash,
    createHash('sha256')
      .update(
        JSON.stringify([
          'OFX',
          'STMTRS',
          '999',
          '0000',
          'SYNTHETIC-BANK-ONLY',
          'CHECKING',
        ]),
      )
      .digest('hex'),
  );
  assert.deepEqual(
    result.items.map((r) => [
      r.source_external_id,
      r.original_description,
      r.source_transaction_type,
    ]),
    rows.map((r) => [r.FITID, r.MEMO, r.TRNTYPE]),
  );
  assert.deepEqual(
    result.items.map((r) => r.normalized_amount_minor),
    ['-12345', '123'],
  );
  assert.deepEqual(
    rows.map((r) => r.DTPOSTED.slice(0, 8)),
    ['20261025', '20261025'],
  );
  assert.equal(result.items[1].provenance.file_hash, result.source.file_hash);
  for (const encoded of [
    request('\uFEFF' + text),
    request(
      statement(transaction({ MEMO: 'SYNTHETIC café €' }), {
        sgml: true,
        encoding: 'windows-1252',
      }),
      'windows-1252',
    ),
  ]) {
    const value = await parseOfx(encoded, destination);
    assert.equal(
      value.source.file_hash,
      createHash('sha256').update(encoded.bytes).digest('hex'),
    );
  }
  return true;
}
