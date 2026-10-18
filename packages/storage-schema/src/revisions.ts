import type { SqliteConnection } from './index.js';
import {
  createRevisionService,
  RevisionError,
} from '@financial-manager/finance-ports/revisions';
import type {
  RevisionOptions,
  RevisionScope,
  RevisionTransaction,
} from '@financial-manager/finance-ports/revisions';
import { revisionAccount } from './revision-adapters/accounts.js';
import { revisionWorkspace } from './revision-adapters/workspaces.js';
import { sqliteTransactionRevisions } from './revision-adapters/transactions.js';
import { sqliteCounterpartyWrites } from './revision-adapters/counterparty-writes.js';
import { sqliteTaxonomyWrites } from './revision-adapters/taxonomy-writes.js';
export interface SqliteRevisionOptions extends Omit<RevisionOptions, 'store'> {
  readonly connection: SqliteConnection;
}
export function createSqliteRevisionService(options: SqliteRevisionOptions) {
  if (
    !options?.connection ||
    typeof options.connection.exec !== 'function' ||
    typeof options.connection.rows !== 'function' ||
    typeof options.connection.run !== 'function'
  )
    throw new RevisionError('CONFIGURATION_INVALID');
  const db = options.connection;
  let tail: Promise<unknown> = Promise.resolve(),
    closed = false,
    poisoned = false;
  const store = {
    transaction<T>(
      scope: RevisionScope,
      operation: (tx: RevisionTransaction) => Promise<T>,
    ): Promise<T> {
      const work = tail.then(async () => {
        if (poisoned) throw new RevisionError('DATA_ACCESS_FAILED');
        let active = false;
        try {
          await db.exec(
            'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
          );
          if (
            String((await db.rows('PRAGMA foreign_keys'))[0]?.foreign_keys) !==
            '1'
          )
            throw new RevisionError('CONFIGURATION_INVALID');
          await db.exec('BEGIN IMMEDIATE');
          active = true;
          const result = await operation(
            Object.freeze({
              ...sqliteTransactionRevisions(db, scope),
              counterpartyReferences: (ids: readonly string[]) =>
                sqliteCounterpartyWrites(db, scope).references(ids),
              taxonomyCatalog: () => sqliteTaxonomyWrites(db, scope).catalog(),
              account: (id: string) => revisionAccount(db, scope, id),
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
  const service = createRevisionService({ ...options, store }),
    pending = new Set<Promise<unknown>>();
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new RevisionError('CLOSED'));
    const work = operation();
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  return Object.freeze({
    apply: (...args: Parameters<typeof service.apply>) =>
      track(() => service.apply(...args)),
    applyGuarded: (...args: Parameters<typeof service.applyGuarded>) =>
      track(() => service.applyGuarded(...args)),
    applyComposite: (...args: Parameters<typeof service.applyComposite>) =>
      track(() => service.applyComposite(...args)),
    revert: (...args: Parameters<typeof service.revert>) =>
      track(() => service.revert(...args)),
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
      await tail;
    },
  });
}
