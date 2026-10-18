import { CounterpartyError } from '@financial-manager/domain/counterparties';
import type { SqliteConnection } from './index.js';
import { createCounterpartyService } from '@financial-manager/finance-ports/counterparties';
import type { CategoryWriteScope as CounterpartyWriteScope } from '@financial-manager/finance-ports/categories';
import type {
  CounterpartyOptions,
  CounterpartyTransaction,
} from '@financial-manager/finance-ports/counterparties';
import { sqliteCounterpartyWrites } from './revision-adapters/counterparty-writes.js';
import { categoryWorkspace } from './revision-adapters/workspaces.js';
export interface SqliteCounterpartyOptions extends Omit<
  CounterpartyOptions,
  'store'
> {
  readonly connection: SqliteConnection;
}
export function createSqliteCounterpartyService(
  options: SqliteCounterpartyOptions,
) {
  if (
    !options?.connection ||
    typeof options.connection.exec !== 'function' ||
    typeof options.connection.rows !== 'function' ||
    typeof options.connection.run !== 'function'
  )
    throw new CounterpartyError('CONFIGURATION_INVALID');
  const db = options.connection;
  let tail: Promise<unknown> = Promise.resolve(),
    closed = false,
    poisoned = false;
  const store = {
    transaction<T>(
      scope: CounterpartyWriteScope,
      operation: (tx: CounterpartyTransaction) => Promise<T>,
    ): Promise<T> {
      const work = tail.then(async () => {
        if (poisoned) throw new CounterpartyError('DATA_ACCESS_FAILED');
        let active = false;
        try {
          await db.exec(
            'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
          );
          if (
            String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !==
            '1'
          )
            throw new CounterpartyError('CONFIGURATION_INVALID');
          await db.exec('BEGIN IMMEDIATE');
          active = true;
          const result = await operation(
            Object.freeze({
              ...sqliteCounterpartyWrites(db, scope),
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
  const service = createCounterpartyService({ ...options, store }),
    pending = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new CounterpartyError('CLOSED'));
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
