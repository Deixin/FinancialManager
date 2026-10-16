import { AsyncLocalStorage } from 'node:async_hooks';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class WorkspaceRequestError extends Error {
  constructor(code, sqlState) {
    super(code);
    this.name = 'WorkspaceRequestError';
    this.code = code;
    if (/^[0-9A-Z]{5}$/.test(sqlState ?? '')) this.sqlState = sqlState;
  }
}

export function createWorkspaceRunner(pool) {
  const scope = new AsyncLocalStorage();
  return async function withWorkspace(context, operation) {
    if (
      !context ||
      typeof context.workspaceId !== 'string' ||
      typeof context.userId !== 'string' ||
      !uuid.test(context.workspaceId) ||
      !uuid.test(context.userId)
    )
      throw new WorkspaceRequestError('CONTEXT_INVALID');
    if (scope.getStore())
      throw new WorkspaceRequestError('NESTED_CONTEXT_REJECTED');
    return await scope.run(true, async () => {
      let client;
      let transaction = false;
      let active = false;
      let discard = false;
      try {
        client = await pool.connect();
        // Restore defaults even if a previous trusted repository used SET SESSION.
        await client.query('RESET ALL; RESET ROLE');
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        transaction = true;
        await client.query(
          "SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '10s'; SET LOCAL row_security = on",
        );
        await client.query(
          "SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)",
          [context.workspaceId, context.userId],
        );
        const membership = await client.query(
          'SELECT 1 FROM us004.membership WHERE workspace_id = $1 AND user_id = $2 AND active',
          [context.workspaceId, context.userId],
        );
        if (membership.rowCount !== 1)
          throw new WorkspaceRequestError('WORKSPACE_FORBIDDEN');
        active = true;
        // This port belongs to trusted server code, never to an HTTP SQL endpoint.
        const query = (...args) => {
          if (!active) throw new WorkspaceRequestError('TRANSACTION_CLOSED');
          return client.query(...args);
        };
        const result = await operation(Object.freeze({ query }));
        active = false;
        await client.query('COMMIT');
        transaction = false;
        return result;
      } catch (error) {
        active = false;
        if (client && transaction) {
          try {
            await client.query('ROLLBACK');
          } catch {
            discard = true;
          }
        }
        if (error instanceof WorkspaceRequestError) throw error;
        // PostgreSQL errors may contain row values, SQL or credentials. Do not
        // attach the original error/cause or echo its message.
        throw new WorkspaceRequestError('DB_REQUEST_REJECTED', error?.code);
      } finally {
        active = false;
        if (client) {
          if (!discard) {
            try {
              await client.query('RESET ALL; RESET ROLE');
            } catch {
              discard = true;
            }
          }
          // A cleanup failure after a confirmed commit must not imply that the
          // committed mutation failed. Destroy the connection instead.
          client.release(discard);
        }
      }
    });
  };
}
