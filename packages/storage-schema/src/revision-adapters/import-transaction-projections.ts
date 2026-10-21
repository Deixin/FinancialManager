import type { SqliteConnection } from '../index.js';
export async function sqliteImportTransactionAccounts(
  db: SqliteConnection,
  w: string,
  ids: readonly string[],
) {
  if (!ids.length) return Object.freeze([]);
  return Object.freeze(
    (
      await db.rows(
        'SELECT id,workspace_id,account_id FROM financial_transaction WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id',
        [w, JSON.stringify(ids)],
      )
    ).map((r) => {
      if (
        typeof r.id !== 'string' ||
        typeof r.workspace_id !== 'string' ||
        typeof r.account_id !== 'string'
      )
        throw Error('DATA_ACCESS_FAILED');
      return Object.freeze({
        id: r.id,
        workspace_id: r.workspace_id,
        account_id: r.account_id,
      });
    }),
  );
}
