import { DomainError } from './errors.js';

declare const moneyBrand: unique symbol;
/** Signed i64 in the currency's smallest unit; its JSON representation is text. */
export type MoneyMinor = string & { readonly [moneyBrand]: true };
export const MIN_MONEY_MINOR = '-9223372036854775808';
export const MAX_MONEY_MINOR = '9223372036854775807';
export function moneyMinor(value: unknown): MoneyMinor {
  if (typeof value !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(value))
    throw new DomainError('MONEY_NON_CANONICAL');
  const magnitude = value.startsWith('-') ? value.slice(1) : value;
  const limit = value.startsWith('-')
    ? MIN_MONEY_MINOR.slice(1)
    : MAX_MONEY_MINOR;
  if (
    magnitude.length > limit.length ||
    (magnitude.length === limit.length && magnitude > limit)
  )
    throw new DomainError('MONEY_OUT_OF_RANGE');
  return value as MoneyMinor;
}
/** Wider intermediates are allowed; every final monetary result must fit i64. */
export function fromMoneyInteger(value: bigint): MoneyMinor {
  if (typeof value !== 'bigint') throw new DomainError('MONEY_NON_CANONICAL');
  return moneyMinor(value.toString());
}
export function moneyInteger(value: MoneyMinor): bigint {
  return BigInt(moneyMinor(value));
}
export function addMoney(left: MoneyMinor, right: MoneyMinor): MoneyMinor {
  return fromMoneyInteger(moneyInteger(left) + moneyInteger(right));
}
export function subtractMoney(left: MoneyMinor, right: MoneyMinor): MoneyMinor {
  return fromMoneyInteger(moneyInteger(left) - moneyInteger(right));
}
export function negateMoney(value: MoneyMinor): MoneyMinor {
  return fromMoneyInteger(-moneyInteger(value));
}
export function sumMoney(values: Iterable<MoneyMinor>): MoneyMinor {
  let total = 0n;
  for (const value of values) total += moneyInteger(value);
  return fromMoneyInteger(total);
}
export function compareMoney(left: MoneyMinor, right: MoneyMinor): -1 | 0 | 1 {
  const a = moneyInteger(left),
    b = moneyInteger(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
export function validateAllocationAmounts(
  total: MoneyMinor,
  allocations: readonly MoneyMinor[],
): void {
  const signed = moneyInteger(total),
    magnitude = signed < 0n ? -signed : signed;
  let sum = 0n;
  for (const amount of allocations) {
    const value = moneyInteger(amount);
    if (value <= 0n) throw new DomainError('INVALID_ALLOCATION');
    sum += value;
  }
  if (sum !== magnitude) throw new DomainError('ALLOCATION_TOTAL_MISMATCH');
}
