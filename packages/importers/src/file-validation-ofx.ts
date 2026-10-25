import {
  importFileLimits as limits,
  rejectFile,
} from './file-validation-policy.js';

const aggregates = new Set([
  'OFX',
  'SIGNONMSGSRSV1',
  'SONRS',
  'STATUS',
  'FI',
  'BANKMSGSRSV1',
  'STMTTRNRS',
  'STMTRS',
  'BANKACCTFROM',
  'BANKTRANLIST',
  'STMTTRN',
  'LEDGERBAL',
  'AVAILBAL',
  'CREDITCARDMSGSRSV1',
  'CCSTMTTRNRS',
  'CCSTMTRS',
  'CCACCTFROM',
]);
const scalars = new Set([
  'CODE',
  'SEVERITY',
  'MESSAGE',
  'DTSERVER',
  'LANGUAGE',
  'ORG',
  'FID',
  'TRNUID',
  'CURDEF',
  'BANKID',
  'BRANCHID',
  'ACCTID',
  'ACCTTYPE',
  'ACCTKEY',
  'DTSTART',
  'DTEND',
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
  'BALAMT',
  'DTASOF',
]);

export function sourceBody(text: string, encoding: string) {
  const start = text.indexOf('<OFX>');
  if (start < 0 || start > limits.record_chars) rejectFile('INVALID_OFX');
  const prefix = text.slice(0, start).trim();
  if (prefix.startsWith('OFXHEADER:')) {
    const header: Record<string, string> = Object.create(null);
    const lines = prefix.split(/\r\n|\n/);
    if (lines.length > 16) rejectFile('UNSUPPORTED_LAYOUT');
    for (const line of lines) {
      const match = /^([A-Z]{1,16}):([A-Z0-9.-]{1,40})$/.exec(line);
      if (!match || Object.hasOwn(header, match[1]!)) rejectFile('INVALID_OFX');
      header[match[1]!] = match[2]!;
    }
    if (
      Object.keys(header).sort().join(',') !==
        'CHARSET,COMPRESSION,DATA,ENCODING,NEWFILEUID,OFXHEADER,OLDFILEUID,SECURITY,VERSION' ||
      header.OFXHEADER !== '100' ||
      header.DATA !== 'OFXSGML' ||
      header.VERSION !== '102' ||
      header.SECURITY !== 'NONE' ||
      header.COMPRESSION !== 'NONE' ||
      header.OLDFILEUID !== 'NONE' ||
      header.NEWFILEUID !== 'NONE'
    )
      rejectFile('UNSUPPORTED_LAYOUT');
    if (
      !(
        encoding === 'utf-8' &&
        header.ENCODING === 'UNICODE' &&
        header.CHARSET === 'UTF-8'
      ) &&
      !(
        encoding === 'windows-1252' &&
        header.ENCODING === 'USASCII' &&
        header.CHARSET === '1252'
      )
    )
      rejectFile('ENCODING_MISMATCH');
    return { start, sgml: true };
  }
  if (encoding !== 'utf-8') rejectFile('ENCODING_MISMATCH');
  if (
    !/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>\s*<\?OFX\s+OFXHEADER="200"\s+VERSION="(?:203|220|230)"\s+SECURITY="NONE"\s+OLDFILEUID="NONE"\s+NEWFILEUID="NONE"\s*\?>$/.test(
      prefix,
    )
  )
    rejectFile('UNSUPPORTED_LAYOUT');
  return { start, sgml: false };
}

function checkEntities(text: string) {
  // No substitution occurs here. Accept only fixed XML references to valid
  // characters; declarations and recursive/custom entity expansion never run.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '&') continue;
    const end = text.indexOf(';', i + 1);
    if (end < 0 || end - i > 12) rejectFile('ACTIVE_CONTENT');
    const name = text.slice(i + 1, end);
    if (!['amp', 'lt', 'gt', 'apos', 'quot'].includes(name)) {
      if (!/^(?:#[0-9]{1,7}|#x[0-9a-fA-F]{1,6})$/.test(name))
        rejectFile('ACTIVE_CONTENT');
      const n =
        name[1] === 'x'
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      if (!(
        n === 9 ||
        n === 10 ||
        n === 13 ||
        (n >= 32 && n <= 0xd7ff) ||
        (n >= 0xe000 && n <= 0xfffd) ||
        (n >= 0x10000 && n <= 0x10ffff)
      ))
        rejectFile('INVALID_OFX');
    }
    i = end;
  }
}

export function inspectOfx(
  text: string,
  encoding: string,
  checkpoint: () => void,
) {
  if (text.includes('<!')) rejectFile('ACTIVE_CONTENT');
  const { start, sgml } = sourceBody(text, encoding);
  const stack: { name: string; characters: number }[] = [];
  let offset = start,
    nodes = 0,
    depth = 0,
    roots = 0,
    records = 0;
  let recordStart: number | null = null;
  while (offset < text.length) {
    checkpoint();
    if (recordStart !== null && offset - recordStart > limits.record_chars)
      rejectFile('RECORD_LIMIT');
    if (text[offset] !== '<') {
      let end = text.indexOf('<', offset);
      if (end < 0) end = text.length;
      const content = text.slice(offset, end);
      const current = stack.at(-1);
      if (!current || aggregates.has(current.name)) {
        if (content.trim()) rejectFile('INVALID_OFX');
      } else {
        current.characters += content.length;
        if (current.characters > limits.field_chars) rejectFile('FIELD_LIMIT');
        if (content.includes(']]>')) rejectFile('INVALID_OFX');
        checkEntities(content);
      }
      offset = end;
      continue;
    }
    const end = text.indexOf('>', offset + 1);
    if (end < 0 || end - offset > 64) rejectFile('INVALID_OFX');
    const tag = /^<(\/?)([A-Z][A-Z0-9]{0,31})>$/.exec(
      text.slice(offset, end + 1),
    );
    if (!tag) rejectFile('ACTIVE_CONTENT');
    const closing = tag[1] === '/',
      name = tag[2]!;
    const current = stack.at(-1);
    if (
      sgml &&
      current &&
      scalars.has(current.name) &&
      !(closing && name === current.name)
    )
      stack.pop();
    if (closing) {
      if (stack.at(-1)?.name !== name) rejectFile('INVALID_OFX');
      stack.pop();
      if (name === 'STMTTRN') {
        if (recordStart === null || end + 1 - recordStart > limits.record_chars)
          rejectFile('RECORD_LIMIT');
        recordStart = null;
      }
    } else {
      if (++nodes > limits.nodes) rejectFile('NODE_LIMIT');
      if (!stack.length && (name !== 'OFX' || ++roots !== 1))
        rejectFile('INVALID_OFX');
      if (sgml && !aggregates.has(name) && !scalars.has(name))
        rejectFile('UNSUPPORTED_LAYOUT');
      if (stack.length >= limits.depth) rejectFile('DEPTH_LIMIT');
      if (name === 'STMTTRN') {
        if (recordStart !== null) rejectFile('INVALID_OFX');
        if (++records > limits.records) rejectFile('ROW_LIMIT');
        recordStart = offset;
      }
      stack.push({ name, characters: 0 });
      depth = Math.max(depth, stack.length);
    }
    offset = end + 1;
  }
  if (stack.length || roots !== 1) rejectFile('INVALID_OFX');
  return { records, columns: null, depth };
}
