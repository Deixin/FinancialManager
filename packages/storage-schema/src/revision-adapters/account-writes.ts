import type { SqliteConnection } from '../index.js';
import {
  AccountChangeError,
  decodeAccountState,
} from '@financial-manager/domain';
import type { AccountPlan } from '@financial-manager/domain';
import type { AccountWriteScope } from '@financial-manager/finance-ports';
export function sqliteAccountWrites(
  db: SqliteConnection,
  scope: AccountWriteScope,
) {
  const permitted = (id: string) => {
    if (scope.account_ids !== null && !scope.account_ids.includes(id))
      throw new AccountChangeError('ACCESS_DENIED');
  };
  const check = (
    rows: readonly Readonly<Record<string, string | number | null>>[],
    id: string,
  ) => {
    if (rows.length !== 1 || rows[0]?.id !== id)
      throw new AccountChangeError('DATA_ACCESS_FAILED');
  };
  return Object.freeze({
    async load(id: string) {
      permitted(id);
      const row = (
        await db.rows(
          'SELECT id,workspace_id,name,account_kind,balance_nature,currency_code,status,institution_name,created_at FROM financial_account WHERE workspace_id=? AND id=?',
          [scope.workspace_id, id],
        )
      )[0];
      if (!row) return null;
      const references = await db.rows(
        'SELECT id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status,created_at FROM balance_reference WHERE workspace_id=? AND account_id=? ORDER BY id',
        [scope.workspace_id, id],
      );
      return decodeAccountState(
        {
          account: row,
          references: references.map((r) => ({
            ...r,
            amount_minor: String(r.amount_minor),
          })),
        },
        scope.workspace_id,
      );
    },
    async save(plan: AccountPlan) {
      const a = plan.state.account;
      permitted(a.id);
      if (a.workspace_id !== scope.workspace_id || !plan.changed)
        throw new AccountChangeError('DATA_ACCESS_FAILED');
      if (plan.kind === 'CREATE')
        check(
          await db.rows(
            'INSERT INTO financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status,institution_name,created_at) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id',
            [
              a.id,
              a.workspace_id,
              a.name,
              a.account_kind,
              a.balance_nature,
              a.currency_code,
              a.status,
              a.institution_name,
              a.created_at,
            ],
          ),
          a.id,
        );
      if (plan.kind === 'UPDATE')
        check(
          await db.rows(
            'UPDATE financial_account SET name=?,institution_name=?,status=? WHERE workspace_id=? AND id=? RETURNING id',
            [a.name, a.institution_name, a.status, a.workspace_id, a.id],
          ),
          a.id,
        );
      if (plan.replaces_id !== null)
        check(
          await db.rows(
            "UPDATE balance_reference SET status='SUPERSEDED' WHERE workspace_id=? AND account_id=? AND id=? AND status='ACTIVE' RETURNING id",
            [a.workspace_id, a.id, plan.replaces_id],
          ),
          plan.replaces_id,
        );
      if (plan.reference_id !== null) {
        const r = plan.state.references.find((r) => r.id === plan.reference_id);
        if (!r) throw new AccountChangeError('DATA_ACCESS_FAILED');
        check(
          await db.rows(
            'INSERT INTO balance_reference(id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id',
            [
              r.id,
              r.workspace_id,
              r.account_id,
              r.amount_minor,
              r.reference_date,
              r.day_position,
              r.source,
              r.status,
              r.created_at,
            ],
          ),
          r.id,
        );
      }
    },
  });
}
