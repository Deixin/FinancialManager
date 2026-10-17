import type { SqliteConnection } from '../index.js';
import type { Account } from '@financial-manager/domain';
import type { RevisionScope } from '@financial-manager/finance-ports/revisions';
import { validateAccount } from '@financial-manager/domain';
import { RevisionError } from '@financial-manager/domain/revisions';
export async function revisionAccount(
  db: SqliteConnection,
  scope: RevisionScope,
  id: string,
): Promise<Account | null> {
  if (scope.account_ids !== null && !scope.account_ids.includes(id))
    throw new RevisionError('ACCESS_DENIED');
  const row = (
    await db.rows(
      'SELECT id,workspace_id,currency_code,account_kind,balance_nature,status FROM financial_account WHERE workspace_id=? AND id=?',
      [scope.workspace_id, id],
    )
  )[0];
  if (!row) return null;
  const account = row as unknown as Account;
  validateAccount(account, scope.workspace_id);
  return Object.freeze({ ...account });
}
