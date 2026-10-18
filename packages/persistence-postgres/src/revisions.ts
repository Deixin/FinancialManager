import { Kysely, PostgresDialect, sql } from 'kysely';
import { resourceId } from '@financial-manager/contracts';
import {
  createRevisionService,
  RevisionError,
} from '@financial-manager/finance-ports/revisions';
import type {
  RevisionOptions,
  RevisionScope,
  RevisionTransaction,
} from '@financial-manager/finance-ports/revisions';
import type {
  AccountsTables,
  WorkspaceTables,
  WriteTransactionsTables,
} from './internal/database.js';
import { guardedPool } from './internal/driver.js';
import type { TrustedPostgresPool } from './internal/driver.js';
import { ReadGuard } from './internal/scope.js';
import { activeDataUnit } from './internal/unit-scope.js';
import { createAccountsRepository } from './modules/accounts.js';
import { revisionWorkspace } from './modules/workspaces.js';
import { postgresTransactionRevisions } from './modules/transaction-writes.js';
export interface PostgresRevisionOptions extends Omit<
  RevisionOptions,
  'store'
> {
  readonly pool: TrustedPostgresPool;
  readonly expected_role: string;
  readonly owns_pool?: boolean;
}
export function createPostgresRevisionService(
  options: PostgresRevisionOptions,
) {
  if (
    !options?.pool ||
    typeof options.pool.connect !== 'function' ||
    typeof options.pool.end !== 'function' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(options.expected_role) ||
    (options.owns_pool !== undefined && typeof options.owns_pool !== 'boolean')
  )
    throw new RevisionError('CONFIGURATION_INVALID');
  const expected = options.expected_role,
    db = new Kysely<WriteTransactionsTables>({
      dialect: new PostgresDialect({
        pool: guardedPool(options.pool, options.owns_pool ?? false),
      }),
    }).withSchema('fm');
  let closed = false,
    closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  const store = {
    transaction<T>(
      scope: RevisionScope,
      operation: (tx: RevisionTransaction) => Promise<T>,
    ): Promise<T> {
      if (activeDataUnit.getStore())
        return Promise.reject(new RevisionError('NESTED_UNIT'));
      return activeDataUnit.run(true, () =>
        db
          .transaction()
          .setIsolationLevel('read committed')
          .setAccessMode('read write')
          .execute(async (trx) => {
            const role = (
              await sql<{
                login: string;
                role_name: string;
                rolsuper: boolean;
                rolbypassrls: boolean;
                migration_owner: boolean;
              }>`SELECT session_user::text AS login,current_user::text AS role_name,r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'fm_schema_owner','MEMBER') AS migration_owner FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`.execute(
                trx,
              )
            ).rows[0];
            if (
              !role ||
              role.login !== expected ||
              role.role_name !== expected ||
              role.rolsuper ||
              role.rolbypassrls ||
              role.migration_owner
            )
              throw new RevisionError('CONFIGURATION_INVALID');
            await sql`SELECT set_config('app.workspace_id',${scope.workspace_id},true),set_config('TimeZone','UTC',true),set_config('DateStyle','ISO, YMD',true)`.execute(
              trx,
            );
            await sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.workspace_id},6026))`.execute(
              trx,
            );
            const guard = new ReadGuard({
                workspace_id: resourceId(scope.workspace_id),
                account_ids:
                  scope.account_ids === null
                    ? null
                    : scope.account_ids.map(resourceId),
                permissions: ['accounts:read'],
              }),
              accounts = createAccountsRepository(
                trx as unknown as Kysely<AccountsTables>,
                guard,
              );
            try {
              const result = await operation(
                Object.freeze({
                  ...postgresTransactionRevisions(trx, scope),
                  account: (id: string) => accounts.get(id),
                  workspaceMode: () =>
                    revisionWorkspace(
                      trx as unknown as Kysely<WorkspaceTables>,
                      scope.workspace_id,
                    ),
                }),
              );
              await guard.finish();
              return result;
            } catch (error) {
              guard.active = false;
              await Promise.allSettled([...guard.pending]);
              throw error;
            }
          }),
      );
    },
  };
  const service = createRevisionService({ ...options, store });
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
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          await Promise.allSettled([...pending]);
          try {
            await db.destroy();
          } catch {
            throw new RevisionError('DATA_ACCESS_FAILED');
          }
        })();
      }
      return closing;
    },
  });
}
