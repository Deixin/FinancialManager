import type { Kysely } from 'kysely';
import type { WriteCounterpartiesTables } from '../internal/database.js';
import {
  CounterpartyError,
  captureCounterparty,
  captureCounterpartyReference,
} from '@financial-manager/domain/counterparties';
import type { CounterpartyPlan } from '@financial-manager/domain/counterparties';
import type { CounterpartyWriteScope } from '@financial-manager/finance-ports/counterparties';
export function postgresCounterpartyWrites(
  db: Kysely<WriteCounterpartiesTables>,
  scope: CounterpartyWriteScope,
) {
  return Object.freeze({
    async references(ids: readonly string[]) {
      if (!ids.length) return Object.freeze([]);
      return Object.freeze(
        (
          await db
            .selectFrom('counterparty')
            .select(['id', 'workspace_id', 'status'])
            .where('workspace_id', '=', scope.workspace_id)
            .where('id', 'in', ids)
            .orderBy('id')
            .forUpdate()
            .execute()
        ).map((r) => captureCounterpartyReference(r, scope.workspace_id)),
      );
    },
    async catalog() {
      return (
        await db
          .selectFrom('counterparty')
          .selectAll()
          .where('workspace_id', '=', scope.workspace_id)
          .orderBy('id')
          .limit(10001)
          .forUpdate()
          .execute()
      ).map((r) => captureCounterparty(r, scope.workspace_id));
    },
    async save(plan: CounterpartyPlan) {
      const a = plan.after;
      if (a.workspace_id !== scope.workspace_id)
        throw new CounterpartyError('DATA_ACCESS_FAILED');
      const values = {
        display_name: a.display_name,
        identifier_type: a.identifier_type,
        identifier_value: a.identifier_value,
        relationship_hint: a.relationship_hint,
        status: a.status,
      };
      const rows =
        plan.before === null
          ? await db
              .insertInto('counterparty')
              .values({ id: a.id, workspace_id: scope.workspace_id, ...values })
              .returning('id')
              .execute()
          : await db
              .updateTable('counterparty')
              .set(values)
              .where('workspace_id', '=', scope.workspace_id)
              .where('id', '=', a.id)
              .returning('id')
              .execute();
      if (rows.length !== 1 || rows[0]?.id !== a.id)
        throw new CounterpartyError('DATA_ACCESS_FAILED');
    },
  });
}
