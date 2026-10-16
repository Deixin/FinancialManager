import sax from 'sax';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import {
  financialDate,
  ImportError,
  limits,
  normalizeRow,
} from './contract.mjs';

const children = {
  OFX: ['SIGNONMSGSRSV1', 'BANKMSGSRSV1', 'CREDITCARDMSGSRSV1'],
  SIGNONMSGSRSV1: ['SONRS'],
  SONRS: ['STATUS', 'DTSERVER', 'LANGUAGE', 'FI'],
  FI: ['ORG', 'FID'],
  STATUS: ['CODE', 'SEVERITY', 'MESSAGE'],
  BANKMSGSRSV1: ['STMTTRNRS'],
  STMTTRNRS: ['TRNUID', 'STATUS', 'STMTRS'],
  CREDITCARDMSGSRSV1: ['CCSTMTTRNRS'],
  CCSTMTTRNRS: ['TRNUID', 'STATUS', 'CCSTMTRS'],
  STMTRS: ['CURDEF', 'BANKACCTFROM', 'BANKTRANLIST', 'LEDGERBAL', 'AVAILBAL'],
  CCSTMTRS: ['CURDEF', 'CCACCTFROM', 'BANKTRANLIST', 'LEDGERBAL', 'AVAILBAL'],
  BANKACCTFROM: ['BANKID', 'BRANCHID', 'ACCTID', 'ACCTTYPE', 'ACCTKEY'],
  CCACCTFROM: ['ACCTID', 'ACCTKEY'],
  BANKTRANLIST: ['DTSTART', 'DTEND', 'STMTTRN'],
  STMTTRN: [
    'TRNTYPE',
    'DTPOSTED',
    'DTUSER',
    'DTAVAIL',
    'TRNAMT',
    'FITID',
    'NAME',
    'MEMO',
    'CHECKNUM',
    'REFNUM',
    'CORRECTFITID',
    'CORRECTACTION',
  ],
  LEDGERBAL: ['BALAMT', 'DTASOF'],
  AVAILBAL: ['BALAMT', 'DTASOF'],
};
const transactionTypes = new Set([
  'CREDIT',
  'DEBIT',
  'INT',
  'DIV',
  'FEE',
  'SRVCHG',
  'DEP',
  'ATM',
  'POS',
  'XFER',
  'CHECK',
  'PAYMENT',
  'CASH',
  'DIRECTDEP',
  'DIRECTDEBIT',
  'REPEATPMT',
  'OTHER',
]);

function sourceBody(text, encoding) {
  const root = text.indexOf('<OFX>');
  if (root < 0 || root > 4096) throw new ImportError('UNSUPPORTED_LAYOUT');
  const prefix = text.slice(0, root).trim();
  if (prefix.startsWith('OFXHEADER:')) {
    const header = Object.create(null);
    for (const line of prefix.split(/\r?\n/)) {
      const parts = /^([A-Z]+):([^\r\n:]+)$/.exec(line);
      if (!parts || header[parts[1]] !== undefined)
        throw new ImportError('INVALID_OFX_HEADER');
      header[parts[1]] = parts[2].trim();
    }
    if (
      header.OFXHEADER !== '100' ||
      header.DATA !== 'OFXSGML' ||
      header.VERSION !== '102' ||
      header.SECURITY !== 'NONE' ||
      header.COMPRESSION !== 'NONE'
    )
      throw new ImportError('UNSUPPORTED_LAYOUT');
    if (!(
      (encoding === 'utf-8' &&
        header.ENCODING === 'UNICODE' &&
        header.CHARSET === 'UTF-8') ||
      (encoding === 'windows-1252' &&
        header.ENCODING === 'USASCII' &&
        header.CHARSET === '1252')
    ))
      throw new ImportError('ENCODING_MISMATCH');
    return {
      body: text.slice(root),
      sgml: true,
      layout: 'ofx-102-bank-card-v1',
    };
  }
  if (
    !/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>\s*<\?OFX\s+OFXHEADER="200"\s+VERSION="(?:203|220|230)"\s+SECURITY="NONE"\s+OLDFILEUID="NONE"\s+NEWFILEUID="NONE"\s*\?>$/.test(
      prefix,
    ) ||
    encoding !== 'utf-8'
  )
    throw new ImportError('UNSUPPORTED_LAYOUT');
  return {
    body: text.slice(root),
    sgml: false,
    layout: 'ofx-2xml-bank-card-v1',
  };
}

export async function parseOfx(text, context, encoding, consume, checkpoint) {
  // Refuse declarations before tokenizing. No entity resolver or network port.
  if (/<!/i.test(text)) throw new ImportError('XML_DECLARATION_FORBIDDEN');
  const source = sourceBody(text, encoding);
  const parser = sax.parser(true, {
    strictEntities: true,
    trim: false,
    normalize: false,
    position: true,
  });
  const stack = [];
  let statementCount = 0,
    accountCount = 0,
    listCount = 0,
    count = 0,
    currency = null,
    statementKind = null;
  let account = Object.create(null),
    transaction,
    sourcePeriod = Object.create(null);
  let currentRecordChars = 0;
  parser.onerror = () => {
    throw new ImportError('INVALID_OFX');
  };
  parser.ondoctype = parser.onsgmldeclaration = () => {
    throw new ImportError('XML_DECLARATION_FORBIDDEN');
  };
  parser.onprocessinginstruction = () => {
    throw new ImportError('UNSUPPORTED_LAYOUT');
  };
  parser.onopentag = (tag) => {
    checkpoint();
    const parent = stack.at(-1);
    if (
      Object.keys(tag.attributes).length ||
      (parent ? !children[parent.name]?.includes(tag.name) : tag.name !== 'OFX')
    )
      throw new ImportError('UNSUPPORTED_LAYOUT');
    if (stack.length >= limits.depth) throw new ImportError('DEPTH_LIMIT');
    if (parent) {
      if (parent.seen.has(tag.name) && tag.name !== 'STMTTRN')
        throw new ImportError('DUPLICATE_OFX_FIELD');
      parent.seen.add(tag.name);
    }
    stack.push({ name: tag.name, text: '', seen: new Set() });
    if (['STMTRS', 'CCSTMTRS'].includes(tag.name)) {
      statementCount++;
      statementKind = tag.name;
      if (statementCount !== 1) throw new ImportError('MULTIPLE_STATEMENTS');
    }
    if (['BANKACCTFROM', 'CCACCTFROM'].includes(tag.name)) accountCount++;
    if (tag.name === 'BANKTRANLIST') listCount++;
    if (tag.name === 'STMTTRN') {
      transaction = Object.create(null);
      currentRecordChars = 0;
    }
  };
  parser.ontext = (text) => {
    const node = stack.at(-1);
    if (!node) {
      if (text.trim()) throw new ImportError('INVALID_OFX');
      return;
    }
    if (children[node.name]) {
      if (text.trim()) throw new ImportError('INVALID_OFX');
      return;
    }
    node.text += text;
    currentRecordChars += transaction ? text.length : 0;
    if (
      node.text.length > limits.fieldChars ||
      currentRecordChars > limits.recordChars
    )
      throw new ImportError('RECORD_LIMIT');
  };
  parser.onclosetag = (name) => {
    const node = stack.pop();
    const parent = stack.at(-1)?.name;
    const value = node.text.trim();
    if (parent === 'STMTTRN') transaction[name] = value;
    if (['BANKACCTFROM', 'CCACCTFROM'].includes(parent)) account[name] = value;
    if (parent === 'BANKTRANLIST' && ['DTSTART', 'DTEND'].includes(name))
      sourcePeriod[name] = value;
    if (name === 'CODE' && parent === 'STATUS' && value !== '0')
      throw new ImportError('OFX_SOURCE_ERROR');
    if (name === 'CURDEF') currency = value;
    if (name === 'STMTTRN') {
      count++;
      if (count > limits.rows) throw new ImportError('ROW_LIMIT');
      const row = normalizeRow(
        {
          row: count,
          locator: `ofx:STMTTRN:${count}`,
          date: transaction.DTPOSTED,
          amount: transaction.TRNAMT,
          description: transaction.MEMO || transaction.NAME || '',
          externalId: transaction.FITID,
          type: transaction.TRNTYPE,
          correction: transaction.CORRECTFITID || transaction.CORRECTACTION,
        },
        {
          ...context,
          format: 'OFX',
          dateFormat: 'OFX',
          decimal: '.',
          grouping: null,
          amountMode: 'SIGNED_CASH_FLOW',
          requireId: true,
        },
      );
      if (!transactionTypes.has(transaction.TRNTYPE)) {
        row.disposition = 'INVALID';
        row.validation_errors.push({
          field: 'type',
          code: 'UNSUPPORTED_TRANSACTION_TYPE',
        });
      }
      consume(row);
      transaction = undefined;
    }
  };
  // OFX 1 allows omitted scalar closing tags. Only known scalar tags get an
  // inserted close; aggregate truncation/misnesting is never repaired.
  let offset = 0;
  let tokenCount = 0;
  while (offset < source.body.length) {
    const tag = source.body[offset] === '<';
    let end = source.body.indexOf(tag ? '>' : '<', offset + (tag ? 1 : 0));
    if (end < 0) {
      if (tag) throw new ImportError('INVALID_OFX');
      end = source.body.length;
    } else if (tag) end++;
    const token = source.body.slice(offset, end);
    offset = end;
    if (token.length > limits.recordChars)
      throw new ImportError('RECORD_LIMIT');
    if (
      source.sgml &&
      token.startsWith('<') &&
      stack.length &&
      !children[stack.at(-1).name]
    ) {
      const leaf = stack.at(-1).name;
      if (token !== `</${leaf}>`) parser.write(`</${leaf}>`);
    }
    parser.write(token);
    checkpoint();
    if (++tokenCount % 500 === 0) await setImmediate();
  }
  parser.close();
  if (
    statementCount !== 1 ||
    accountCount !== 1 ||
    listCount !== 1 ||
    !account.ACCTID ||
    (statementKind === 'STMTRS' && !account.BANKID)
  )
    throw new ImportError('INVALID_OFX_ACCOUNT');
  if (
    statementKind === 'STMTRS' &&
    !['CHECKING', 'SAVINGS', 'MONEYMRKT'].includes(account.ACCTTYPE)
  )
    throw new ImportError('UNSUPPORTED_ACCOUNT_TYPE');
  if (currency !== context.currency) throw new ImportError('CURRENCY_MISMATCH');
  if (
    (statementKind === 'CCSTMTRS') !==
    (context.balance_nature === 'LIABILITY')
  )
    throw new ImportError('ACCOUNT_KIND_MISMATCH');
  if (count === 0) throw new ImportError('EMPTY_SOURCE');
  const start = financialDate(sourcePeriod.DTSTART, 'OFX'),
    end = financialDate(sourcePeriod.DTEND, 'OFX');
  if (start > end) throw new ImportError('INVALID_PERIOD');
  return {
    layout: source.layout,
    rows: count,
    source_account_hash: createHash('sha256')
      .update(
        JSON.stringify([
          account.BANKID ?? '',
          account.ACCTID,
          account.ACCTTYPE ?? 'CREDIT_CARD',
        ]),
      )
      .digest('hex'),
    source_period_start: start,
    source_period_end: end,
  };
}
