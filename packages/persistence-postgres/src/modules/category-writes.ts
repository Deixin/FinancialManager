import type { Kysely } from 'kysely';
import type { WriteCategoriesTables } from '../internal/database.js';
import {
  CategoryError,
  captureCategory,
} from '@financial-manager/domain/categories';
import type { CategoryPlan } from '@financial-manager/domain/categories';
import type { CategoryWriteScope } from '@financial-manager/finance-ports/categories';
export function postgresCategoryWrites(
  db: Kysely<WriteCategoriesTables>,
  scope: CategoryWriteScope,
) {
  const check = (rows: readonly { id: string }[], id: string) => {
    if (rows.length !== 1 || rows[0]?.id !== id)
      throw new CategoryError('DATA_ACCESS_FAILED');
  };
  return Object.freeze({
    async list() {
      return (
        await db
          .selectFrom('category')
          .select([
            'id',
            'workspace_id',
            'name',
            'category_scope',
            'sort_order',
            'status',
            'is_seeded',
          ])
          .where('workspace_id', '=', scope.workspace_id)
          .orderBy('id')
          .limit(10001)
          .forUpdate()
          .execute()
      ).map((r) => captureCategory(r, scope.workspace_id));
    },
    async save(plan: CategoryPlan) {
      const a = plan.after;
      if (a.workspace_id !== scope.workspace_id)
        throw new CategoryError('DATA_ACCESS_FAILED');
      try {
        if (plan.before === null)
          check(
            await db.insertInto('category').values(a).returning('id').execute(),
            a.id,
          );
        else
          check(
            await db
              .updateTable('category')
              .set({ name: a.name, sort_order: a.sort_order, status: a.status })
              .where('workspace_id', '=', scope.workspace_id)
              .where('id', '=', a.id)
              .returning('id')
              .execute(),
            a.id,
          );
      } catch (e) {
        if (
          e &&
          typeof e === 'object' &&
          'code' in e &&
          e.code === '23505' &&
          'constraint' in e &&
          e.constraint === 'category_active_name'
        )
          throw new CategoryError('CATEGORY_NAME_CONFLICT');
        throw e;
      }
    },
  });
}
