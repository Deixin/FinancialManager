// FIN-002 / US-052. Synthetic accounts, descriptions and amounts only.
import { xmlHeader, sgmlHeader } from '../import-file-validation/corpus.mjs';
export const destination = Object.freeze({
  workspace_id: '0199d052-0000-7000-8000-000000000001',
  account_id: '0199d052-0000-7000-8000-000000000002',
  balance_nature: 'ASSET',
  currency: 'BRL',
});
export function transaction(fields = {}) {
  return (
    '<STMTTRN>' +
    Object.entries({
      TRNTYPE: 'OTHER',
      DTPOSTED: '20261025123000.000[-3:BRT]',
      TRNAMT: '-123.45',
      FITID: 'SYNTHETIC-FITID-1',
      MEMO: 'SYNTHETIC purchase',
      ...fields,
    })
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('') +
    '</STMTTRN>'
  );
}
export function statement(rows = transaction(), options = {}) {
  const {
    card = false,
    sgml = false,
    encoding = 'utf-8',
    currency = 'BRL',
    from = '20261001',
    to = '20261101',
    status = '0',
  } = options;
  const kind = card ? 'CCSTMTRS' : 'STMTRS',
    response = card ? 'CCSTMTTRNRS' : 'STMTTRNRS',
    messages = card ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1';
  const account = card
    ? '<CCACCTFROM><ACCTID>SYNTHETIC-CARD-ONLY</ACCTID></CCACCTFROM>'
    : '<BANKACCTFROM><BANKID>999</BANKID><BRANCHID>0000</BRANCHID><ACCTID>SYNTHETIC-BANK-ONLY</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>';
  let text = `<OFX><${messages}><${response}><TRNUID>0</TRNUID><STATUS><CODE>${status}</CODE><SEVERITY>INFO</SEVERITY></STATUS><${kind}><CURDEF>${currency}</CURDEF>${account}<BANKTRANLIST><DTSTART>${from}</DTSTART><DTEND>${to}</DTEND>${rows}</BANKTRANLIST></${kind}></${response}></${messages}></OFX>`;
  if (sgml)
    text = text.replace(
      /<\/(?:TRNUID|CODE|SEVERITY|CURDEF|BANKID|BRANCHID|ACCTID|ACCTTYPE|DTSTART|DTEND|TRNTYPE|DTPOSTED|TRNAMT|FITID|MEMO|NAME|CORRECTFITID|CORRECTACTION)>/g,
      '',
    );
  return (
    (sgml
      ? sgmlHeader.replace(
          'ENCODING:UNICODE\nCHARSET:UTF-8',
          encoding === 'windows-1252'
            ? 'ENCODING:USASCII\nCHARSET:1252'
            : 'ENCODING:UNICODE\nCHARSET:UTF-8',
        )
      : xmlHeader) + text
  );
}
export function request(text = statement(), encoding = 'utf-8') {
  const bytes =
    encoding === 'utf-8'
      ? new globalThis.TextEncoder().encode(text)
      : Uint8Array.from(text, (c) => (c === '€' ? 0x80 : c.charCodeAt(0)));
  return {
    file_name: 'SYNTHETIC-statement.ofx',
    mime: '',
    encoding,
    delimiter: null,
    bytes,
  };
}
function check(condition) {
  if (!condition) throw Error('SYNTHETIC_OFX_EXPECTATION_FAILED');
}
function equal(actual, expected) {
  check(JSON.stringify(actual) === JSON.stringify(expected));
}
export async function executeOfxCorpus(api, { benchmark = true } = {}) {
  const results = [];
  const valid = async (
    name,
    text,
    target = destination,
    encoding = 'utf-8',
    inspect = () => {},
  ) => {
    const req = request(text, encoding),
      before = req.bytes.slice();
    const value = await api.parseOfx(req, target);
    equal([...req.bytes], [...before]);
    check(
      Object.isFrozen(value) &&
        Object.isFrozen(value.items) &&
        Object.isFrozen(value.destination) &&
        Object.isFrozen(value.source),
    );
    for (const row of value.items)
      check(
        Object.isFrozen(row) &&
          Object.isFrozen(row.provenance.fields) &&
          Object.isFrozen(row.validation_errors) &&
          row.validation_errors.every(Object.isFrozen) &&
          Object.isFrozen(row.warnings),
      );
    check(
      !JSON.stringify(value).includes('SYNTHETIC-BANK-ONLY') &&
        !JSON.stringify(value).includes('SYNTHETIC-CARD-ONLY'),
    );
    inspect(value);
    results.push({ name, value });
    return value;
  };
  const invalid = async (name, text, code, target = destination) => {
    try {
      await api.parseOfx(request(text), target);
    } catch (error) {
      equal(error.code, code);
      equal(error.message, code);
      results.push({ name, error: code });
      return;
    }
    throw Error('SYNTHETIC_OFX_REJECTION_EXPECTED');
  };
  const bank = await valid(
    'xml-bank-golden',
    statement(
      transaction({ TRNTYPE: 'DEBIT' }) +
        transaction({
          TRNTYPE: 'CREDIT',
          TRNAMT: '+0.01',
          FITID: 'SYNTHETIC-FITID-2',
          MEMO: 'SYNTHETIC credit',
        }),
    ),
    destination,
    'utf-8',
    (value) => {
      equal(
        value.items.map((r) => [
          r.normalized_date,
          r.normalized_amount_minor,
          r.original_description,
          r.source_external_id,
          r.disposition,
        ]),
        [
          [
            '2026-10-25',
            '-12345',
            'SYNTHETIC purchase',
            'SYNTHETIC-FITID-1',
            'NEW',
          ],
          ['2026-10-25', '1', 'SYNTHETIC credit', 'SYNTHETIC-FITID-2', 'NEW'],
        ],
      );
      equal(value.source.period_start, '2026-10-01');
      equal(value.source.period_end, '2026-11-01');
      equal(
        value.items[0].provenance.source_locator,
        '/OFX/BANKMSGSRSV1/STMTTRNRS/STMTRS/BANKTRANLIST/STMTTRN[1]',
      );
      equal(
        value.items[1].provenance.fields.amount,
        '/OFX/BANKMSGSRSV1/STMTTRNRS/STMTRS/BANKTRANLIST/STMTTRN[2]/TRNAMT',
      );
    },
  );
  const replay = await api.parseOfx(
    request(
      statement(
        transaction({ TRNTYPE: 'DEBIT' }) +
          transaction({
            TRNTYPE: 'CREDIT',
            TRNAMT: '+0.01',
            FITID: 'SYNTHETIC-FITID-2',
            MEMO: 'SYNTHETIC credit',
          }),
      ),
    ),
    destination,
  );
  equal(replay, bank);
  results.push({ name: 'deterministic-replay', passed: true });
  await valid(
    'sgml-bank-golden',
    statement(transaction(), { sgml: true }),
    destination,
    'utf-8',
    (v) => {
      equal(v.items[0].normalized_amount_minor, '-12345');
      equal(v.source.layout, 'OFX_102_SGML');
    },
  );
  await valid(
    'sgml-1252',
    statement(transaction({ MEMO: 'SYNTHETIC café €' }), {
      sgml: true,
      encoding: 'windows-1252',
    }),
    destination,
    'windows-1252',
    (v) => equal(v.items[0].original_description, 'SYNTHETIC café €'),
  );
  const card = { ...destination, balance_nature: 'LIABILITY' };
  await valid(
    'card-purchase-and-payment',
    statement(
      transaction({ TRNTYPE: 'DEBIT', TRNAMT: '-25.90' }) +
        transaction({ TRNTYPE: 'CREDIT', TRNAMT: '10', FITID: 'SYNTHETIC-2' }),
      { card: true },
    ),
    card,
    'utf-8',
    (v) =>
      equal(
        v.items.map((r) => [r.normalized_amount_minor, r.disposition]),
        [
          ['2590', 'NEW'],
          ['-1000', 'NEW'],
        ],
      ),
  );
  for (const [name, amount, target, expected, error] of [
    [
      'i64-max',
      '92233720368547758.07',
      destination,
      '9223372036854775807',
      null,
    ],
    [
      'i64-min',
      '-92233720368547758.08',
      destination,
      '-9223372036854775808',
      null,
    ],
    [
      'i64-overflow',
      '92233720368547758.08',
      destination,
      null,
      'AMOUNT_OUT_OF_RANGE',
    ],
    [
      'i64-underflow',
      '-92233720368547758.09',
      destination,
      null,
      'AMOUNT_OUT_OF_RANGE',
    ],
    [
      'liability-min',
      '92233720368547758.08',
      card,
      '-9223372036854775808',
      null,
    ],
    [
      'liability-overflow',
      '-92233720368547758.08',
      card,
      null,
      'AMOUNT_OUT_OF_RANGE',
    ],
    ['canonical-minor', '+0001.2', destination, '120', null],
    ['no-rounding', '1.001', destination, null, 'INVALID_AMOUNT'],
    ['no-exponent', '1e3', destination, null, 'INVALID_AMOUNT'],
    ['no-grouping', '1,000.00', destination, null, 'INVALID_AMOUNT'],
    ['zero-is-invalid', '-0.00', destination, '0', 'ZERO_AMOUNT'],
  ])
    await valid(
      name,
      statement(transaction({ TRNAMT: amount }), {
        card: target.balance_nature === 'LIABILITY',
      }),
      target,
      'utf-8',
      (v) => {
        equal(v.items[0].normalized_amount_minor, expected);
        equal(
          v.items[0].validation_errors.map((e) => e.code),
          error ? [error] : [],
        );
      },
    );
  for (const [raw, expected] of [
    ['20240229', '2024-02-29'],
    ['20260229', null],
    ['00000101', null],
    ['20261025235960.001[-12:X]', '2026-10-25'],
    ['20261025000100[12:X]', '2026-10-25'],
    ['20261025000100[13:X]', null],
    ['20261025240000', null],
    ['20261025126000', null],
    ['20261025120061', null],
    ['2026102512', null],
  ])
    await valid(
      'date-' + raw,
      statement(transaction({ DTPOSTED: raw })),
      destination,
      'utf-8',
      (v) => {
        equal(v.items[0].normalized_date, expected);
        equal(
          v.items[0].validation_errors.map((e) => e.code),
          expected ? [] : ['INVALID_DATE'],
        );
      },
    );
  await valid(
    'entities-decoded-once',
    statement(transaction({ MEMO: 'SYNTHETIC &amp;lt; &amp; &#x1F600;' })),
    destination,
    'utf-8',
    (v) => equal(v.items[0].original_description, 'SYNTHETIC &lt; & 😀'),
  );
  await valid(
    'memo-name-fallback',
    statement(transaction({ MEMO: null, NAME: 'SYNTHETIC  name' })),
    destination,
    'utf-8',
    (v) => {
      equal(v.items[0].original_description, 'SYNTHETIC  name');
      equal(v.items[0].proposed_name, 'SYNTHETIC name');
      check(v.items[0].provenance.fields.description.endsWith('/NAME'));
    },
  );
  await valid(
    'missing-fitid',
    statement(transaction({ FITID: null })),
    destination,
    'utf-8',
    (v) => {
      equal(v.items[0].source_external_id, null);
      equal(v.items[0].disposition, 'NEW');
      check(v.items[0].warnings.includes('MISSING_SOURCE_ID'));
    },
  );
  await valid(
    'repeated-fitid-retains-both',
    statement(transaction() + transaction()),
    destination,
    'utf-8',
    (v) => {
      equal(v.items.length, 2);
      check(
        v.items.every(
          (r) =>
            r.disposition === 'NEW' &&
            r.warnings.includes('REPEATED_SOURCE_ID'),
        ),
      );
    },
  );
  for (const [name, fields, error] of [
    ['type-unknown', { TRNTYPE: 'EXECUTE' }, 'UNSUPPORTED_TRANSACTION_TYPE'],
    ['credit-sign', { TRNTYPE: 'CREDIT' }, 'SIGN_TYPE_MISMATCH'],
    ['debit-sign', { TRNTYPE: 'DEBIT', TRNAMT: '1' }, 'SIGN_TYPE_MISMATCH'],
    [
      'correction',
      { CORRECTFITID: 'SYNTHETIC-OLD', CORRECTACTION: 'DELETE' },
      'CORRECTION_REQUIRES_REVIEW',
    ],
    ['description-bidi', { MEMO: 'SYNTHETIC &#x202E;' }, 'INVALID_DESCRIPTION'],
    ['description-empty', { MEMO: null, NAME: null }, 'INVALID_DESCRIPTION'],
    ['source-id-bidi', { FITID: 'SYNTHETIC&#x202E;' }, 'INVALID_SOURCE_ID'],
    ['date-missing', { DTPOSTED: null }, 'INVALID_DATE'],
    ['amount-missing', { TRNAMT: null }, 'INVALID_AMOUNT'],
  ])
    await valid(
      name,
      statement(transaction(fields)),
      destination,
      'utf-8',
      (v) => {
        equal(v.items[0].disposition, 'INVALID');
        check(v.items[0].validation_errors.some((e) => e.code === error));
      },
    );
  for (const type of ['XFER', 'PAYMENT'])
    await valid(
      'type-' + type + '-review',
      statement(transaction({ TRNTYPE: type })),
      destination,
      'utf-8',
      (v) => {
        check(v.items[0].warnings.includes('MOVEMENT_REQUIRES_REVIEW'));
        equal(v.items[0].source_transaction_type, type);
        check(v.items[0].provenance.fields.type.endsWith('/TRNTYPE'));
      },
    );
  const baseOne = await api.parseOfx(request(), destination);
  await valid(
    'utf8-bom-raw-identity',
    '\uFEFF' + statement(),
    destination,
    'utf-8',
    (v) => {
      equal(
        v.items[0].normalized_amount_minor,
        baseOne.items[0].normalized_amount_minor,
      );
      equal(v.source.source_account_hash, baseOne.source.source_account_hash);
      check(v.source.file_hash !== baseOne.source.file_hash);
    },
  );
  const inner = request(),
    framed = new Uint8Array(inner.bytes.length + 2);
  framed.set(inner.bytes, 1);
  const viewResult = await api.parseOfx(
    { ...inner, bytes: framed.subarray(1, -1) },
    destination,
  );
  equal(viewResult, baseOne);
  results.push({ name: 'byte-view-identity', value: viewResult });
  await valid(
    'outside-period-retained',
    statement(transaction({ DTPOSTED: '20250101' })),
    destination,
    'utf-8',
    (v) => check(v.items[0].warnings.includes('DATE_OUTSIDE_SOURCE_PERIOD')),
  );
  for (const [name, text, code] of [
    [
      'unknown-element',
      statement().replace('<CURDEF>', '<UNKNOWN>x</UNKNOWN><CURDEF>'),
      'INVALID_OFX_STRUCTURE',
    ],
    [
      'duplicate-amount',
      statement().replace('</TRNAMT>', '</TRNAMT><TRNAMT>1</TRNAMT>'),
      'INVALID_OFX_STRUCTURE',
    ],
    [
      'duplicate-currency',
      statement().replace('</CURDEF>', '</CURDEF><CURDEF>USD</CURDEF>'),
      'INVALID_OFX_STRUCTURE',
    ],
    [
      'misplaced-row',
      statement().replace('<BANKTRANLIST>', transaction() + '<BANKTRANLIST>'),
      'INVALID_OFX_STRUCTURE',
    ],
    [
      'source-failure',
      statement(transaction(), { status: '2000' }),
      'OFX_SOURCE_ERROR',
    ],
    [
      'missing-status',
      statement().replace(/<STATUS>.*?<\/STATUS>/, ''),
      'OFX_SOURCE_ERROR',
    ],
    [
      'missing-account',
      statement().replace(/<BANKACCTFROM>.*?<\/BANKACCTFROM>/, ''),
      'INVALID_OFX_STRUCTURE',
    ],
    [
      'missing-id',
      statement().replace(/<ACCTID>.*?<\/ACCTID>/, ''),
      'INVALID_SOURCE_ACCOUNT',
    ],
    [
      'wrong-account-type',
      statement().replace('CHECKING', 'CREDITLINE'),
      'INVALID_SOURCE_ACCOUNT',
    ],
    [
      'wrong-currency',
      statement(transaction(), { currency: 'USD' }),
      'CURRENCY_MISMATCH',
    ],
    [
      'wrong-target',
      statement(transaction(), { card: true }),
      'ACCOUNT_KIND_MISMATCH',
    ],
    [
      'period-reversed',
      statement(transaction(), { from: '20261102' }),
      'INVALID_PERIOD',
    ],
    [
      'period-malformed',
      statement(transaction(), { to: '20260230' }),
      'INVALID_PERIOD',
    ],
    ['empty-statement', statement(''), 'EMPTY_STATEMENT'],
    ['truncated', statement().slice(0, -6), 'INVALID_OFX'],
    [
      'xxe',
      statement().replace(
        '<OFX>',
        '<!DOCTYPE OFX SYSTEM "file:///SYNTHETIC"><OFX>',
      ),
      'ACTIVE_CONTENT',
    ],
    [
      'second-statement',
      statement().replace(
        '</BANKMSGSRSV1>',
        statement().split('<BANKMSGSRSV1>')[1].split('</BANKMSGSRSV1>')[0] +
          '</BANKMSGSRSV1>',
      ),
      'INVALID_OFX_STRUCTURE',
    ],
  ])
    await invalid(name, text, code);
  await invalid(
    'destination-extra-fields',
    statement(),
    'INVALID_DESTINATION',
    { ...destination, authorized: true },
  );
  await invalid('destination-wrong-id', statement(), 'INVALID_DESTINATION', {
    ...destination,
    workspace_id: 'OTHER',
  });
  const captured = request(),
    bytes = captured.bytes.slice(),
    target = { ...destination };
  const inFlight = api.parseOfx(captured, target);
  captured.bytes.fill(0);
  captured.file_name = 'OTHER.csv';
  target.workspace_id = 'OTHER';
  const frozen = await inFlight;
  equal(frozen.destination, destination);
  equal(frozen.source.file_name, 'SYNTHETIC-statement.ofx');
  equal(frozen.items[0].normalized_amount_minor, '-12345');
  check(bytes[0] !== 0);
  results.push({ name: 'snapshot-and-destination-captured', passed: true });
  for (const immediate of [true, false]) {
    const controller = new globalThis.AbortController();
    if (immediate) controller.abort();
    const pending = api.parseOfx(request(), destination, controller.signal);
    controller.abort();
    try {
      await pending;
      throw Error('SYNTHETIC_CANCEL_EXPECTED');
    } catch (error) {
      equal(error.code, 'CANCELLED');
    }
    results.push({
      name: immediate ? 'cancel-before' : 'cancel-during-hash',
      error: 'CANCELLED',
    });
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis.performance,
    'now',
  );
  let ticks = 0;
  try {
    Object.defineProperty(globalThis.performance, 'now', {
      configurable: true,
      value: () => (ticks++ < 3 ? 0 : 30001),
    });
    await invalid('deadline-during-scan', statement(), 'TIME_LIMIT');
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis.performance, 'now', descriptor);
    else delete globalThis.performance.now;
  }
  try {
    let expired = false;
    Object.defineProperty(globalThis.performance, 'now', {
      configurable: true,
      value: () => (expired ? 30001 : 0),
    });
    const inFlight = api.parseOfx(request(), destination);
    expired = true;
    try {
      await inFlight;
      throw Error('SYNTHETIC_DEADLINE_EXPECTED');
    } catch (error) {
      equal(error.code, 'TIME_LIMIT');
    }
    results.push({ name: 'deadline-after-hashing', error: 'TIME_LIMIT' });
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis.performance, 'now', descriptor);
    else delete globalThis.performance.now;
  }
  if (benchmark) {
    const rows = Array.from({ length: 10000 }, (_, i) =>
      transaction({ FITID: 'SYNTHETIC-' + i, TRNAMT: '-0.01' }),
    ).join('');
    const started = globalThis.performance.now(),
      value = await api.parseOfx(request(statement(rows)), destination);
    check(globalThis.performance.now() - started < 30000);
    equal(value.items.length, 10000);
    equal(value.items[0].normalized_amount_minor, '-1');
    equal(value.items[9999].normalized_amount_minor, '-1');
    check(
      value.items[9999].provenance.source_locator.endsWith('STMTTRN[10000]'),
    );
    results.push({
      name: 'ten-thousand-rows-under-deadline',
      records: value.items.length,
    });
    await invalid(
      'ten-thousand-plus-one',
      statement(rows + transaction({ FITID: 'SYNTHETIC-10000' })),
      'ROW_LIMIT',
    );
  }
  return results;
}
