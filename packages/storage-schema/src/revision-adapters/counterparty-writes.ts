import type { SqliteConnection } from '../index.js';
import {
  CounterpartyError,
  captureCounterparty,
  captureCounterpartyReference,
} from '@financial-manager/domain/counterparties';
import type { CounterpartyPlan } from '@financial-manager/domain/counterparties';
import type { CounterpartyWriteScope } from '@financial-manager/finance-ports/counterparties';
export function sqliteCounterpartyWrites(
  db: SqliteConnection,
  scope: CounterpartyWriteScope,
) {
  return Object.freeze({
    async references(ids: readonly string[]) {
      if (!ids.length) return Object.freeze([]);
      return Object.freeze(
        (
          await db.rows(
            'SELECT id,workspace_id,status FROM counterparty WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id',
            [scope.workspace_id, JSON.stringify(ids)],
          )
        ).map((r) => captureCounterpartyReference(r, scope.workspace_id)),
      );
    },
    async catalog() {
      return (
        await db.rows(
          'SELECT id,workspace_id,display_name,identifier_type,identifier_value,relationship_hint,status FROM counterparty WHERE workspace_id=? ORDER BY id LIMIT 10001',
          [scope.workspace_id],
        )
      ).map((r) => captureCounterparty(r, scope.workspace_id));
    },
    async save(plan: CounterpartyPlan) {
      const a = plan.after;
      if (a.workspace_id !== scope.workspace_id)
        throw new CounterpartyError('DATA_ACCESS_FAILED');
      const rows =
        plan.before === null
          ? await db.rows(
              'INSERT INTO counterparty(id,workspace_id,display_name,identifier_type,identifier_value,relationship_hint,status) VALUES(?,?,?,?,?,?,?) RETURNING id',
              [
                a.id,
                scope.workspace_id,
                a.display_name,
                a.identifier_type,
                a.identifier_value,
                a.relationship_hint,
                a.status,
              ],
            )
          : await db.rows(
              'UPDATE counterparty SET display_name=?,identifier_type=?,identifier_value=?,relationship_hint=?,status=? WHERE workspace_id=? AND id=? RETURNING id',
              [
                a.display_name,
                a.identifier_type,
                a.identifier_value,
                a.relationship_hint,
                a.status,
                scope.workspace_id,
                a.id,
              ],
            );
      if (rows.length !== 1 || rows[0]?.id !== a.id)
        throw new CounterpartyError('DATA_ACCESS_FAILED');
    },
  });
}
