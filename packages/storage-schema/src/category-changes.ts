import { CategoryError } from '@financial-manager/domain/categories';
import type { SqliteConnection } from './index.js';
import { createCategoryService } from '@financial-manager/finance-ports/categories';
import type {
  CategoryOptions,
  CategoryWriteScope,
  CategoryTransaction,
} from '@financial-manager/finance-ports/categories';
import { sqliteCategoryWrites } from './revision-adapters/category-writes.js';
import { categoryWorkspace } from './revision-adapters/workspaces.js';
export interface SqliteCategoryOptions extends Omit<CategoryOptions, 'store'> {
  readonly connection: SqliteConnection;
}
export function createSqliteCategoryService(options: SqliteCategoryOptions) {
  if (
    !options?.connection ||
    typeof options.connection.exec !== 'function' ||
    typeof options.connection.rows !== 'function' ||
    typeof options.connection.run !== 'function'
  )
    throw new CategoryError('CONFIGURATION_INVALID');
  const db = options.connection;
  let tail: Promise<unknown> = Promise.resolve(),
    closed = false,
    poisoned = false;
  const store = {
    transaction<T>(
      scope: CategoryWriteScope,
      operation: (tx: CategoryTransaction) => Promise<T>,
    ): Promise<T> {
      const work = tail.then(async () => {
        if (poisoned) throw new CategoryError('DATA_ACCESS_FAILED');
        let active = false;
        try {
          await db.exec(
            'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
          );
          if (
            String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !==
            '1'
          )
            throw new CategoryError('CONFIGURATION_INVALID');
          await db.exec('BEGIN IMMEDIATE');
          active = true;
          const result = await operation(
            Object.freeze({
              ...sqliteCategoryWrites(db, scope),
              workspace: () => categoryWorkspace(db, scope.workspace_id),
            }),
          );
          await db.exec('COMMIT');
          active = false;
          return result;
        } catch (error) {
          if (active)
            try {
              await db.exec('ROLLBACK');
            } catch {
              poisoned = true;
            }
          throw error;
        }
      });
      tail = work.catch(() => {});
      return work;
    },
  };
  const service = createCategoryService({ ...options, store }),
    pending = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new CategoryError('CLOSED'));
    const work = operation();
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  return Object.freeze({
    list: (...args: Parameters<typeof service.list>) =>
      track(() => service.list(...args)),
    apply: (...args: Parameters<typeof service.apply>) =>
      track(() => service.apply(...args)),
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      await tail;
    },
  });
}
