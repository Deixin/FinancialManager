import type { Kysely } from 'kysely';
import type {
  TransactionsReadPort,
  TransactionRecord,
  TransactionCursor,
  AllocationRecord,
  RevisionHeader,
} from '@financial-manager/finance-ports';
import { DataAccessError } from '@financial-manager/finance-ports';
import type { TransactionsTables } from '../internal/database.js';
import {
  ReadGuard,
  inputId,
  inputDate,
  inputLimit,
  requireAccount,
} from '../internal/scope.js';
import {
  id,
  text,
  nullableText,
  nullableId,
  instant,
  date,
  money,
  version,
  decoded,
  instantColumn,
  freezePage,
} from '../internal/projection.js';
export function createTransactionsRepository(
  db: Kysely<TransactionsTables>,
  guard: ReadGuard,
): TransactionsReadPort {
  const context = guard.context;
  const transactions = () => {
    let query = db
      .selectFrom('financial_transaction')
      .select([
        'id',
        'workspace_id',
        'account_id',
        'group_id',
        'counterparty_id',
        'economic_kind',
        'original_description',
        'display_name',
        'origin_kind',
      ])
      .select((eb) => [
        eb.cast<string>('financial_date', 'text').as('financial_date'),
        eb
          .cast<string>('account_amount_minor', 'text')
          .as('account_amount_minor'),
        eb.cast<string>('version', 'text').as('version'),
        instantColumn(eb, 'created_at').as('created_at'),
        instantColumn(eb, 'updated_at').as('updated_at'),
      ])
      .where('workspace_id', '=', context.workspace_id)
      .where('deleted_at', 'is', null);
    if (context.account_ids !== null)
      query = context.account_ids.length
        ? query.where('account_id', 'in', context.account_ids)
        : query.where((eb) => eb.val(false));
    return query;
  };
  type Row = Awaited<
    ReturnType<ReturnType<typeof transactions>['execute']>
  >[number];
  const project = (row: Row): TransactionRecord =>
    decoded(() => {
      const value = Object.freeze({
        ...row,
        id: id(row.id),
        workspace_id: id(row.workspace_id),
        account_id: id(row.account_id),
        group_id: nullableId(row.group_id),
        counterparty_id: nullableId(row.counterparty_id),
        financial_date: date(row.financial_date),
        account_amount_minor: money(row.account_amount_minor),
        original_description: nullableText(row.original_description),
        display_name: text(row.display_name),
        version: version(row.version),
        created_at: instant(row.created_at),
        updated_at: instant(row.updated_at),
      });
      if (value.workspace_id !== context.workspace_id)
        throw new DataAccessError('DATA_INVALID');
      requireAccount(context, value.account_id);
      return value;
    });
  const parent = async (transaction: string) => {
    const row = await transactions()
      .where('id', '=', transaction)
      .executeTakeFirst();
    return row ? project(row) : null;
  };
  return Object.freeze<TransactionsReadPort>({
    get(value) {
      const transaction = inputId(value);
      return guard.query('transactions:read', () => parent(transaction));
    },
    page(input) {
      const account =
          input.account_id == null ? null : inputId(input.account_id),
        from = inputDate(input.from),
        through = inputDate(input.through),
        limit = inputLimit(input.limit);
      if (from > through) throw new DataAccessError('INVALID_INPUT');
      if (account) requireAccount(context, account);
      const cursor = input.cursor
        ? Object.freeze({
            ...input.cursor,
            workspace_id: inputId(input.cursor.workspace_id),
            account_id:
              input.cursor.account_id === null
                ? null
                : inputId(input.cursor.account_id),
            from: inputDate(input.cursor.from),
            through: inputDate(input.cursor.through),
            financial_date: inputDate(input.cursor.financial_date),
            id: inputId(input.cursor.id),
          })
        : null;
      if (
        cursor &&
        (cursor.workspace_id !== context.workspace_id ||
          cursor.account_id !== account ||
          cursor.from !== from ||
          cursor.through !== through ||
          cursor.financial_date < from ||
          cursor.financial_date > through)
      )
        throw new DataAccessError('INVALID_INPUT');
      return guard.query('transactions:read', async () => {
        let query = transactions()
          .where((eb) =>
            eb.and([
              eb('financial_date', '>=', eb.cast<Date>(eb.val(from), 'date')),
              eb(
                'financial_date',
                '<=',
                eb.cast<Date>(eb.val(through), 'date'),
              ),
            ]),
          )
          .orderBy('financial_transaction.financial_date')
          .orderBy('id')
          .limit(limit + 1);
        if (account) query = query.where('account_id', '=', account);
        if (cursor)
          query = query.where((eb) =>
            eb.or([
              eb(
                'financial_date',
                '>',
                eb.cast<Date>(eb.val(cursor.financial_date), 'date'),
              ),
              eb.and([
                eb(
                  'financial_date',
                  '=',
                  eb.cast<Date>(eb.val(cursor.financial_date), 'date'),
                ),
                eb('id', '>', cursor.id),
              ]),
            ]),
          );
        return freezePage(
          (await query.execute()).map(project),
          limit,
          (last): TransactionCursor => ({
            workspace_id: context.workspace_id,
            account_id: account,
            from,
            through,
            financial_date: last.financial_date,
            id: last.id,
          }),
        );
      });
    },
    allocations(value) {
      const transaction = inputId(value);
      return guard.query('transactions:read', async () => {
        let query = db
          .selectFrom('transaction_allocation as a')
          .innerJoin('financial_transaction as t', (join) =>
            join
              .onRef('t.workspace_id', '=', 'a.workspace_id')
              .onRef('t.id', '=', 'a.transaction_id'),
          )
          .select([
            'a.id',
            'a.transaction_id',
            'a.category_id',
            'a.subcategory_id',
          ])
          .select((eb) =>
            eb.cast<string>('a.amount_minor', 'text').as('amount_minor'),
          )
          .where('a.workspace_id', '=', context.workspace_id)
          .where('t.workspace_id', '=', context.workspace_id)
          .where('a.transaction_id', '=', transaction)
          .where('t.deleted_at', 'is', null)
          .orderBy('a.id');
        if (context.account_ids !== null)
          query = context.account_ids.length
            ? query.where('t.account_id', 'in', context.account_ids)
            : query.where((eb) => eb.val(false));
        return Object.freeze(
          (await query.execute()).map((row): AllocationRecord =>
            decoded(() =>
              Object.freeze({
                ...row,
                id: id(row.id),
                transaction_id: id(row.transaction_id),
                category_id: id(row.category_id),
                subcategory_id: nullableId(row.subcategory_id),
                amount_minor: money(row.amount_minor),
              }),
            ),
          ),
        );
      });
    },
    tagIds(value) {
      const transaction = inputId(value);
      return guard.query('transactions:read', async () => {
        let query = db
          .selectFrom('transaction_tag as a')
          .innerJoin('financial_transaction as t', (join) =>
            join
              .onRef('t.workspace_id', '=', 'a.workspace_id')
              .onRef('t.id', '=', 'a.transaction_id'),
          )
          .select('a.tag_id')
          .where('a.workspace_id', '=', context.workspace_id)
          .where('t.workspace_id', '=', context.workspace_id)
          .where('a.transaction_id', '=', transaction)
          .where('t.deleted_at', 'is', null)
          .orderBy('a.tag_id');
        if (context.account_ids !== null)
          query = context.account_ids.length
            ? query.where('t.account_id', 'in', context.account_ids)
            : query.where((eb) => eb.val(false));
        return Object.freeze(
          (await query.execute()).map((row) => decoded(() => id(row.tag_id))),
        );
      });
    },
    revisions(value) {
      const transaction = inputId(value);
      return guard.query('transactions:read', async () => {
        let query = db
          .selectFrom('transaction_revision as a')
          .innerJoin('financial_transaction as t', (join) =>
            join
              .onRef('t.workspace_id', '=', 'a.workspace_id')
              .onRef('t.id', '=', 'a.transaction_id'),
          )
          .select(['a.id', 'a.transaction_id', 'a.change_source'])
          .select((eb) => [
            eb.cast<string>('a.version', 'text').as('version'),
            instantColumn(eb, 'a.created_at').as('created_at'),
          ])
          .where('a.workspace_id', '=', context.workspace_id)
          .where('t.workspace_id', '=', context.workspace_id)
          .where('a.transaction_id', '=', transaction)
          .where('t.deleted_at', 'is', null)
          .orderBy('a.version')
          .orderBy('a.id');
        if (context.account_ids !== null)
          query = context.account_ids.length
            ? query.where('t.account_id', 'in', context.account_ids)
            : query.where((eb) => eb.val(false));
        return Object.freeze(
          (await query.execute()).map((row): RevisionHeader =>
            decoded(() =>
              Object.freeze({
                ...row,
                id: id(row.id),
                transaction_id: id(row.transaction_id),
                version: version(row.version),
                created_at: instant(row.created_at),
              }),
            ),
          ),
        );
      });
    },
  });
}
