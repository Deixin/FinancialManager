// Experimental import contract. No ledger write port is exposed by the parser.
export const parserVersion = '0.1.0';
export const limits = Object.freeze({
  bytes: 16 * 1024 * 1024,
  rows: 10000,
  recordChars: 8192,
  fieldChars: 2048,
  columns: 64,
  depth: 32,
  timeoutMs: 30000,
});
export class ImportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function checkContext(context) {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    !context ||
    !uuid.test(context.workspace_id ?? '') ||
    !uuid.test(context.account_id ?? '') ||
    !['ASSET', 'LIABILITY'].includes(context.balance_nature) ||
    context.currency !== 'BRL'
  )
    throw new ImportError('INVALID_DESTINATION');
}
export function decimalMinor(value, decimal = '.', grouping = null) {
  return checkedMinor(decimalValue(value, decimal, grouping));
}
function decimalValue(value, decimal = '.', grouping = null) {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !['.', ','].includes(decimal) ||
    (grouping !== null &&
      (!['.', ','].includes(grouping) || grouping === decimal))
  )
    throw new ImportError('INVALID_AMOUNT');
  let text = value.trim();
  const sign = text.startsWith('-') ? -1n : 1n;
  if (/^[+-]/.test(text)) text = text.slice(1);
  const parts = text.split(decimal);
  if (parts.length > 2) throw new ImportError('INVALID_AMOUNT');
  let integer = parts[0];
  if (grouping && integer.includes(grouping)) {
    const groups = integer.split(grouping);
    if (
      !/^[0-9]{1,3}$/.test(groups[0]) ||
      groups.slice(1).some((part) => !/^[0-9]{3}$/.test(part))
    )
      throw new ImportError('INVALID_AMOUNT');
    integer = groups.join('');
  }
  if (
    !/^[0-9]+$/.test(integer) ||
    (parts.length === 2 && !/^[0-9]{1,2}$/.test(parts[1]))
  )
    throw new ImportError('INVALID_AMOUNT');
  const result =
    (BigInt(integer) * 100n + BigInt((parts[1] ?? '').padEnd(2, '0'))) * sign;
  return result;
}
export function checkedMinor(value) {
  if (value < -9223372036854775808n || value > 9223372036854775807n)
    throw new ImportError('AMOUNT_OUT_OF_RANGE');
  return value.toString();
}
export function financialDate(value, format) {
  if (typeof value !== 'string') throw new ImportError('INVALID_DATE');
  const text = value.trim();
  let iso;
  if (format === 'YYYY-MM-DD' && /^\d{4}-\d{2}-\d{2}$/.test(text)) iso = text;
  else if (format === 'DD/MM/YYYY' && /^\d{2}\/\d{2}\/\d{4}$/.test(text))
    iso = text.slice(6) + '-' + text.slice(3, 5) + '-' + text.slice(0, 2);
  else if (format === 'OFX') {
    const match =
      /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.\d{1,3})?(?:\[([+-]?\d{1,2}(?:\.\d{1,2})?)(?::[A-Za-z]{1,8})?\])?)?$/.exec(
        text,
      );
    if (
      !match ||
      (match[4] !== undefined &&
        (Number(match[4]) > 23 ||
          Number(match[5]) > 59 ||
          Number(match[6]) > 59)) ||
      (match[7] !== undefined && Math.abs(Number(match[7])) > 14)
    )
      throw new ImportError('INVALID_DATE');
    iso = `${match[1]}-${match[2]}-${match[3]}`;
  } else throw new ImportError('INVALID_DATE');
  if (
    iso < '0001-01-01' ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    throw new ImportError('INVALID_DATE');
  // Financial DATE preserves the source calendar day, never UTC-shifts it.
  return iso;
}
export function normalizeRow(raw, options) {
  const errors = [];
  const warnings = [];
  const field = (name, action) => {
    try {
      return action();
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      errors.push({ field: name, code: error.code });
      return null;
    }
  };
  const description = raw.description ?? '';
  if (
    description.length > 1024 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)
  )
    errors.push({ field: 'description', code: 'INVALID_DESCRIPTION' });
  if (/^\s*[=+\-@]/.test(description)) warnings.push('FORMULA_LIKE_TEXT');
  const date = field('date', () => financialDate(raw.date, options.dateFormat));
  const amount = field('amount', () => {
    let amount;
    if (options.amountMode === 'DEBIT_CREDIT') {
      const debit = raw.debit?.trim()
        ? decimalValue(raw.debit, options.decimal, options.grouping)
        : 0n;
      const credit = raw.credit?.trim()
        ? decimalValue(raw.credit, options.decimal, options.grouping)
        : 0n;
      if (
        (!raw.debit?.trim() && !raw.credit?.trim()) ||
        debit < 0n ||
        credit < 0n ||
        (debit !== 0n && credit !== 0n)
      )
        throw new ImportError('AMBIGUOUS_DEBIT_CREDIT');
      amount = credit - debit;
    } else amount = decimalValue(raw.amount, options.decimal, options.grouping);
    if (
      options.amountMode !== 'ACCOUNT_DELTA' &&
      options.balance_nature === 'LIABILITY'
    )
      amount = -amount;
    return checkedMinor(amount);
  });
  const externalId = raw.externalId?.trim() || null;
  if (options.requireId && !externalId)
    errors.push({ field: 'external_id', code: 'MISSING_SOURCE_ID' });
  if (
    externalId &&
    (externalId.length > 255 || /[\u0000-\u001f]/.test(externalId))
  )
    errors.push({ field: 'external_id', code: 'INVALID_SOURCE_ID' });
  if (raw.correction)
    errors.push({ field: 'correction', code: 'UNSUPPORTED_CORRECTION' });
  return {
    row_no: raw.row,
    source_external_id: externalId,
    normalized_date: date,
    normalized_amount_minor: amount,
    currency_code: 'BRL',
    original_description: description,
    proposed_name: description.normalize('NFC').replace(/\s+/g, ' ').trim(),
    economic_kind: null,
    disposition: errors.length ? 'INVALID' : 'NEW',
    validation_errors: errors,
    warnings,
    source_fields: {
      date: raw.date ?? '',
      amount: raw.amount ?? '',
      debit: raw.debit ?? '',
      credit: raw.credit ?? '',
      type: raw.type ?? '',
    },
    provenance: {
      format: options.format,
      parser_version: parserVersion,
      source_locator: raw.locator,
    },
  };
}
