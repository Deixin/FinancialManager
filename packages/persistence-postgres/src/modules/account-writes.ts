import type { Kysely } from 'kysely';
import type { WriteAccountsTables } from '../internal/database.js';
import { instantColumn } from '../internal/projection.js';
import {
  AccountChangeError,
  decodeAccountState,
} from '@financial-manager/domain';
import type { AccountPlan } from '@financial-manager/domain';
import type { AccountWriteScope } from '@financial-manager/finance-ports';
export function postgresAccountWrites(
  db: Kysely<WriteAccountsTables>,
  scope: AccountWriteScope,
) {
  const permitted = (id: string) => {
    if (scope.account_ids !== null && !scope.account_ids.includes(id))
      throw new AccountChangeError('ACCESS_DENIED');
  };
  const check = (rows: readonly { id: string }[], id: string) => {
    if (rows.length !== 1 || rows[0]?.id !== id)
      throw new AccountChangeError('DATA_ACCESS_FAILED');
  };
  return Object.freeze({
    async load(id: string) {
      permitted(id);
      const row = await db
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
        .where('workspace_id', '=', scope.workspace_id)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return null;
      const references = await db
        .selectFrom('balance_reference')
        .select([
          'id',
          'workspace_id',
          'account_id',
          'day_position',
          'source',
          'status',
        ])
        .select((eb) => [
          eb.cast<string>('amount_minor', 'text').as('amount_minor'),
          eb.cast<string>('reference_date', 'text').as('reference_date'),
          instantColumn(eb, 'created_at').as('created_at'),
        ])
        .where('workspace_id', '=', scope.workspace_id)
        .where('account_id', '=', id)
        .orderBy('id')
        .execute();
      return decodeAccountState(
        { account: row, references },
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
          await db
            .insertInto('financial_account')
            .values(a)
            .returning('id')
            .execute(),
          a.id,
        );
      if (plan.kind === 'UPDATE')
        check(
          await db
            .updateTable('financial_account')
            .set({
              name: a.name,
              institution_name: a.institution_name,
              status: a.status,
            })
            .where('workspace_id', '=', scope.workspace_id)
            .where('id', '=', a.id)
            .returning('id')
            .execute(),
          a.id,
        );
      if (plan.replaces_id !== null)
        check(
          await db
            .updateTable('balance_reference')
            .set({ status: 'SUPERSEDED' })
            .where('workspace_id', '=', scope.workspace_id)
            .where('account_id', '=', a.id)
            .where('id', '=', plan.replaces_id)
            .where('status', '=', 'ACTIVE')
            .returning('id')
            .execute(),
          plan.replaces_id,
        );
      if (plan.reference_id !== null) {
        const r = plan.state.references.find((r) => r.id === plan.reference_id);
        if (!r) throw new AccountChangeError('DATA_ACCESS_FAILED');
        check(
          await db
            .insertInto('balance_reference')
            .values(r)
            .returning('id')
            .execute(),
          r.id,
        );
      }
    },
  });
}
