import type { SqliteConnection } from '../index.js';
import {
  CategoryError,
  categoryNameKey,
  captureCategory,
} from '@financial-manager/domain/categories';
import type { CategoryPlan } from '@financial-manager/domain/categories';
import type { CategoryWriteScope } from '@financial-manager/finance-ports/categories';
export function sqliteCategoryWrites(
  db: SqliteConnection,
  scope: CategoryWriteScope,
) {
  const check = (
    rows: readonly Readonly<Record<string, string | number | null>>[],
    id: string,
  ) => {
    if (rows.length !== 1 || rows[0]?.id !== id)
      throw new CategoryError('DATA_ACCESS_FAILED');
  };
  return Object.freeze({
    async list() {
      const rows = await db.rows(
        'SELECT id,workspace_id,name,category_scope,sort_order,status,is_seeded FROM category WHERE workspace_id=? ORDER BY id LIMIT 10001',
        [scope.workspace_id],
      );
      return rows.map((r) => {
        if (![0, 1, '0', '1'].includes(r.is_seeded as number | string))
          throw new CategoryError('INVALID_CATEGORY_STATE');
        return captureCategory(
          {
            ...r,
            sort_order: Number(r.sort_order),
            is_seeded: r.is_seeded === 1 || r.is_seeded === '1',
          },
          scope.workspace_id,
        );
      });
    },
    async save(plan: CategoryPlan) {
      const a = plan.after;
      if (a.workspace_id !== scope.workspace_id)
        throw new CategoryError('DATA_ACCESS_FAILED');
      if (plan.before === null)
        check(
          await db.rows(
            'INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES(?,?,?,?,?,?,?,?) RETURNING id',
            [
              a.id,
              scope.workspace_id,
              a.name,
              categoryNameKey(a.name),
              a.category_scope,
              a.sort_order,
              a.status,
              a.is_seeded ? 1 : 0,
            ],
          ),
          a.id,
        );
      else
        check(
          await db.rows(
            'UPDATE category SET name=?,normalized_name=?,sort_order=?,status=? WHERE workspace_id=? AND id=? RETURNING id',
            [
              a.name,
              categoryNameKey(a.name),
              a.sort_order,
              a.status,
              scope.workspace_id,
              a.id,
            ],
          ),
          a.id,
        );
    },
  });
}
