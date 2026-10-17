import { activeDataUnit } from './internal/unit-scope.js';
export { createPostgresAccountService } from './account-changes.js';
export type { PostgresAccountOptions } from './account-changes.js';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { DataAccessError } from '@financial-manager/finance-ports';
import type {
  AuthorizeRead,
  ReadRequest,
  ScopedReadPorts,
  WorkspaceReadUnit,
} from '@financial-manager/finance-ports';
import type {
  Database,
  AccountsTables,
  TransactionsTables,
} from './internal/database.js';
import { guardedPool } from './internal/driver.js';
import type { TrustedPostgresPool } from './internal/driver.js';
import {
  ReadGuard,
  authorizeContext,
  captureRequest,
} from './internal/scope.js';
import { createAccountsRepository } from './modules/accounts.js';
import { createTransactionsRepository } from './modules/transactions.js';
export type {
  TrustedPostgresPool,
  TrustedPostgresClient,
} from './internal/driver.js';
export interface PostgresReadOptions {
  readonly pool: TrustedPostgresPool;
  readonly authorize: AuthorizeRead;
  readonly expected_role: string;
  readonly owns_pool?: boolean;
  readonly snapshot?: boolean;
}
export interface PostgresReadUnit extends WorkspaceReadUnit {
  close(): Promise<void>;
}
const activeScope = activeDataUnit;
export function createPostgresReadUnit(
  options: PostgresReadOptions,
): PostgresReadUnit {
  if (
    !options ||
    typeof options.authorize !== 'function' ||
    !options.pool ||
    typeof options.pool.connect !== 'function' ||
    typeof options.pool.end !== 'function' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(options.expected_role) ||
    (options.owns_pool !== undefined &&
      typeof options.owns_pool !== 'boolean') ||
    (options.snapshot !== undefined && typeof options.snapshot !== 'boolean')
  )
    throw new DataAccessError('CONFIGURATION_INVALID');
  const authorize = options.authorize,
    expectedRole = options.expected_role,
    snapshot = options.snapshot === true;
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: guardedPool(options.pool, options.owns_pool ?? false),
    }),
  }).withSchema('fm');
  const running = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined;
  async function execute<T>(
    input: ReadRequest,
    operation: (ports: ScopedReadPorts) => Promise<T>,
  ): Promise<T> {
    try {
      if (closed) throw new DataAccessError('CLOSED');
      if (activeScope.getStore())
        throw new DataAccessError('NESTED_READ_SCOPE');
      if (typeof operation !== 'function')
        throw new DataAccessError('INVALID_INPUT');
      const request = captureRequest(input),
        context = await authorizeContext(request, authorize);
      if (closed) throw new DataAccessError('CLOSED');
      return await activeScope.run(true, () =>
        db
          .transaction()
          .setIsolationLevel(snapshot ? 'repeatable read' : 'read committed')
          .setAccessMode('read only')
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
              role.login !== expectedRole ||
              role.role_name !== expectedRole ||
              role.rolsuper ||
              role.rolbypassrls ||
              role.migration_owner
            )
              throw new DataAccessError('CONFIGURATION_INVALID');
            await sql`SELECT set_config('app.workspace_id',${context.workspace_id},true),set_config('TimeZone','UTC',true),set_config('DateStyle','ISO, YMD',true)`.execute(
              trx,
            );
            const guard = new ReadGuard(context);
            // The only table-capability narrowing in this adapter; modules cannot widen it.
            const ports: ScopedReadPorts = Object.freeze({
              accounts: createAccountsRepository(
                trx as unknown as Kysely<AccountsTables>,
                guard,
              ),
              transactions: createTransactionsRepository(
                trx as unknown as Kysely<TransactionsTables>,
                guard,
              ),
            });
            try {
              const result = await operation(ports);
              await guard.finish();
              return result;
            } catch (error) {
              guard.active = false;
              await Promise.allSettled([...guard.pending]);
              throw error;
            }
          }),
      );
    } catch (error) {
      throw error instanceof DataAccessError
        ? error
        : new DataAccessError('UNIT_OF_WORK_FAILED');
    }
  }
  return Object.freeze({
    snapshot_consistency: snapshot,
    read<T>(
      request: ReadRequest,
      operation: (ports: ScopedReadPorts) => Promise<T>,
    ) {
      const work = execute(request, operation);
      running.add(work);
      void work.finally(() => running.delete(work)).catch(() => {});
      return work;
    },
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          await Promise.allSettled([...running]);
          try {
            await db.destroy();
          } catch {
            throw new DataAccessError('DATA_ACCESS_FAILED');
          }
        })();
      }
      return closing;
    },
  });
}
