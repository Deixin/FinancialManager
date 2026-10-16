// SYNTHETIC ONLY. No bank/customer documents are used or checked in.
export const context = Object.freeze({
  workspace_id: '00000000-0000-4000-8000-000000000001',
  account_id: '00000000-0000-4000-8000-000000000002',
  currency: 'BRL',
  balance_nature: 'ASSET',
});
export const mapping = Object.freeze({
  delimiter: ';',
  dateFormat: 'DD/MM/YYYY',
  decimal: ',',
  grouping: '.',
  amountMode: 'SIGNED_CASH_FLOW',
  columns: {
    date: 'Data',
    description: 'Descrição',
    amount: 'Valor',
    externalId: 'ID',
  },
});
export const amounts = [
  '90071992547409.93',
  '-92233720368547758.08',
  '92233720368547758.07',
  '-1234.56',
  '0.01',
];
export function expectedRows(count = 10000, liability = false) {
  return Array.from({ length: count }, (_, i) => ({
    date: '2026-10-' + String((i % 28) + 1).padStart(2, '0'),
    description:
      `SYNTHETIC ação; "linha" ${i + 1}` +
      (i % 997 === 0 ? '\ncontinuação' : ''),
    externalId: 'SYNTHETIC-ID-' + String(i + 1).padStart(6, '0'),
    amount: amounts[i % amounts.length],
    minor: (
      BigInt(amounts[i % amounts.length].replace('.', '')) *
      (liability ? -1n : 1n)
    ).toString(),
  }));
}
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
export function csvFixture(count = 10000) {
  return (
    '\ufeffData;Descrição;Valor;ID\r\n' +
    expectedRows(count)
      .map((row) =>
        [
          row.date.slice(8) +
            '/' +
            row.date.slice(5, 7) +
            '/' +
            row.date.slice(0, 4),
          quote(row.description),
          row.amount.replace('.', ','),
          row.externalId,
        ].join(';'),
      )
      .join('\r\n') +
    '\r\n'
  );
}
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
export function ofxFixture(
  count = 10000,
  { xml = false, card = false, encoding = 'utf-8' } = {},
) {
  const scalar = (name, value) =>
    `<${name}>${escape(value)}` + (xml ? `</${name}>` : '') + '\n';
  const header = xml
    ? '<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="203" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n'
    : 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:' +
      (encoding === 'utf-8'
        ? 'UNICODE\nCHARSET:UTF-8'
        : 'USASCII\nCHARSET:1252') +
      '\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n';
  const group = card ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1',
    response = card ? 'CCSTMTTRNRS' : 'STMTTRNRS',
    statement = card ? 'CCSTMTRS' : 'STMTRS',
    account = card ? 'CCACCTFROM' : 'BANKACCTFROM';
  return (
    header +
    `<OFX><${group}><${response}>` +
    scalar('TRNUID', 'SYNTHETIC') +
    '<STATUS>' +
    scalar('CODE', '0') +
    scalar('SEVERITY', 'INFO') +
    `</STATUS><${statement}>` +
    scalar('CURDEF', 'BRL') +
    `<${account}>` +
    (card ? '' : scalar('BANKID', '000')) +
    scalar('ACCTID', 'SYNTHETIC-ACCOUNT') +
    (card ? '' : scalar('ACCTTYPE', 'CHECKING')) +
    `</${account}><BANKTRANLIST>` +
    scalar('DTSTART', '20261001000000[-3:BRT]') +
    scalar('DTEND', '20261031235959[-3:BRT]') +
    expectedRows(count)
      .map(
        (row) =>
          '<STMTTRN>' +
          scalar('TRNTYPE', row.amount.startsWith('-') ? 'DEBIT' : 'CREDIT') +
          scalar('DTPOSTED', row.date.replaceAll('-', '') + '001500[-3:BRT]') +
          scalar('TRNAMT', row.amount) +
          scalar('FITID', row.externalId) +
          scalar('MEMO', row.description) +
          '</STMTTRN>',
      )
      .join('\n') +
    '</BANKTRANLIST><LEDGERBAL>' +
    scalar('BALAMT', '999.99') +
    scalar('DTASOF', '20261031') +
    `</LEDGERBAL></${statement}></${response}></${group}></OFX>`
  );
}
