import { DomainError } from './errors.js';
import { financialDate } from './model.js';
export type UtcInstant = string & { readonly __utcInstant: unique symbol };
export const MIN_INSTANT_MILLISECONDS = -62135596800000;
export const MAX_INSTANT_MILLISECONDS = 253402300799999;
// Internal/JSON representation: Gregorian year 0001..9999, UTC, exactly milliseconds.
// Financial dates remain independent calendar dates and never inherit a timezone.
export function utcInstant(value: unknown): UtcInstant {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    throw new DomainError('INVALID_INSTANT');
  try {
    financialDate(value.slice(0, 10));
  } catch {
    throw new DomainError('INVALID_INSTANT');
  }
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new DomainError('INVALID_INSTANT');
  return value as UtcInstant;
}
export function instantFromEpochMilliseconds(value: number): UtcInstant {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_INSTANT_MILLISECONDS ||
    value > MAX_INSTANT_MILLISECONDS
  )
    throw new DomainError('INVALID_INSTANT');
  return utcInstant(new Date(value).toISOString());
}
export function instantEpochMilliseconds(value: UtcInstant): number {
  return Date.parse(utcInstant(value));
}
