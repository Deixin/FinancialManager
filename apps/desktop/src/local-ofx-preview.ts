import { resourceId } from '@financial-manager/contracts';
import { financialDate, moneyMinor } from '@financial-manager/domain';
export interface OfxPreviewRow {
  readonly row_no: number;
  readonly source_external_id: string | null;
  readonly source_transaction_type: string | null;
  readonly normalized_date: string | null;
  readonly normalized_amount_minor: string | null;
  readonly original_description: string | null;
  readonly proposed_name: string | null;
  readonly disposition: 'NEW' | 'INVALID';
  readonly validation_errors: readonly Readonly<{
    field: string;
    code: string;
  }>[];
  readonly warnings: readonly string[];
  readonly provenance: Readonly<{
    file_hash: string;
    parser_name: string;
    parser_version: string;
    source_locator: string;
    fields: Readonly<Record<string, string | null>>;
  }>;
}
export interface OfxPreview {
  readonly model_version: '1';
  readonly destination: Readonly<{
    workspace_id: string;
    account_id: string;
    balance_nature: 'ASSET' | 'LIABILITY';
    currency: 'BRL';
  }>;
  readonly source: Readonly<{
    file_name: string;
    file_hash: string;
    format: 'OFX';
    parser_name: string;
    parser_version: string;
    layout: 'OFX_102_SGML' | 'OFX_2_XML';
    detected_currency: 'BRL';
    period_start: string;
    period_end: string;
    source_account_hash: string;
  }>;
  readonly items: readonly OfxPreviewRow[];
}
const types = [
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
];
const codes: Readonly<Record<string, string>> = {
  INVALID_DATE: 'date',
  INVALID_AMOUNT: 'amount',
  AMOUNT_OUT_OF_RANGE: 'amount',
  ZERO_AMOUNT: 'amount',
  INVALID_DESCRIPTION: 'description',
  INVALID_SOURCE_ID: 'external_id',
  UNSUPPORTED_TRANSACTION_TYPE: 'type',
  SIGN_TYPE_MISMATCH: 'type',
  CORRECTION_REQUIRES_REVIEW: 'correction',
};
const warningCodes = [
  'MISSING_SOURCE_ID',
  'REPEATED_SOURCE_ID',
  'MOVEMENT_REQUIRES_REVIEW',
  'DATE_OUTSIDE_SOURCE_PERIOD',
];
function bad(): never {
  throw Error('INVALID_OFX_RESPONSE');
}
function exact(
  v: unknown,
  keys: readonly string[],
): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== [...keys].sort().join(',')
  )
    bad();
}
function text(v: unknown, max: number): string {
  if (
    typeof v !== 'string' ||
    !v ||
    v.length > max ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(v)
  )
    bad();
  return v;
}
function nullable(v: unknown, max: number) {
  return v === null ? null : text(v, max);
}
export function decodeOfxPreview(
  raw: unknown,
  expected: {
    workspace_id: string;
    account_id: string;
    file_name: string;
    file_hash: string;
    records: number;
  },
): OfxPreview {
  if (JSON.stringify(raw).length > 64 * 1024 * 1024) bad();
  exact(raw, ['model_version', 'destination', 'source', 'items']);
  exact(raw.destination, [
    'workspace_id',
    'account_id',
    'balance_nature',
    'currency',
  ]);
  const d = raw.destination;
  if (
    raw.model_version !== '1' ||
    resourceId(d.workspace_id) !== expected.workspace_id ||
    resourceId(d.account_id) !== expected.account_id ||
    !['ASSET', 'LIABILITY'].includes(d.balance_nature as string) ||
    d.currency !== 'BRL'
  )
    bad();
  exact(raw.source, [
    'file_name',
    'file_hash',
    'format',
    'parser_name',
    'parser_version',
    'layout',
    'detected_currency',
    'period_start',
    'period_end',
    'source_account_hash',
  ]);
  const s = raw.source;
  if (
    s.file_name !== expected.file_name ||
    s.file_hash !== expected.file_hash ||
    s.format !== 'OFX' ||
    s.parser_name !== 'fm-ofx' ||
    s.parser_version !== '1.0.0' ||
    !['OFX_102_SGML', 'OFX_2_XML'].includes(s.layout as string) ||
    s.detected_currency !== 'BRL' ||
    typeof s.source_account_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(s.source_account_hash)
  )
    bad();
  const from = financialDate(s.period_start),
    to = financialDate(s.period_end);
  if (
    from > to ||
    !Array.isArray(raw.items) ||
    raw.items.length !== expected.records ||
    raw.items.length < 1 ||
    raw.items.length > 10000
  )
    bad();
  const prefix =
    d.balance_nature === 'LIABILITY'
      ? '/OFX/CREDITCARDMSGSRSV1/CCSTMTTRNRS/CCSTMTRS/BANKTRANLIST/'
      : '/OFX/BANKMSGSRSV1/STMTTRNRS/STMTRS/BANKTRANLIST/';
  const items = raw.items.map((r: unknown, index: number) => {
    exact(r, [
      'row_no',
      'source_external_id',
      'source_transaction_type',
      'normalized_date',
      'normalized_amount_minor',
      'original_description',
      'proposed_name',
      'disposition',
      'validation_errors',
      'warnings',
      'provenance',
    ]);
    if (
      r.row_no !== index + 1 ||
      !['NEW', 'INVALID'].includes(r.disposition as string) ||
      !Array.isArray(r.validation_errors) ||
      r.validation_errors.length > 12 ||
      !Array.isArray(r.warnings) ||
      r.warnings.length > 4
    )
      bad();
    const errors = r.validation_errors.map((e: unknown) => {
      exact(e, ['field', 'code']);
      if (
        typeof e.code !== 'string' ||
        !Object.hasOwn(codes, e.code) ||
        codes[e.code] !== e.field
      )
        bad();
      return Object.freeze({ field: e.field as string, code: e.code });
    });
    const has = (code: string) => errors.some((e) => e.code === code),
      field = (name: string) => errors.some((e) => e.field === name);
    const warnings = r.warnings.map((w: unknown) => {
      if (typeof w !== 'string' || !warningCodes.includes(w)) bad();
      return w;
    });
    if (
      new Set(warnings).size !== warnings.length ||
      (r.disposition === 'NEW') !== (errors.length === 0)
    )
      bad();
    const date =
        r.normalized_date === null ? null : financialDate(r.normalized_date),
      amount =
        r.normalized_amount_minor === null
          ? null
          : moneyMinor(r.normalized_amount_minor);
    const id = nullable(r.source_external_id, 256),
      description = nullable(r.original_description, 1024),
      name = nullable(r.proposed_name, 512),
      kind = r.source_transaction_type;
    if (
      (date === null && !field('date')) ||
      (amount === null && !field('amount')) ||
      (amount === '0' && !has('ZERO_AMOUNT')) ||
      (description === null && !field('description')) ||
      (name === null && !field('description')) ||
      (id === null &&
        !has('INVALID_SOURCE_ID') &&
        !warnings.includes('MISSING_SOURCE_ID')) ||
      (kind === null
        ? !has('UNSUPPORTED_TRANSACTION_TYPE')
        : typeof kind !== 'string' || !types.includes(kind))
    )
      bad();
    if (
      warnings.includes('MISSING_SOURCE_ID') !==
        (id === null && !has('INVALID_SOURCE_ID')) ||
      warnings.includes('MOVEMENT_REQUIRES_REVIEW') !==
        (kind === 'XFER' || kind === 'PAYMENT') ||
      warnings.includes('DATE_OUTSIDE_SOURCE_PERIOD') !==
        !!(date && (date < from || date > to))
    )
      bad();
    exact(r.provenance, [
      'file_hash',
      'parser_name',
      'parser_version',
      'source_locator',
      'fields',
    ]);
    const p = r.provenance,
      locator = prefix + `STMTTRN[${index + 1}]`;
    if (
      p.file_hash !== s.file_hash ||
      p.parser_name !== s.parser_name ||
      p.parser_version !== s.parser_version ||
      p.source_locator !== locator
    )
      bad();
    exact(p.fields, ['date', 'amount', 'description', 'external_id', 'type']);
    const paths = p.fields;
    for (const [key, tag] of Object.entries({
      date: 'DTPOSTED',
      amount: 'TRNAMT',
      external_id: 'FITID',
      type: 'TRNTYPE',
    }))
      if (p.fields[key] !== null && p.fields[key] !== `${locator}/${tag}`)
        bad();
    if (
      p.fields.description !== null &&
      !['MEMO', 'NAME'].some((tag) => paths.description === `${locator}/${tag}`)
    )
      bad();
    if (
      (date !== null && p.fields.date === null) ||
      (amount !== null && p.fields.amount === null) ||
      (id !== null && p.fields.external_id === null) ||
      (kind !== null && p.fields.type === null) ||
      (description !== null && p.fields.description === null)
    )
      bad();
    return Object.freeze({
      row_no: index + 1,
      source_external_id: id,
      source_transaction_type: kind as string | null,
      normalized_date: date,
      normalized_amount_minor: amount,
      original_description: description,
      proposed_name: name,
      disposition: r.disposition as 'NEW' | 'INVALID',
      validation_errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      provenance: Object.freeze({
        file_hash: s.file_hash as string,
        parser_name: 'fm-ofx',
        parser_version: '1.0.0',
        source_locator: locator,
        fields: Object.freeze({ ...paths }) as Readonly<
          Record<string, string | null>
        >,
      }),
    });
  });
  const counts = new Map<string, number>();
  for (const row of items)
    if (row.source_external_id)
      counts.set(
        row.source_external_id,
        (counts.get(row.source_external_id) ?? 0) + 1,
      );
  for (const row of items)
    if (
      row.warnings.includes('REPEATED_SOURCE_ID') !==
      !!(
        row.source_external_id && (counts.get(row.source_external_id) ?? 0) > 1
      )
    )
      bad();
  return Object.freeze({
    model_version: '1',
    destination: Object.freeze({
      ...d,
    }) as unknown as OfxPreview['destination'],
    source: Object.freeze({
      ...s,
      period_start: from,
      period_end: to,
    }) as unknown as OfxPreview['source'],
    items: Object.freeze(items),
  });
}
