import type { Kysely } from 'kysely';
import type { AccountsTables } from '../internal/database.js';
export async function postgresImportAccount(
  db: Kysely<AccountsTables>,
  w: string,
  id: string,
  lock: boolean,
) {
  let query = db
    .selectFrom('financial_account')
    .select(['id', 'workspace_id', 'status'])
    .where('workspace_id', '=', w)
    .where('id', '=', id);
  if (lock) query = query.forShare();
  return (await query.executeTakeFirst()) ?? null;
}
