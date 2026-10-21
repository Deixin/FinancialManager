import { ImportCentralError } from '@financial-manager/domain/imports';
import type { SqliteConnection } from './index.js';
import { createImportCentralService } from '@financial-manager/finance-ports/imports';
import type { ImportScope as ImportCentralWriteScope } from '@financial-manager/finance-ports/imports';
import type {
  ImportCentralOptions,
  ImportTransaction,
} from '@financial-manager/finance-ports/imports';
import { sqliteImportAccount } from './revision-adapters/import-account-projections.js';
import { sqliteImportTransactionAccounts } from './revision-adapters/import-transaction-projections.js';
import { sqliteImportLedger } from './revision-adapters/import-reads-writes.js';
import { categoryWorkspace } from './revision-adapters/workspaces.js';
export interface SqliteImportCentralOptions extends Omit<
  ImportCentralOptions,
  'store'
> {
  readonly connection: SqliteConnection;
}
export function createSqliteImportCentralService(
  options: SqliteImportCentralOptions,
) {
  if (
    !options?.connection ||
    typeof options.connection.exec !== 'function' ||
    typeof options.connection.rows !== 'function' ||
    typeof options.connection.run !== 'function'
  )
    throw new ImportCentralError('CONFIGURATION_INVALID');
  const db = options.connection;
  let tail: Promise<unknown> = Promise.resolve(),
    closed = false,
    poisoned = false;
  const store = {
    transaction<T>(
      scope: ImportCentralWriteScope,
      mode: 'READ' | 'WRITE',
      operation: (tx: ImportTransaction) => Promise<T>,
    ): Promise<T> {
      const work = tail.then(async () => {
        if (poisoned) throw new ImportCentralError('DATA_ACCESS_FAILED');
        let active = false;
        try {
          await db.exec(
            'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
          );
          if (
            String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !==
            '1'
          )
            throw new ImportCentralError('CONFIGURATION_INVALID');
          await db.exec(mode === 'WRITE' ? 'BEGIN IMMEDIATE' : 'BEGIN');
          active = true;
          const result = await operation(
            Object.freeze({
              ...sqliteImportLedger(db, scope),
              account: (id: string) =>
                sqliteImportAccount(db, scope.workspace_id, id),
              transactionAccounts: (ids: readonly string[]) =>
                sqliteImportTransactionAccounts(db, scope.workspace_id, ids),
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
  const service = createImportCentralService({ ...options, store }),
    pending = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new ImportCentralError('CLOSED'));
    const work = operation();
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  return Object.freeze({
    list: (...args: Parameters<typeof service.list>) =>
      track(() => service.list(...args)),
    detail: (...args: Parameters<typeof service.detail>) =>
      track(() => service.detail(...args)),
    prepare: (...args: Parameters<typeof service.prepare>) =>
      track(() => service.prepare(...args)),
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      await tail;
    },
  });
}
