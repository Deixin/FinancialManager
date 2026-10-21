import { ImportCentralError } from '@financial-manager/domain/imports';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createImportCentralService } from '@financial-manager/finance-ports/imports';
import type { ImportScope as ImportCentralWriteScope } from '@financial-manager/finance-ports/imports';
import type {
  ImportCentralOptions,
  ImportTransaction,
} from '@financial-manager/finance-ports/imports';
import type {
  WorkspaceTables,
  AccountsTables,
  TransactionsTables,
  WriteImportsTables,
} from './internal/database.js';
import { guardedPool } from './internal/driver.js';
import type { TrustedPostgresPool } from './internal/driver.js';
import { activeDataUnit } from './internal/unit-scope.js';
import { postgresImportAccount } from './modules/import-account-projections.js';
import { postgresImportTransactionAccounts } from './modules/import-transaction-projections.js';
import { postgresImportLedger } from './modules/import-reads-writes.js';
import { categoryWorkspace } from './modules/workspaces.js';
export interface PostgresImportCentralOptions extends Omit<
  ImportCentralOptions,
  'store'
> {
  readonly pool: TrustedPostgresPool;
  readonly expected_role: string;
  readonly owns_pool?: boolean;
}
export function createPostgresImportCentralService(
  options: PostgresImportCentralOptions,
) {
  if (
    !options?.pool ||
    typeof options.pool.connect !== 'function' ||
    typeof options.pool.end !== 'function' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(options.expected_role) ||
    (options.owns_pool !== undefined && typeof options.owns_pool !== 'boolean')
  )
    throw new ImportCentralError('CONFIGURATION_INVALID');
  const expected = options.expected_role,
    db = new Kysely<WriteImportsTables>({
      dialect: new PostgresDialect({
        pool: guardedPool(options.pool, options.owns_pool ?? false),
      }),
    }).withSchema('fm');
  let closed = false,
    closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  const store = {
    transaction<T>(
      scope: ImportCentralWriteScope,
      mode: 'READ' | 'WRITE',
      operation: (tx: ImportTransaction) => Promise<T>,
    ): Promise<T> {
      if (activeDataUnit.getStore())
        return Promise.reject(new ImportCentralError('NESTED_UNIT'));
      return activeDataUnit.run(true, () =>
        db
          .transaction()
          .setIsolationLevel(
            mode === 'READ' ? 'repeatable read' : 'read committed',
          )
          .setAccessMode(mode === 'READ' ? 'read only' : 'read write')
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
              throw new ImportCentralError('CONFIGURATION_INVALID');
            await sql`SELECT set_config('app.workspace_id',${scope.workspace_id},true),set_config('TimeZone','UTC',true),set_config('DateStyle','ISO, YMD',true)`.execute(
              trx,
            );
            if (mode === 'WRITE')
              await sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.workspace_id},6027))`.execute(
                trx,
              );
            return operation(
              Object.freeze({
                ...postgresImportLedger(trx, scope, mode === 'WRITE'),
                account: (id: string) =>
                  postgresImportAccount(
                    trx as unknown as Kysely<AccountsTables>,
                    scope.workspace_id,
                    id,
                    mode === 'WRITE',
                  ),
                transactionAccounts: (ids: readonly string[]) =>
                  postgresImportTransactionAccounts(
                    trx as unknown as Kysely<TransactionsTables>,
                    scope.workspace_id,
                    ids,
                  ),
                workspace: () =>
                  categoryWorkspace(
                    trx as unknown as Kysely<WorkspaceTables>,
                    scope.workspace_id,
                  ),
              }),
            );
          }),
      );
    },
  };
  const service = createImportCentralService({ ...options, store });
  function track<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new ImportCentralError('CLOSED'));
    if (activeDataUnit.getStore())
      return Promise.reject(new ImportCentralError('NESTED_UNIT'));
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
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          await Promise.allSettled([...pending]);
          try {
            await db.destroy();
          } catch {
            throw new ImportCentralError('DATA_ACCESS_FAILED');
          }
        })();
      }
      return closing;
    },
  });
}
