import type { ExpressionBuilder, ReferenceExpression } from 'kysely';
import { DataAccessError } from '@financial-manager/finance-ports';
import {
  moneyMinor,
  utcInstant,
  financialDate,
} from '@financial-manager/domain';
import { resourceId } from '@financial-manager/contracts';
export const id = resourceId,
  instant = utcInstant,
  date = financialDate,
  money = moneyMinor;
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new DataAccessError('DATA_INVALID');
  return value;
}
export function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
export function nullableId(value: unknown) {
  return value === null ? null : id(value);
}
export function version(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new DataAccessError('DATA_INVALID');
  return value;
}
export function decoded<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new DataAccessError('DATA_INVALID');
  }
}
export function instantColumn<DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  column: ReferenceExpression<DB, TB>,
) {
  return eb.fn<string>('to_char', [
    eb.fn('timezone', [eb.val('UTC'), column]),
    eb.val('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  ]);
}
export function freezePage<T, C>(
  rows: readonly T[],
  limit: number,
  cursor: (last: T) => C,
) {
  const items = Object.freeze(rows.slice(0, limit));
  const last = items.at(-1);
  return Object.freeze({
    items,
    next_cursor:
      rows.length > limit && last !== undefined
        ? Object.freeze(cursor(last))
        : null,
  });
}
