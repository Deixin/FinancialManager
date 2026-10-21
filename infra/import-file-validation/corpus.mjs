// FIN-002 / US-051. All examples are synthetic, including hostile inputs.
export const xmlHeader =
  '<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="203" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n';
export const sgmlHeader =
  'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UNICODE\nCHARSET:UTF-8\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n';
export const bankBody =
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST><STMTTRN><MEMO>Exemplo sintético &amp; texto</MEMO><TRNAMT>-1.23</TRNAMT></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';

export function corpus() {
  const csv = {
    file_name: 'sintetico.csv',
    mime: 'text/csv',
    encoding: 'utf-8',
    delimiter: ',',
  };
  const ofx = {
    file_name: 'sintetico.ofx',
    mime: 'application/x-ofx',
    encoding: 'utf-8',
    delimiter: null,
  };
  const cases = [];
  const recordBoundary = [
    'x'.repeat(2047),
    'y'.repeat(2047),
    'z'.repeat(2047),
    'w'.repeat(2048),
  ].join(',');
  const add = (
    name,
    text,
    error = null,
    metadata = {},
    expected = {},
    format = csv,
  ) =>
    cases.push({
      name,
      request: { ...format, ...metadata },
      text,
      error,
      expected,
    });
  add(
    'csv-basic',
    'data,descricao,valor\n2026-01-01,Exemplo sintetico,1.00\n',
    null,
    {},
    { records: 1, columns: 3, format: 'CSV' },
  );
  add('csv-record-boundary-no-newline', 'a,b,c,d\n' + recordBoundary, null);
  add(
    'csv-record-boundary-crlf',
    'a,b,c,d\r\n' + recordBoundary + '\r\n',
    null,
  );
  add(
    'csv-record-boundary-overflow',
    'a,b,c,d\n' + recordBoundary + ',',
    'RECORD_LIMIT',
  );
  add(
    'csv-bom-crlf',
    '\ufeffdata;descricao;valor\r\n2026-01-01;Sintético;1,00\r\n',
    null,
    { delimiter: ';', mime: 'text/csv; charset=UTF-8' },
    { records: 1 },
  );
  add(
    'csv-quoted-multiline',
    'a,b,c\n"linha\n2","aspas ""duplas""",3',
    null,
    {},
    { records: 1 },
  );
  add('csv-tab', 'a\tb\n1\t2', null, { delimiter: '\t', mime: 'text/plain' });
  add(
    'csv-ragged-kept-for-review',
    'a,b,c\n1,2\n3,4,5,6',
    null,
    {},
    { records: 2, columns: 4 },
  );
  add(
    'csv-formulas-inert',
    'a,b\n"=HYPERLINK(""https://synthetic.invalid"")",@SUM(A1)\n+1,-1',
    null,
  );
  add('csv-generic-mime', 'a,b\n1,2', null, {
    mime: 'application/octet-stream',
    file_name: 'SINTETICO.CSV',
  });
  add('csv-empty-mime', 'a,b\n1,2', null, { mime: '' });
  add('csv-cp1252', 'a,b\n1,café €', null, { encoding: 'windows-1252' });
  add('csv-field-boundary', 'a,b\n1,' + 'x'.repeat(2048), null);
  add(
    'csv-column-boundary',
    Array(64).fill('a').join(',') + '\n' + Array(64).fill('b').join(','),
    null,
    {},
    { columns: 64 },
  );
  add(
    'csv-row-boundary',
    'a,b\n' + '1,2\n'.repeat(10000),
    null,
    {},
    { records: 10000 },
  );
  add(
    'ofx-xml',
    xmlHeader + bankBody,
    null,
    {},
    { records: 1, format: 'OFX' },
    ofx,
  );
  add(
    'ofx-sgml-omitted-scalars',
    sgmlHeader +
      bankBody
        .replaceAll('</CURDEF>', '')
        .replaceAll('</MEMO>', '')
        .replaceAll('</TRNAMT>', ''),
    null,
    {},
    { records: 1 },
    ofx,
  );
  add(
    'ofx-cp1252',
    sgmlHeader.replace('UNICODE', 'USASCII').replace('UTF-8', '1252') +
      bankBody,
    null,
    { encoding: 'windows-1252' },
    {},
    ofx,
  );
  add(
    'ofx-fixed-entities',
    xmlHeader +
      '<OFX><NAME>&lt;&gt;&amp;&apos;&quot;&#65;&#x1F600;</NAME></OFX>',
    null,
    {},
    {},
    ofx,
  );
  add(
    'ofx-depth-boundary',
    xmlHeader + '<OFX>' + '<A>'.repeat(31) + '</A>'.repeat(31) + '</OFX>',
    null,
    {},
    { depth: 32 },
    ofx,
  );
  add(
    'ofx-row-boundary',
    xmlHeader +
      '<OFX><BANKTRANLIST>' +
      '<STMTTRN><MEMO>x</MEMO></STMTTRN>'.repeat(10000) +
      '</BANKTRANLIST></OFX>',
    null,
    {},
    { records: 10000 },
    ofx,
  );
  add('empty', '', 'EMPTY_FILE');
  add('header-only', 'a,b\n', 'EMPTY_FILE');
  add(
    'plain-text',
    'Exemplo sintetico sem delimitador\nmais texto',
    'TYPE_MISMATCH',
  );
  add('xml-as-csv', xmlHeader + bankBody, 'TYPE_MISMATCH');
  add(
    'html-as-csv',
    '<html><script>globalThis.executed=true</script></html>',
    'TYPE_MISMATCH',
  );
  add('json-as-csv', '{"a":1,"b":2}', 'TYPE_MISMATCH');
  add('zip-signature', 'PK\u0003\u0004,pretenso\n1,2', 'TYPE_MISMATCH');
  add('pdf-signature', '%PDF-1.7,a\n1,2', 'TYPE_MISMATCH');
  add('exe-signature', 'MZ,a\n1,2', 'TYPE_MISMATCH');
  add('wrong-mime', 'a,b\n1,2', 'TYPE_MISMATCH', { mime: 'text/html' });
  add('mime-charset-mismatch', 'a,b\n1,2', 'TYPE_MISMATCH', {
    mime: 'text/csv;charset=windows-1252',
  });
  add('mime-injection', 'a,b\n1,2', 'TYPE_MISMATCH', {
    mime: 'text/csv\r\nX-Injected: true',
  });
  add('null-byte', 'a,b\n1,\u0000', 'INVALID_CONTENT');
  add('control-byte', 'a,b\n1,\u0007', 'INVALID_CONTENT');
  add('unicode-replacement', 'a,b\n1,\ufffd', 'INVALID_CONTENT');
  add('field-overflow', 'a,b\n1,' + 'x'.repeat(2049), 'FIELD_LIMIT');
  add(
    'record-overflow',
    'a,b\n' + Array(5).fill('x'.repeat(1800)).join(','),
    'RECORD_LIMIT',
  );
  add(
    'columns-overflow',
    Array(65).fill('a').join(',') + '\n1,2',
    'COLUMN_LIMIT',
  );
  add('rows-overflow', 'a,b\n' + '1,2\n'.repeat(10001), 'ROW_LIMIT');
  add('lines-overflow', 'a,b\n' + '\n'.repeat(200000), 'LINE_LIMIT');
  add('quoted-unclosed', 'a,b\n1,"unterminated', 'INVALID_CSV');
  add('quote-in-unquoted', 'a,b\n1,ab"cd', 'INVALID_CSV');
  add('text-after-quote', 'a,b\n1,"ab"cd', 'INVALID_CSV');
  add('xlsx-disabled', 'PK\u0003\u0004', 'UNSUPPORTED_FORMAT', {
    file_name: 'sintetico.xlsx',
  });
  add('macro-disabled', 'PK\u0003\u0004', 'UNSUPPORTED_FORMAT', {
    file_name: 'sintetico.xlsm',
  });
  add('zip-disabled', 'PK\u0003\u0004', 'UNSUPPORTED_FORMAT', {
    file_name: 'sintetico.zip',
  });
  add('pdf-disabled', '%PDF-1.7', 'UNSUPPORTED_FORMAT', {
    file_name: 'sintetico.pdf',
  });
  add('fiscal-xml-disabled', '<nfeProc/>', 'UNSUPPORTED_FORMAT', {
    file_name: 'sintetico.xml',
  });
  add('double-extension', 'a,b\n1,2', 'UNSUPPORTED_FORMAT', {
    file_name: 'sintetico.csv.exe',
  });
  add('path-traversal', 'a,b\n1,2', 'INVALID_REQUEST', {
    file_name: '../sintetico.csv',
  });
  add('windows-ads', 'a,b\n1,2', 'INVALID_REQUEST', {
    file_name: 'sintetico.csv:payload',
  });
  add('bidi-filename', 'a,b\n1,2', 'INVALID_REQUEST', {
    file_name: 'sintetico\u202e.csv',
  });
  add('nul-filename', 'a,b\n1,2', 'INVALID_REQUEST', {
    file_name: 'sintetico\u0000.csv',
  });
  add('name-overflow', 'a,b\n1,2', 'INVALID_REQUEST', {
    file_name: 'a'.repeat(252) + '.csv',
  });
  add('no-encoding-guess', 'a,b\n1,2', 'INVALID_REQUEST', { encoding: 'auto' });
  add('no-delimiter-guess', 'a,b\n1,2', 'INVALID_REQUEST', { delimiter: null });
  add(
    'ofx-truncated',
    xmlHeader + bankBody.slice(0, -6),
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-misnested',
    xmlHeader + '<OFX><NAME>x</MEMO></OFX>',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-two-roots',
    xmlHeader + '<OFX></OFX><OFX></OFX>',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-suffix',
    xmlHeader + bankBody + 'trailing',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-xxe-file',
    xmlHeader +
      '<!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///synthetic-secret">]><OFX><NAME>&x;</NAME></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-xxe-http',
    xmlHeader +
      '<!DOCTYPE OFX SYSTEM "https://synthetic.invalid/x"><OFX></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-entity-bomb',
    xmlHeader +
      '<!DOCTYPE OFX [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><OFX><NAME>&b;</NAME></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-custom-entity',
    xmlHeader + '<OFX><NAME>&payload;</NAME></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-invalid-codepoint',
    xmlHeader + '<OFX><NAME>&#0;</NAME></OFX>',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-invalid-surrogate',
    xmlHeader + '<OFX><NAME>&#xD800;</NAME></OFX>',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-invalid-supplement',
    xmlHeader + '<OFX><NAME>&#x110000;</NAME></OFX>',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-attribute',
    xmlHeader + '<OFX><NAME href="https://synthetic.invalid">x</NAME></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-processing-instruction',
    xmlHeader +
      '<OFX><?xml-stylesheet href="https://synthetic.invalid"?></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-cdata',
    xmlHeader + '<OFX><NAME><![CDATA[payload]]></NAME></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-comment',
    xmlHeader + '<OFX><!-- payload --></OFX>',
    'ACTIVE_CONTENT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-depth-overflow',
    xmlHeader + '<OFX>' + '<A>'.repeat(32) + '</A>'.repeat(32) + '</OFX>',
    'DEPTH_LIMIT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-field-overflow',
    xmlHeader + '<OFX><NAME>' + 'x'.repeat(2049) + '</NAME></OFX>',
    'FIELD_LIMIT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-record-overflow',
    xmlHeader +
      '<OFX><STMTTRN>' +
      '<MEMO>xxx</MEMO>'.repeat(600) +
      '</STMTTRN></OFX>',
    'RECORD_LIMIT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-row-overflow',
    xmlHeader + '<OFX>' + '<STMTTRN></STMTTRN>'.repeat(10001) + '</OFX>',
    'ROW_LIMIT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-node-overflow',
    xmlHeader + '<OFX>' + '<A></A>'.repeat(500000) + '</OFX>',
    'NODE_LIMIT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-sgml-truncated-aggregate',
    sgmlHeader + '<OFX><BANKTRANLIST><STMTTRN><MEMO>x</BANKTRANLIST></OFX>',
    'INVALID_OFX',
    {},
    {},
    ofx,
  );
  add(
    'ofx-encoding-header-mismatch',
    sgmlHeader + bankBody,
    'ENCODING_MISMATCH',
    { encoding: 'windows-1252' },
    {},
    ofx,
  );
  add(
    'ofx-compressed-header',
    sgmlHeader.replace('COMPRESSION:NONE', 'COMPRESSION:ZIP') + bankBody,
    'UNSUPPORTED_LAYOUT',
    {},
    {},
    ofx,
  );
  add(
    'ofx-unknown-sgml',
    sgmlHeader + '<OFX><UNKNOWN>x</UNKNOWN></OFX>',
    'UNSUPPORTED_LAYOUT',
    {},
    {},
    ofx,
  );
  return cases;
}

// No dependency on Node APIs, so the same synthetic corpus runs in Chromium.
export function executeCorpus(api, cases) {
  const encoder = new globalThis.TextEncoder();
  const encode = (test) => {
    if (test.request.encoding !== 'windows-1252')
      return encoder.encode(test.text);
    return Uint8Array.from(
      [...test.text].map((char) => (char === '€' ? 0x80 : char.charCodeAt(0))),
    );
  };
  const results = [];
  for (const test of cases) {
    let actual;
    try {
      actual = api.validateImportFile({ ...test.request, bytes: encode(test) });
      if (
        test.error ||
        Object.entries(test.expected).some(([k, v]) => actual[k] !== v) ||
        !Object.isFrozen(actual)
      )
        throw Error('CORPUS_ASSERTION');
      if (
        Object.keys(actual).sort().join(',') !==
        'byte_length,columns,depth,encoding,format,policy_version,records'
      )
        throw Error('UNSAFE_RESULT');
      results.push({ name: test.name, result: actual });
    } catch (error) {
      if (
        !test.error ||
        !(error instanceof api.ImportFileError) ||
        error.code !== test.error ||
        error.message !== test.error
      )
        throw Error('CASE_FAILED: ' + test.name + ' ' + error.message);
      results.push({ name: test.name, error: error.code });
    }
  }
  const base = {
    file_name: 'sintetico.csv',
    mime: '',
    encoding: 'utf-8',
    delimiter: ',',
    bytes: encoder.encode('a,b\n1,2'),
  };
  const expect = (name, request, code, signal) => {
    try {
      api.validateImportFile(request, signal);
    } catch (error) {
      if (
        error instanceof api.ImportFileError &&
        error.code === code &&
        error.message === code
      ) {
        results.push({ name, error: code });
        return;
      }
    }
    throw Error('CASE_FAILED: ' + name);
  };
  expect(
    'invalid-utf8',
    { ...base, bytes: new Uint8Array([0xc0, 0xaf]) },
    'INVALID_ENCODING',
  );
  expect(
    'utf16-disabled',
    { ...base, bytes: new Uint8Array([0xff, 0xfe, 97, 0]) },
    'ENCODING_MISMATCH',
  );
  expect(
    'cp1252-bom-mismatch',
    {
      ...base,
      encoding: 'windows-1252',
      bytes: new Uint8Array([0xef, 0xbb, 0xbf, 97]),
    },
    'ENCODING_MISMATCH',
  );
  expect(
    'file-overflow',
    { ...base, bytes: new Uint8Array(api.importFileLimits.bytes + 1) },
    'FILE_LIMIT',
  );
  expect(
    'file-boundary-content-rejected',
    { ...base, bytes: new Uint8Array(api.importFileLimits.bytes) },
    'INVALID_CONTENT',
  );
  expect(
    'unknown-request-field',
    { ...base, destination: 'synthetic' },
    'INVALID_REQUEST',
  );
  expect('no-array-coercion', { ...base, bytes: [1, 2, 3] }, 'INVALID_REQUEST');
  expect('no-null-request', null, 'INVALID_REQUEST');
  expect('no-extension', { ...base, file_name: 'csv' }, 'UNSUPPORTED_FORMAT');
  const controller = new globalThis.AbortController();
  controller.abort();
  expect('cancelled', base, 'CANCELLED', controller.signal);
  if (typeof globalThis.SharedArrayBuffer !== 'undefined')
    expect(
      'shared-memory-rejected',
      { ...base, bytes: new Uint8Array(new globalThis.SharedArrayBuffer(8)) },
      'INVALID_REQUEST',
    );
  const nowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.performance,
    'now',
  );
  let ticks = 0;
  try {
    Object.defineProperty(globalThis.performance, 'now', {
      configurable: true,
      value: () => (ticks++ < 2 ? 0 : 30001),
    });
    expect(
      'deadline-during-scan',
      { ...base, bytes: encoder.encode('a,b\n1,' + 'x'.repeat(8000)) },
      'TIME_LIMIT',
    );
    const cancellation = new globalThis.AbortController();
    Object.defineProperty(globalThis.performance, 'now', {
      configurable: true,
      value: () => {
        cancellation.abort();
        return 0;
      },
    });
    expect('cancellation-checkpoint', base, 'CANCELLED', cancellation.signal);
  } finally {
    if (nowDescriptor)
      Object.defineProperty(globalThis.performance, 'now', nowDescriptor);
    else delete globalThis.performance.now;
  }
  const full =
    'a,b,c,d\n' +
    (
      'x'.repeat(1023) +
      ',' +
      'y'.repeat(1023) +
      ',' +
      'z'.repeat(1023) +
      ',' +
      'w'.repeat(1023) +
      '\n'
    ).repeat(4095) +
    'x'.repeat(1021) +
    ',' +
    'y'.repeat(1021) +
    ',' +
    'z'.repeat(1021) +
    ',' +
    'w'.repeat(1022);
  const fullBytes = encoder.encode(full);
  if (
    fullBytes.length !== api.importFileLimits.bytes ||
    api.validateImportFile({ ...base, bytes: fullBytes }).records !== 4096
  )
    throw Error('FILE_BOUNDARY_ASSERTION');
  results.push({ name: 'file-exact-16mib', accepted: true });
  return results;
}
