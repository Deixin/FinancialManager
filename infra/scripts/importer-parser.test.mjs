import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { parseStatement } from '../../packages/importers/spikes/us-006/parse.mjs';
import {
  decimalMinor,
  financialDate,
  normalizeRow,
  limits,
} from '../../packages/importers/spikes/us-006/contract.mjs';
import {
  context,
  mapping,
  csvFixture,
  ofxFixture,
} from '../importers/fixtures.mjs';

const request = (text, format = 'CSV', overrides = {}) => ({
  bytes: Buffer.from(text, 'utf8'),
  context,
  format,
  encoding: 'utf-8',
  extension: format === 'CSV' ? '.csv' : '.ofx',
  mime: format === 'CSV' ? 'text/csv' : 'application/x-ofx',
  mapping,
  ...overrides,
});
async function collect(input, ports = {}) {
  const rows = [];
  const metadata = await parseStatement(input, {
    consume: (row) => rows.push(row),
    ...ports,
  });
  return { rows, metadata };
}
test('import: decimal normalization is exact across i64 extremes and locale grouping', () => {
  for (const [raw, minor] of [
    ['90071992547409.93', '9007199254740993'],
    ['92233720368547758.07', '9223372036854775807'],
    ['-92233720368547758.08', '-9223372036854775808'],
    ['-0.00', '0'],
    ['+001.2', '120'],
  ])
    assert.equal(decimalMinor(raw), minor);
  assert.equal(decimalMinor('1.234.567,89', ',', '.'), '123456789');
  for (const raw of [
    '1.234',
    '1e3',
    'R$ 1.00',
    '1,000.00',
    '12.',
    'NaN',
    '--1',
    '92233720368547758.08',
    '-92233720368547758.09',
  ])
    assert.throws(() => decimalMinor(raw));
  assert.throws(() => decimalMinor('12.34,56', ',', '.'));
});
test('import: calendar dates are locale-explicit, validate leap years and preserve OFX day', () => {
  assert.equal(financialDate('29/02/2024', 'DD/MM/YYYY'), '2024-02-29');
  assert.equal(financialDate('20261001001500[-12:TZ]', 'OFX'), '2026-10-01');
  assert.equal(financialDate('20261001', 'OFX'), '2026-10-01');
  for (const [value, format] of [
    ['29/02/2026', 'DD/MM/YYYY'],
    ['2026-04-31', 'YYYY-MM-DD'],
    ['20261001250000', 'OFX'],
    ['20261001235961', 'OFX'],
    ['20261001000000[99:TZ]', 'OFX'],
    ['01/02/2026', 'MM/DD/YYYY'],
  ])
    assert.throws(() => financialDate(value, format), { code: 'INVALID_DATE' });
});
test('import: liability signs are explicit and range is checked after sign conversion', () => {
  const options = {
    ...context,
    format: 'CSV',
    dateFormat: 'YYYY-MM-DD',
    decimal: '.',
    grouping: null,
    amountMode: 'SIGNED_CASH_FLOW',
    balance_nature: 'LIABILITY',
  };
  const row = (amount) =>
    normalizeRow(
      {
        row: 1,
        locator: 'synthetic:1',
        date: '2026-10-16',
        amount,
        description: 'SYNTHETIC',
      },
      options,
    );
  assert.equal(row('-12.34').normalized_amount_minor, '1234');
  assert.equal(
    row('92233720368547758.08').normalized_amount_minor,
    '-9223372036854775808',
  );
  assert.equal(row('-92233720368547758.08').disposition, 'INVALID');
  assert.equal(row('1.00').economic_kind, null);
});
test('import: CSV quotes, multiline descriptions, Unicode, BOM and leading-zero IDs survive', async () => {
  const input =
    '\ufeffData;Descrição;Valor;ID\r\n16/10/2026;"SYNTHETIC ação; ""aspas""\nlinha";-1.234,56;000001\r\n';
  const { rows } = await collect(request(input));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_external_id, '000001');
  assert.equal(rows[0].original_description, 'SYNTHETIC ação; "aspas"\nlinha');
  assert.equal(rows[0].normalized_amount_minor, '-123456');
  assert.equal(rows[0].proposed_name, 'SYNTHETIC ação; "aspas" linha');
  assert.match(rows[0].provenance.source_locator, /csv:record:2:end-line:/);
});
test('import: CSV mapping is mandatory and duplicate/missing headers are rejected', async () => {
  for (const delimiter of [',', '\t']) {
    const input =
      ['When', 'Text', 'Amount', 'ID'].join(delimiter) +
      '\n' +
      ['2026-10-16', 'SYNTHETIC', '12.34', '0001'].join(delimiter);
    const parsed = await collect(
      request(input, 'CSV', {
        mapping: {
          delimiter,
          dateFormat: 'YYYY-MM-DD',
          decimal: '.',
          grouping: null,
          amountMode: 'ACCOUNT_DELTA',
          columns: {
            date: 'When',
            description: 'Text',
            amount: 'Amount',
            externalId: 'ID',
          },
        },
      }),
    );
    assert.equal(parsed.rows[0].normalized_amount_minor, '1234');
  }
  await assert.rejects(
    collect(request(csvFixture(1), 'CSV', { mapping: undefined })),
    { code: 'INVALID_MAPPING' },
  );
  await assert.rejects(
    collect(
      request(csvFixture(1), 'CSV', {
        mapping: {
          ...mapping,
          columns: { ...mapping.columns, amount: 'Data' },
        },
      }),
    ),
    { code: 'INVALID_MAPPING' },
  );
  await assert.rejects(collect(request('Data;Data;Valor;ID\n1;2;3;4')), {
    code: 'INVALID_HEADER',
  });
  await assert.rejects(collect(request('When;Descrição;Valor;ID\n1;2;3;4')), {
    code: 'INVALID_HEADER',
  });
});
test('import: invalid dates, excess cents and column mismatch stay visible per row', async () => {
  const { rows, metadata } = await collect(
    request(
      'Data;Descrição;Valor;ID\n31/02/2026;SYNTHETIC;1,001;one\n16/10/2026;SYNTHETIC;1,00;two;extra\n',
    ),
  );
  assert.equal(metadata.rows, 2);
  assert.equal(metadata.invalid_rows, 2);
  assert.deepEqual(rows[0].validation_errors, [
    { field: 'date', code: 'INVALID_DATE' },
    { field: 'amount', code: 'INVALID_AMOUNT' },
  ]);
  assert.equal(rows[1].validation_errors.at(-1).code, 'COLUMN_COUNT');
});
test('import: debit-credit mapping rejects contradictory values and does not infer expense kind', async () => {
  const split = {
    ...mapping,
    amountMode: 'DEBIT_CREDIT',
    columns: {
      date: 'Data',
      description: 'Descrição',
      debit: 'D',
      credit: 'C',
    },
  };
  const { rows } = await collect(
    request(
      'Data;Descrição;D;C\n16/10/2026;SYNTHETIC;1,00;2,00\n16/10/2026;SYNTHETIC;12,34;\n16/10/2026;SYNTHETIC;;5,00\n',
      'CSV',
      { mapping: split },
    ),
  );
  assert.equal(rows[0].disposition, 'INVALID');
  assert.equal(rows[0].validation_errors[0].code, 'AMBIGUOUS_DEBIT_CREDIT');
  assert.equal(rows[1].normalized_amount_minor, '-1234');
  assert.equal(rows[2].normalized_amount_minor, '500');
  assert.ok(rows.every((row) => row.economic_kind === null));
});
test('import: duplicate IDs, divergent values and legitimate equal purchases retain every row', async () => {
  const { rows } = await collect(
    request(
      'Data;Descrição;Valor;ID\n16/10/2026;SYNTHETIC;1,00;a\n16/10/2026;SYNTHETIC;1,00;a\n16/10/2026;SYNTHETIC;2,00;a\n16/10/2026;SYNTHETIC;1,00;b\n',
    ),
  );
  assert.deepEqual(
    rows.map((row) => row.disposition),
    ['NEW', 'DUPLICATE', 'POSSIBLE_DUPLICATE', 'NEW'],
  );
  assert.equal(rows[1].candidate_row_no, 1);
  assert.ok(rows[2].warnings.includes('SOURCE_ID_DIVERGENCE'));
});
test('import: OFX 102 omitted leaf closes and OFX XML produce identical normalized records', async () => {
  for (const accountType of ['SAVINGS', 'MONEYMRKT']) {
    const parsed = await collect(
      request(ofxFixture(1).replace('CHECKING', accountType), 'OFX'),
    );
    assert.equal(parsed.rows[0].disposition, 'NEW');
  }
  const sgml = await collect(request(ofxFixture(5), 'OFX'));
  const xml = await collect(request(ofxFixture(5, { xml: true }), 'OFX'));
  assert.deepEqual(sgml.rows, xml.rows);
  assert.equal(sgml.metadata.normalized_sha256, xml.metadata.normalized_sha256);
  assert.equal(xml.metadata.rows, 5);
  assert.ok(xml.rows.every((row) => row.disposition === 'NEW'));
});
test('import: missing FITID, corrections and unknown types are invalid rows rather than lost records', async () => {
  const input = ofxFixture(1, { xml: true })
    .replace(/<FITID>[^<]*<\/FITID>/, '')
    .replace(
      '<TRNTYPE>CREDIT</TRNTYPE>',
      '<TRNTYPE>UNKNOWN</TRNTYPE><CORRECTFITID>SYNTHETIC-OLD</CORRECTFITID>',
    );
  const { rows } = await collect(request(input, 'OFX'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].disposition, 'INVALID');
  assert.deepEqual(
    rows[0].validation_errors.map((error) => error.code),
    [
      'MISSING_SOURCE_ID',
      'UNSUPPORTED_CORRECTION',
      'UNSUPPORTED_TRANSACTION_TYPE',
    ],
  );
});
test('import: malformed aggregates, unsupported layouts, currency and target kind fail the whole source', async () => {
  for (const [input, code] of [
    [ofxFixture(1).slice(0, -6), 'INVALID_OFX'],
    [
      ofxFixture(1).replace('CHECKING', 'CREDITLINE'),
      'UNSUPPORTED_ACCOUNT_TYPE',
    ],
    [
      ofxFixture(1).split('<OFX>')[0] + '<OFX>' + '<'.repeat(10000),
      'INVALID_OFX',
    ],
    [ofxFixture(1).replace('<CURDEF>BRL', '<CURDEF>USD'), 'CURRENCY_MISMATCH'],
    [
      ofxFixture(1).replace('<BANKTRANLIST>', '<FOREIGN>'),
      'UNSUPPORTED_LAYOUT',
    ],
  ])
    await assert.rejects(collect(request(input, 'OFX')), { code });
  await assert.rejects(
    collect(
      request(ofxFixture(1), 'OFX', {
        context: { ...context, balance_nature: 'LIABILITY' },
      }),
    ),
    { code: 'ACCOUNT_KIND_MISMATCH' },
  );
});
test('import: DTD/entities are refused and predefined XML escapes are decoded as literal text', async () => {
  const xml = ofxFixture(1, { xml: true });
  await assert.rejects(
    collect(
      request(
        xml.replace(
          '<OFX>',
          '<!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///SYNTHETIC">]><OFX>',
        ),
        'OFX',
      ),
    ),
    { code: 'XML_DECLARATION_FORBIDDEN' },
  );
  await assert.rejects(
    collect(request(xml.replace('SYNTHETIC-ID-000001', '&unknown;'), 'OFX')),
    { code: 'INVALID_OFX' },
  );
  const literal = await collect(
    request(
      xml.replace('SYNTHETIC ação;', 'SYNTHETIC &lt;script&gt; &amp; ação;'),
      'OFX',
    ),
  );
  assert.match(literal.rows[0].original_description, /<script> & ação/);
});
test('import: formula-like CSV cells remain literal and carry a review warning', async () => {
  const { rows } = await collect(
    request('Data;Descrição;Valor;ID\n16/10/2026;=SYNTHETIC(1);1,00;id\n'),
  );
  assert.equal(rows[0].original_description, '=SYNTHETIC(1)');
  assert.deepEqual(rows[0].warnings, ['FORMULA_LIKE_TEXT']);
});
test('import: destination, MIME, encoding and binary content are rejected without leaking raw input', async () => {
  for (const [overrides, code] of [
    [{ context: { ...context, workspace_id: 'bad' } }, 'INVALID_DESTINATION'],
    [{ extension: '.xlsx' }, 'TYPE_MISMATCH'],
    [{ encoding: 'utf-16' }, 'UNSUPPORTED_FORMAT'],
    [{ bytes: Buffer.from([0xc3, 0x28]) }, 'INVALID_ENCODING'],
    [{ bytes: Buffer.from('a\0b') }, 'INVALID_CONTENT'],
  ])
    await assert.rejects(collect(request(csvFixture(1), 'CSV', overrides)), {
      code,
    });
});
test('import: empty records are invalid review rows and malformed CSV is a source error', async () => {
  const { rows } = await collect(
    request('Data;Descrição;Valor;ID\n\n16/10/2026;SYNTHETIC;1,00;id\n'),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].disposition, 'INVALID');
  await assert.rejects(
    collect(request('Data;Descrição;Valor;ID\n"unterminated')),
    { code: 'INVALID_CSV' },
  );
});
test('import: cancellation and deadline are checked before consuming any row', async () => {
  let consumed = 0;
  await assert.rejects(
    parseStatement(request(csvFixture(1)), {
      consume: () => consumed++,
      cancelled: () => true,
    }),
    { code: 'CANCELLED' },
  );
  let calls = 0;
  await assert.rejects(
    parseStatement(request(csvFixture(1)), {
      consume: () => consumed++,
      now: () => (calls++ ? limits.timeoutMs + 1 : 0),
    }),
    { code: 'TIME_LIMIT' },
  );
  assert.equal(consumed, 0);
});
