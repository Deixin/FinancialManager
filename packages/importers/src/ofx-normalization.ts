import { ofxDate, ofxMinor, ofxTransactionTypes } from './ofx-contract.js';
import type {
  OfxDestination,
  OfxItem,
  OfxRowError,
  OfxWarning,
  OfxTransactionType,
} from './ofx-contract.js';

const types = new Set<string>(ofxTransactionTypes);
export function normalizeOfxRow(
  fields: Readonly<Record<string, string>>,
  destination: OfxDestination,
  row: number,
  locator: string,
): OfxItem {
  const errors: OfxRowError[] = [],
    warnings: OfxWarning[] = [];
  const error = (field: OfxRowError['field'], code: OfxRowError['code']) =>
    errors.push({ field, code });
  const date = ofxDate(fields.DTPOSTED),
    money = ofxMinor(fields.TRNAMT, destination.balance_nature === 'LIABILITY');
  if (!date) error('date', 'INVALID_DATE');
  if (money.error) error('amount', money.error);
  if (!types.has(fields.TRNTYPE ?? ''))
    error('type', 'UNSUPPORTED_TRANSACTION_TYPE');
  if (
    money.value !== null &&
    ((fields.TRNTYPE === 'CREDIT' && fields.TRNAMT!.startsWith('-')) ||
      (fields.TRNTYPE === 'DEBIT' &&
        !fields.TRNAMT!.startsWith('-') &&
        money.value !== '0'))
  )
    error('type', 'SIGN_TYPE_MISMATCH');
  if (fields.CORRECTFITID !== undefined || fields.CORRECTACTION !== undefined)
    error('correction', 'CORRECTION_REQUIRES_REVIEW');
  if (['XFER', 'PAYMENT'].includes(fields.TRNTYPE ?? ''))
    warnings.push('MOVEMENT_REQUIRES_REVIEW');
  const descriptionTag = fields.MEMO ? 'MEMO' : fields.NAME ? 'NAME' : null;
  let description = descriptionTag ? fields[descriptionTag]! : null;
  if (
    !description ||
    description.length > 1024 ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(description)
  ) {
    error('description', 'INVALID_DESCRIPTION');
    description = null;
  }
  let name = description?.normalize('NFC').replace(/\s+/gu, ' ') ?? null;
  if (name && name.length > 512) {
    error('description', 'INVALID_DESCRIPTION');
    name = null;
  }
  let id = fields.FITID || null;
  if (!id) warnings.push('MISSING_SOURCE_ID');
  else if (id.length > 256 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(id)) {
    error('external_id', 'INVALID_SOURCE_ID');
    id = null;
  }
  const path = (tag: string) =>
    fields[tag] === undefined ? null : `${locator}/${tag}`;
  return {
    row_no: row,
    source_external_id: id,
    source_transaction_type: types.has(fields.TRNTYPE ?? '')
      ? (fields.TRNTYPE as OfxTransactionType)
      : null,
    normalized_date: date,
    normalized_amount_minor: money.value,
    original_description: description,
    proposed_name: name,
    disposition: errors.length ? 'INVALID' : 'NEW',
    validation_errors: errors,
    warnings,
    provenance: {
      file_hash: '',
      parser_name: '',
      parser_version: '',
      source_locator: locator,
      fields: {
        date: path('DTPOSTED'),
        amount: path('TRNAMT'),
        description: descriptionTag ? path(descriptionTag) : null,
        external_id: path('FITID'),
        type: path('TRNTYPE'),
      },
    },
  };
}
