export const ofxParser = Object.freeze({ name: 'fm-ofx', version: '1.0.0' });
export const ofxTransactionTypes = Object.freeze([
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
] as const);
export type OfxTransactionType = (typeof ofxTransactionTypes)[number];
export type OfxErrorCode =
  | 'INVALID_DESTINATION'
  | 'INVALID_OFX_STRUCTURE'
  | 'OFX_SOURCE_ERROR'
  | 'INVALID_SOURCE_ACCOUNT'
  | 'ACCOUNT_KIND_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_PERIOD'
  | 'EMPTY_STATEMENT'
  | 'HASH_UNAVAILABLE';
export class OfxParseError extends Error {
  constructor(readonly code: OfxErrorCode) {
    super(code);
    this.name = 'OfxParseError';
  }
}
export interface OfxDestination {
  readonly workspace_id: string;
  readonly account_id: string;
  readonly balance_nature: 'ASSET' | 'LIABILITY';
  readonly currency: 'BRL';
}
export type OfxRowErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'ZERO_AMOUNT'
  | 'INVALID_DESCRIPTION'
  | 'INVALID_SOURCE_ID'
  | 'UNSUPPORTED_TRANSACTION_TYPE'
  | 'SIGN_TYPE_MISMATCH'
  | 'CORRECTION_REQUIRES_REVIEW';
export interface OfxRowError {
  readonly field:
    'date' | 'amount' | 'description' | 'external_id' | 'type' | 'correction';
  readonly code: OfxRowErrorCode;
}
export type OfxWarning =
  | 'MISSING_SOURCE_ID'
  | 'REPEATED_SOURCE_ID'
  | 'MOVEMENT_REQUIRES_REVIEW'
  | 'DATE_OUTSIDE_SOURCE_PERIOD';
export interface OfxProvenance {
  readonly file_hash: string;
  readonly parser_name: string;
  readonly parser_version: string;
  readonly source_locator: string;
  readonly fields: Readonly<
    Record<
      'date' | 'amount' | 'description' | 'external_id' | 'type',
      string | null
    >
  >;
}
export interface OfxItem {
  readonly row_no: number;
  readonly source_external_id: string | null;
  /** Source hint for review; it does not determine economic kind. */
  readonly source_transaction_type: OfxTransactionType | null;
  readonly normalized_date: string | null;
  readonly normalized_amount_minor: string | null;
  readonly original_description: string | null;
  readonly proposed_name: string | null;
  readonly disposition: 'NEW' | 'INVALID';
  readonly validation_errors: readonly OfxRowError[];
  readonly warnings: readonly OfxWarning[];
  readonly provenance: OfxProvenance;
}
export interface OfxResult {
  readonly model_version: '1';
  readonly destination: Readonly<OfxDestination>;
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
  readonly items: readonly OfxItem[];
}
export function ofxDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m =
    /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.\d{1,3})?(?:\[([+-]?\d{1,2}(?:\.\d{1,2})?)(?::[A-Za-z]{1,8})?\])?)?$/.exec(
      raw,
    );
  if (
    !m ||
    (m[4] !== undefined &&
      (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 60)) ||
    (m[7] !== undefined && Math.abs(Number(m[7])) > 12)
  )
    return null;
  const value = `${m[1]}-${m[2]}-${m[3]}`;
  return value >= '0001-01-01' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function ofxMinor(
  raw: string | undefined,
  liability: boolean,
): { value: string | null; error: OfxRowErrorCode | null } {
  if (!raw || raw.length > 64 || !/^[+-]?\d{1,20}(?:\.\d{1,2})?$/.test(raw))
    return { value: null, error: 'INVALID_AMOUNT' };
  const sign = raw.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = raw.replace(/^[+-]/, '').split('.');
  const amount =
    (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) *
    sign *
    (liability ? -1n : 1n);
  if (amount < -9223372036854775808n || amount > 9223372036854775807n)
    return { value: null, error: 'AMOUNT_OUT_OF_RANGE' };
  return {
    value: amount.toString(),
    error: amount === 0n ? 'ZERO_AMOUNT' : null,
  };
}
