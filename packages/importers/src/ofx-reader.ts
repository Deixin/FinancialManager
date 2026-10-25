import { sourceBody } from './file-validation-ofx.js';
import { OfxParseError, ofxDate } from './ofx-contract.js';

const children: Readonly<Record<string, readonly string[]>> = {
  OFX: ['SIGNONMSGSRSV1', 'BANKMSGSRSV1', 'CREDITCARDMSGSRSV1'],
  SIGNONMSGSRSV1: ['SONRS'],
  SONRS: ['STATUS', 'DTSERVER', 'LANGUAGE', 'FI'],
  STATUS: ['CODE', 'SEVERITY', 'MESSAGE'],
  FI: ['ORG', 'FID'],
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
const fail = (): never => {
  throw new OfxParseError('INVALID_OFX_STRUCTURE');
};
function entities(text: string) {
  const fixed: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    apos: "'",
    quot: '"',
  };
  return text.replace(
    /&([^;]+);/g,
    (_, name: string) =>
      fixed[name] ??
      String.fromCodePoint(
        name[1] === 'x'
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1)),
      ),
  );
}
interface Frame {
  name: string;
  text: string;
  seen: Set<string>;
  values: Record<string, string>;
}
export interface OfxStatement {
  readonly liability: boolean;
  readonly currency: string;
  readonly account: Readonly<Record<string, string>>;
  readonly period_start: string;
  readonly period_end: string;
  readonly layout: 'OFX_102_SGML' | 'OFX_2_XML';
}
// Semantic streaming pass after the defensive gate. The stack is bounded by
// US-051; only one transaction's raw fields live here at a time.
export function readOfx(
  text: string,
  encoding: string,
  checkpoint: () => void,
  consume: (fields: Readonly<Record<string, string>>, locator: string) => void,
): OfxStatement {
  const { start, sgml } = sourceBody(text, encoding);
  const stack: Frame[] = [];
  let offset = start,
    statements = 0,
    accounts = 0,
    lists = 0,
    rows = 0,
    currency = '',
    liability = false;
  let account: Record<string, string> = Object.create(null),
    period: Record<string, string> = Object.create(null);
  const close = () => {
    const node = stack.pop() ?? fail();
    const parent = stack.at(-1);
    if (!children[node.name]) {
      (parent ?? fail()).values[node.name] = entities(node.text).trim();
    }
    if (
      node.name === 'STATUS' &&
      (node.values.CODE !== '0' ||
        !['INFO', 'WARN'].includes(node.values.SEVERITY ?? ''))
    )
      throw new OfxParseError('OFX_SOURCE_ERROR');
    if (
      ['STMTTRNRS', 'CCSTMTTRNRS', 'SONRS'].includes(node.name) &&
      !node.seen.has('STATUS')
    )
      throw new OfxParseError('OFX_SOURCE_ERROR');
    if (['STMTRS', 'CCSTMTRS'].includes(node.name))
      currency = node.values.CURDEF ?? '';
    if (['BANKACCTFROM', 'CCACCTFROM'].includes(node.name))
      account = node.values;
    if (node.name === 'BANKTRANLIST') period = node.values;
    if (node.name === 'STMTTRN')
      consume(
        node.values,
        '/' + [...stack.map((n) => n.name), `STMTTRN[${++rows}]`].join('/'),
      );
  };
  while (offset < text.length) {
    checkpoint();
    if (text[offset] !== '<') {
      const next = text.indexOf('<', offset),
        end = next < 0 ? text.length : next;
      const part = text.slice(offset, end),
        current = stack.at(-1);
      if (current && !children[current.name]) current.text += part;
      else if (part.trim()) fail();
      offset = end;
      continue;
    }
    const end = text.indexOf('>', offset + 1);
    const tag =
      /^<(\/?)([A-Z][A-Z0-9]{0,31})>$/.exec(text.slice(offset, end + 1)) ??
      fail();
    const closing = tag[1] === '/',
      name = tag[2]!;
    const current = stack.at(-1);
    if (
      sgml &&
      current &&
      !children[current.name] &&
      !(closing && name === current.name)
    )
      close();
    if (closing) {
      if (stack.at(-1)?.name !== name) fail();
      close();
    } else {
      const parent = stack.at(-1);
      if (parent) {
        if (!children[parent.name]?.includes(name)) fail();
        if (
          parent.seen.has(name) &&
          !(parent.name === 'BANKTRANLIST' && name === 'STMTTRN')
        )
          fail();
        parent.seen.add(name);
      } else if (name !== 'OFX') fail();
      if (['STMTRS', 'CCSTMTRS'].includes(name)) {
        if (++statements !== 1) fail();
        liability = name === 'CCSTMTRS';
      }
      if (['BANKACCTFROM', 'CCACCTFROM'].includes(name) && ++accounts !== 1)
        fail();
      if (name === 'BANKTRANLIST' && ++lists !== 1) fail();
      stack.push({
        name,
        text: '',
        seen: new Set(),
        values: Object.create(null),
      });
    }
    offset = end + 1;
  }
  if (stack.length || statements !== 1 || lists !== 1 || accounts !== 1) fail();
  if (
    !account.ACCTID ||
    account.ACCTID.length > 256 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(account.ACCTID) ||
    (!liability &&
      (!account.BANKID ||
        !['CHECKING', 'SAVINGS', 'MONEYMRKT'].includes(account.ACCTTYPE ?? '')))
  )
    throw new OfxParseError('INVALID_SOURCE_ACCOUNT');
  const from = ofxDate(period.DTSTART),
    to = ofxDate(period.DTEND);
  if (!from || !to || from > to) throw new OfxParseError('INVALID_PERIOD');
  if (!rows) throw new OfxParseError('EMPTY_STATEMENT');
  return {
    liability,
    currency,
    account,
    period_start: from,
    period_end: to,
    layout: sgml ? 'OFX_102_SGML' : 'OFX_2_XML',
  };
}
