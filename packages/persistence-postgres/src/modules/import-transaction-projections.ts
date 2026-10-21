import type { Kysely } from 'kysely';
import type { TransactionsTables } from '../internal/database.js';
export async function postgresImportTransactionAccounts(
  db: Kysely<TransactionsTables>,
  w: string,
  ids: readonly string[],
) {
  if (!ids.length) return Object.freeze([]);
  return Object.freeze(
    await db
      .selectFrom('financial_transaction')
      .select(['id', 'workspace_id', 'account_id'])
      .where('workspace_id', '=', w)
      .where('id', 'in', ids)
      .orderBy('id')
      .execute(),
  );
}
