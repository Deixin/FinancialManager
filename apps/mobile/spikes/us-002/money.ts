// Experimental transport contract. Product MoneyMinor belongs to US-013.
export type MoneyMinor = string & { readonly __moneyMinor: unique symbol };

export function moneyMinor(value: unknown): MoneyMinor {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error('MONEY_NON_CANONICAL');
  }
  const magnitude = value.startsWith('-') ? value.slice(1) : value;
  const limit = value.startsWith('-')
    ? '9223372036854775808'
    : '9223372036854775807';
  if (
    magnitude.length > limit.length ||
    (magnitude.length === limit.length && magnitude > limit)
  ) {
    throw new Error('MONEY_OUT_OF_RANGE');
  }
  return value as MoneyMinor;
}

// Synthetic vectors only. Include both sides of the JavaScript precision boundary.
export const SYNTHETIC_VECTORS = [
  '0',
  '1',
  '-1',
  '9007199254740991',
  '9007199254740992',
  '9007199254740993',
  '-9007199254740993',
  '9223372036854775807',
  '-9223372036854775808',
].map(moneyMinor);

export const INVALID_VECTORS: unknown[] = [
  '',
  '00',
  '-0',
  '+1',
  '01',
  '-01',
  '1.0',
  '1e2',
  ' 1',
  '1 ',
  '9223372036854775808',
  '-9223372036854775809',
  1,
  null,
  undefined,
];
