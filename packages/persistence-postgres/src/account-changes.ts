import { Kysely, PostgresDialect, sql } from 'kysely';
import {
  createAccountWriteService,
  AccountChangeError,
} from '@financial-manager/finance-ports';
import type {
  AccountWriteOptions,
  AccountWriteScope,
  AccountWriteTransaction,
} from '@financial-manager/finance-ports';
import type {
  WorkspaceTables,
  WriteAccountsTables,
} from './internal/database.js';
import { guardedPool } from './internal/driver.js';
import type { TrustedPostgresPool } from './internal/driver.js';
import { activeDataUnit } from './internal/unit-scope.js';
import { postgresAccountWrites } from './modules/account-writes.js';
import { revisionWorkspace } from './modules/workspaces.js';
export interface PostgresAccountOptions extends Omit<
  AccountWriteOptions,
  'store'
> {
  readonly pool: TrustedPostgresPool;
  readonly expected_role: string;
  readonly owns_pool?: boolean;
}
export function createPostgresAccountService(options: PostgresAccountOptions) {
  if (
    !options?.pool ||
    typeof options.pool.connect !== 'function' ||
    typeof options.pool.end !== 'function' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(options.expected_role) ||
    (options.owns_pool !== undefined && typeof options.owns_pool !== 'boolean')
  )
    throw new AccountChangeError('CONFIGURATION_INVALID');
  const expected = options.expected_role,
    db = new Kysely<WriteAccountsTables>({
      dialect: new PostgresDialect({
        pool: guardedPool(options.pool, options.owns_pool ?? false),
      }),
    }).withSchema('fm');
  let closed = false,
    closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  const store = {
    transaction<T>(
      scope: AccountWriteScope,
      operation: (tx: AccountWriteTransaction) => Promise<T>,
    ): Promise<T> {
      if (activeDataUnit.getStore())
        return Promise.reject(new AccountChangeError('NESTED_UNIT'));
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
              throw new AccountChangeError('CONFIGURATION_INVALID');
            await sql`SELECT set_config('app.workspace_id',${scope.workspace_id},true),set_config('TimeZone','UTC',true),set_config('DateStyle','ISO, YMD',true)`.execute(
              trx,
            );
            await sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.workspace_id},6026))`.execute(
              trx,
            );
            return operation(
              Object.freeze({
                ...postgresAccountWrites(trx, scope),
                workspaceMode: () =>
                  revisionWorkspace(
                    trx as unknown as Kysely<WorkspaceTables>,
                    scope.workspace_id,
                  ),
              }),
            );
          }),
      );
    },
  };
  const service = createAccountWriteService({ ...options, store });
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new AccountChangeError('CLOSED'));
    if (activeDataUnit.getStore())
      return Promise.reject(new AccountChangeError('NESTED_UNIT'));
    const work = operation();
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  }
  return Object.freeze({
    apply: (...args: Parameters<typeof service.apply>) =>
      track(() => service.apply(...args)),
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          await Promise.allSettled([...pending]);
          try {
            await db.destroy();
          } catch {
            throw new AccountChangeError('DATA_ACCESS_FAILED');
          }
        })();
      }
      return closing;
    },
  });
}
