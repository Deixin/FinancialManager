import type { Kysely } from 'kysely';
import type { WriteTaxonomyTables } from '../internal/database.js';
import {
  TaxonomyError,
  captureTaxonomyItem,
} from '@financial-manager/domain/taxonomy';
import { captureCategory } from '@financial-manager/domain/categories';
import type {
  TaxonomyPlan,
  TaxonomyItem,
} from '@financial-manager/domain/taxonomy';
import type { CategoryWriteScope } from '@financial-manager/finance-ports/categories';
export function postgresTaxonomyWrites(
  db: Kysely<WriteTaxonomyTables>,
  scope: CategoryWriteScope,
) {
  return Object.freeze({
    async catalog() {
      const categories = (
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
      const tags = await db
          .selectFrom('tag')
          .select(['id', 'workspace_id', 'name', 'status'])
          .where('workspace_id', '=', scope.workspace_id)
          .orderBy('id')
          .limit(10001)
          .forUpdate()
          .execute(),
        subs = await db
          .selectFrom('subcategory')
          .select([
            'id',
            'workspace_id',
            'category_id',
            'name',
            'sort_order',
            'status',
          ])
          .where('workspace_id', '=', scope.workspace_id)
          .orderBy('id')
          .limit(10001)
          .forUpdate()
          .execute();
      const items: TaxonomyItem[] = [
        ...tags.map((r) =>
          captureTaxonomyItem({ kind: 'TAG', ...r }, scope.workspace_id),
        ),
        ...subs.map((r) =>
          captureTaxonomyItem(
            { kind: 'SUBCATEGORY', ...r },
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
            ? await db
                .insertInto('tag')
                .values({
                  id: a.id,
                  workspace_id: scope.workspace_id,
                  name: a.name,
                  status: a.status,
                })
                .returning('id')
                .execute()
            : await db
                .updateTable('tag')
                .set({ name: a.name, status: a.status })
                .where('workspace_id', '=', scope.workspace_id)
                .where('id', '=', a.id)
                .returning('id')
                .execute();
      } else {
        rows =
          plan.before === null
            ? await db
                .insertInto('subcategory')
                .values({
                  id: a.id,
                  workspace_id: scope.workspace_id,
                  name: a.name,
                  status: a.status,
                  category_id: a.category_id,
                  sort_order: a.sort_order,
                })
                .returning('id')
                .execute()
            : await db
                .updateTable('subcategory')
                .set({
                  name: a.name,
                  status: a.status,
                  sort_order: a.sort_order,
                })
                .where('workspace_id', '=', scope.workspace_id)
                .where('id', '=', a.id)
                .where('category_id', '=', a.category_id)
                .returning('id')
                .execute();
      }
      if (rows.length !== 1 || rows[0]?.id !== a.id)
        throw new TaxonomyError('DATA_ACCESS_FAILED');
    },
  });
}
