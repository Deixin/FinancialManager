import type { SqliteConnection } from '../index.js';
import {
  TaxonomyError,
  captureTaxonomyItem,
} from '@financial-manager/domain/taxonomy';
import {
  captureCategory,
  categoryNameKey,
} from '@financial-manager/domain/categories';
import type {
  TaxonomyPlan,
  TaxonomyItem,
} from '@financial-manager/domain/taxonomy';
import type { CategoryWriteScope } from '@financial-manager/finance-ports/categories';
export function sqliteTaxonomyWrites(
  db: SqliteConnection,
  scope: CategoryWriteScope,
) {
  return Object.freeze({
    async catalog() {
      const categories = (
        await db.rows(
          'SELECT id,workspace_id,name,category_scope,sort_order,status,is_seeded FROM category WHERE workspace_id=? ORDER BY id LIMIT 10001',
          [scope.workspace_id],
        )
      ).map((r) => {
        if (![0, 1, '0', '1'].includes(r.is_seeded as string | number))
          throw new TaxonomyError('INVALID_TAXONOMY_STATE');
        return captureCategory(
          {
            ...r,
            sort_order: Number(r.sort_order),
            is_seeded: r.is_seeded === 1 || r.is_seeded === '1',
          },
          scope.workspace_id,
        );
      });
      const tags = await db.rows(
          'SELECT id,workspace_id,name,status FROM tag WHERE workspace_id=? ORDER BY id LIMIT 10001',
          [scope.workspace_id],
        ),
        subcategories = await db.rows(
          'SELECT id,workspace_id,category_id,name,sort_order,status FROM subcategory WHERE workspace_id=? ORDER BY id LIMIT 10001',
          [scope.workspace_id],
        );
      const items: TaxonomyItem[] = [
        ...tags.map((r) =>
          captureTaxonomyItem({ kind: 'TAG', ...r }, scope.workspace_id),
        ),
        ...subcategories.map((r) =>
          captureTaxonomyItem(
            { kind: 'SUBCATEGORY', ...r, sort_order: Number(r.sort_order) },
            scope.workspace_id,
          ),
        ),
      ];
      return { categories, items };
    },
    async save(plan: TaxonomyPlan) {
      const a = plan.after;
      if (a.workspace_id !== scope.workspace_id)
        throw new TaxonomyError('DATA_ACCESS_FAILED');
      let rows;
      if (a.kind === 'TAG') {
        rows =
          plan.before === null
            ? await db.rows(
                'INSERT INTO tag(id,workspace_id,name,normalized_name,status) VALUES(?,?,?,?,?) RETURNING id',
                [
                  a.id,
                  scope.workspace_id,
                  a.name,
                  categoryNameKey(a.name),
                  a.status,
                ],
              )
            : await db.rows(
                'UPDATE tag SET name=?,normalized_name=?,status=? WHERE workspace_id=? AND id=? RETURNING id',
                [
                  a.name,
                  categoryNameKey(a.name),
                  a.status,
                  scope.workspace_id,
                  a.id,
                ],
              );
      } else {
        rows =
          plan.before === null
            ? await db.rows(
                'INSERT INTO subcategory(id,workspace_id,category_id,name,sort_order,status) VALUES(?,?,?,?,?,?) RETURNING id',
                [
                  a.id,
                  scope.workspace_id,
                  a.category_id,
                  a.name,
                  a.sort_order,
                  a.status,
                ],
              )
            : await db.rows(
                'UPDATE subcategory SET name=?,sort_order=?,status=? WHERE workspace_id=? AND id=? AND category_id=? RETURNING id',
                [
                  a.name,
                  a.sort_order,
                  a.status,
                  scope.workspace_id,
                  a.id,
                  a.category_id,
                ],
              );
      }
      if (rows.length !== 1 || rows[0]?.id !== a.id)
        throw new TaxonomyError('DATA_ACCESS_FAILED');
    },
  });
}
