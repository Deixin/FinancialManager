import type { PostgresPool, PostgresPoolClient } from 'kysely';
import { DataAccessError } from '@financial-manager/finance-ports';
export interface TrustedPostgresClient extends Omit<
  PostgresPoolClient,
  'release'
> {
  release(discard?: boolean): void;
}
export interface TrustedPostgresPool extends Omit<PostgresPool, 'connect'> {
  connect(): Promise<TrustedPostgresClient>;
}
// Dedicated string-query adapter. No cursor/stream escapes the read scope.
export function guardedPool(
  pool: TrustedPostgresPool,
  ownsPool: boolean,
): PostgresPool {
  return {
    options: pool.options,
    async connect() {
      const client = await pool.connect();
      let poisoned = false,
        released = false;
      return new Proxy(client, {
        get(target, key) {
          if (key === 'query')
            return async (
              sql: unknown,
              parameters: readonly unknown[] = [],
            ) => {
              if (released || typeof sql !== 'string')
                throw new DataAccessError('SCOPE_CLOSED');
              try {
                return await target.query(sql, parameters);
              } catch (error) {
                poisoned = true;
                throw error;
              }
            };
          if (key === 'release')
            return () => {
              if (!released) {
                released = true;
                client.release(poisoned);
              }
            };
          return Reflect.get(target, key, target);
        },
      });
    },
    async end() {
      if (ownsPool) await pool.end();
    },
  };
}
