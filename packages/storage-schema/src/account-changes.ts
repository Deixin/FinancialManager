import type { SqliteConnection } from './index.js';
import {
  createAccountWriteService,
  AccountChangeError,
} from '@financial-manager/finance-ports';
import type {
  AccountWriteOptions,
  AccountWriteScope,
  AccountWriteTransaction,
} from '@financial-manager/finance-ports';
import { sqliteAccountWrites } from './revision-adapters/account-writes.js';
import { revisionWorkspace } from './revision-adapters/workspaces.js';
export interface SqliteAccountOptions extends Omit<
  AccountWriteOptions,
  'store'
> {
  readonly connection: SqliteConnection;
}
export function createSqliteAccountService(options: SqliteAccountOptions) {
  if (
    !options?.connection ||
    typeof options.connection.exec !== 'function' ||
    typeof options.connection.rows !== 'function' ||
    typeof options.connection.run !== 'function'
  )
    throw new AccountChangeError('CONFIGURATION_INVALID');
  const db = options.connection;
  let tail: Promise<unknown> = Promise.resolve(),
    closed = false,
    poisoned = false;
  const store = {
    transaction<T>(
      scope: AccountWriteScope,
      operation: (tx: AccountWriteTransaction) => Promise<T>,
    ): Promise<T> {
      const work = tail.then(async () => {
        if (poisoned) throw new AccountChangeError('DATA_ACCESS_FAILED');
        let active = false;
        try {
          await db.exec(
            'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
          );
          if (
            String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !==
            '1'
          )
            throw new AccountChangeError('CONFIGURATION_INVALID');
          await db.exec('BEGIN IMMEDIATE');
          active = true;
          const result = await operation(
            Object.freeze({
              ...sqliteAccountWrites(db, scope),
              workspaceMode: () => revisionWorkspace(db, scope.workspace_id),
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
  const service = createAccountWriteService({ ...options, store }),
    pending = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new AccountChangeError('CLOSED'));
    const work = operation();
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  return Object.freeze({
    apply: (...args: Parameters<typeof service.apply>) =>
      track(() => service.apply(...args)),
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      await tail;
    },
  });
}
