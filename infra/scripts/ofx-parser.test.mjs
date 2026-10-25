import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../packages/importers/dist/index.js';
import {
  executeOfxCorpus,
  destination,
  request,
  statement,
  transaction,
} from '../ofx-parser/corpus.mjs';
import { verifyOfxOracle } from '../ofx-parser/oracle.mjs';
test('US-052 normalizes synthetic OFX deterministically with exact i64 values provenance and invalid rows', async () => {
  const cases = await executeOfxCorpus(api);
  assert.ok(cases.length >= 65);
});
test('US-052 XML records and entities agree with sax and SHA-256 agrees with the Node oracle', async () => {
  assert.equal(await verifyOfxOracle(), true);
});
test('US-052 retains every invalid semantic row without a financial write port', async () => {
  const result = await api.parseOfx(
    request(
      statement(
        transaction({ TRNAMT: '1e5' }) +
          transaction({ DTPOSTED: '20260230', FITID: 'SYNTHETIC-2' }),
      ),
    ),
    destination,
  );
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((r) => r.disposition),
    ['INVALID', 'INVALID'],
  );
  assert.equal(result.items[0].normalized_amount_minor, null);
  assert.equal(result.items[1].normalized_date, null);
  assert.deepEqual(Object.keys(result).sort(), [
    'destination',
    'items',
    'model_version',
    'source',
  ]);
});
test('US-052 checks destination and rejects unsupported memory before hashing', async () => {
  await assert.rejects(
    api.parseOfx(request(), { ...destination, currency: 'USD' }),
    { code: 'INVALID_DESTINATION' },
  );
  await assert.rejects(
    api.parseOfx({ ...request(), path: 'C:\\SYNTHETIC.ofx' }, destination),
    { code: 'INVALID_REQUEST' },
  );
  await assert.rejects(
    api.parseOfx(
      {
        ...request(),
        bytes: new Uint8Array(new globalThis.SharedArrayBuffer(1)),
      },
      destination,
    ),
    { code: 'INVALID_REQUEST' },
  );
});
test('US-052 retains original OFX transaction types for transfer and payment review', async () => {
  const result = await api.parseOfx(
    request(
      statement(
        transaction({
          TRNTYPE: 'XFER',
          FITID: 'SYNTHETIC-XFER',
          TRNAMT: '-5',
        }) +
          transaction({
            TRNTYPE: 'PAYMENT',
            FITID: 'SYNTHETIC-PAYMENT',
            TRNAMT: '-5',
          }),
      ),
    ),
    destination,
  );
  assert.deepEqual(
    result.items.map((row) => row.source_transaction_type),
    ['XFER', 'PAYMENT'],
  );
  for (const row of result.items) {
    assert.ok(row.warnings.includes('MOVEMENT_REQUIRES_REVIEW'));
    assert.ok(row.provenance.fields.type.endsWith('/TRNTYPE'));
  }
});
test('US-052 hashing errors expose a fixed code without the underlying payload', async () => {
  const subtle = globalThis.crypto.subtle;
  const descriptor = Object.getOwnPropertyDescriptor(subtle, 'digest');
  try {
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      value: async () => {
        throw Error('SYNTHETIC_PRIVATE_PAYLOAD');
      },
    });
    await assert.rejects(api.parseOfx(request(), destination), {
      code: 'HASH_UNAVAILABLE',
      message: 'HASH_UNAVAILABLE',
    });
  } finally {
    if (descriptor) Object.defineProperty(subtle, 'digest', descriptor);
    else delete subtle.digest;
  }
});
