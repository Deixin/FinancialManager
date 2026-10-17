import type { Kysely } from 'kysely';
import { validateAccount } from '@financial-manager/domain';
import type {
  AccountRecord,
  AccountsReadPort,
  AccountCursor,
  ReferenceRecord,
  ReferenceCursor,
} from '@financial-manager/finance-ports';
import { DataAccessError } from '@financial-manager/finance-ports';
import type { AccountsTables } from '../internal/database.js';
import {
  ReadGuard,
  inputId,
  inputLimit,
  requireAccount,
  inputDate,
} from '../internal/scope.js';
import {
  id,
  text,
  nullableText,
  instant,
  date,
  money,
  decoded,
  instantColumn,
  freezePage,
} from '../internal/projection.js';
export function createAccountsRepository(
  db: Kysely<AccountsTables>,
  guard: ReadGuard,
): AccountsReadPort {
  const context = guard.context;
  const accounts = () => {
    let query = db
      .selectFrom('financial_account')
      .select([
        'id',
        'workspace_id',
        'name',
        'account_kind',
        'balance_nature',
        'currency_code',
        'status',
        'institution_name',
      ])
      .select((eb) => instantColumn(eb, 'created_at').as('created_at'))
      .where('workspace_id', '=', context.workspace_id);
    if (context.account_ids !== null)
      query = context.account_ids.length
        ? query.where('id', 'in', context.account_ids)
        : query.where((eb) => eb.val(false));
    return query;
  };
  type Row = Awaited<
    ReturnType<ReturnType<typeof accounts>['execute']>
  >[number];
  const project = (row: Row): AccountRecord =>
    decoded(() => {
      const value = Object.freeze({
        ...row,
        id: id(row.id),
        workspace_id: id(row.workspace_id),
        name: text(row.name),
        institution_name: nullableText(row.institution_name),
        created_at: instant(row.created_at),
      });
      validateAccount(value, context.workspace_id);
      requireAccount(context, value.id);
      return value;
    });
  return Object.freeze<AccountsReadPort>({
    get(value) {
      const account = inputId(value);
      requireAccount(context, account);
      return guard.query('accounts:read', async () => {
        const row = await accounts()
          .where('id', '=', account)
          .executeTakeFirst();
        return row ? project(row) : null;
      });
    },
    page(input) {
      const limit = inputLimit(input.limit),
        cursor = input.cursor
          ? Object.freeze({
              workspace_id: inputId(input.cursor.workspace_id),
              id: inputId(input.cursor.id),
            })
          : null;
      if (cursor && cursor.workspace_id !== context.workspace_id)
        throw new DataAccessError('INVALID_INPUT');
      return guard.query('accounts:read', async () => {
        let query = accounts()
          .orderBy('id')
          .limit(limit + 1);
        if (cursor) query = query.where('id', '>', cursor.id);
        return freezePage(
          (await query.execute()).map(project),
          limit,
          (last): AccountCursor => ({
            workspace_id: context.workspace_id,
            id: last.id,
          }),
        );
      });
    },
    references(input) {
      const account = inputId(input.account_id),
        limit = inputLimit(input.limit);
      requireAccount(context, account);
      const cursor = input.cursor
        ? Object.freeze({
            workspace_id: inputId(input.cursor.workspace_id),
            account_id: inputId(input.cursor.account_id),
            reference_date: inputDate(input.cursor.reference_date),
            id: inputId(input.cursor.id),
          })
        : null;
      if (
        cursor &&
        (cursor.workspace_id !== context.workspace_id ||
          cursor.account_id !== account)
      )
        throw new DataAccessError('INVALID_INPUT');
      return guard.query('accounts:read', async () => {
        let query = db
          .selectFrom('balance_reference')
          .select([
            'id',
            'workspace_id',
            'account_id',
            'day_position',
            'status',
            'source',
          ])
          .select((eb) => [
            eb.cast<string>('amount_minor', 'text').as('amount_minor'),
            eb.cast<string>('reference_date', 'text').as('reference_date'),
            instantColumn(eb, 'created_at').as('created_at'),
          ])
          .where('workspace_id', '=', context.workspace_id)
          .where('account_id', '=', account)
          .orderBy('balance_reference.reference_date')
          .orderBy('id')
          .limit(limit + 1);
        if (cursor)
          query = query.where((eb) =>
            eb.or([
              eb(
                'reference_date',
                '>',
                eb.cast<Date>(eb.val(cursor.reference_date), 'date'),
              ),
              eb.and([
                eb(
                  'reference_date',
                  '=',
                  eb.cast<Date>(eb.val(cursor.reference_date), 'date'),
                ),
                eb('id', '>', cursor.id),
              ]),
            ]),
          );
        const rows = (await query.execute()).map((row): ReferenceRecord =>
          decoded(() =>
            Object.freeze({
              ...row,
              id: id(row.id),
              workspace_id: id(row.workspace_id),
              account_id: id(row.account_id),
              amount_minor: money(row.amount_minor),
              reference_date: date(row.reference_date),
              created_at: instant(row.created_at),
            }),
          ),
        );
        return freezePage(rows, limit, (last): ReferenceCursor => ({
          workspace_id: context.workspace_id,
          account_id: account,
          reference_date: last.reference_date,
          id: last.id,
        }));
      });
    },
  });
}
