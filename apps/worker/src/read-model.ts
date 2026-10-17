import { createPostgresReadUnit } from '@financial-manager/persistence-postgres';
import type { PostgresReadOptions } from '@financial-manager/persistence-postgres';
import { readAccountActivity } from '@financial-manager/finance-ports';
import type { ReadRequest } from '@financial-manager/finance-ports';
// Authorization is evaluated on every execution, including a resumed/queued job.
export function createWorkerReadModel(options: PostgresReadOptions) {
  const unit = createPostgresReadUnit(options);
  return Object.freeze({
    read: unit.read,
    close: unit.close,
    accountActivity: (
      request: ReadRequest,
      input: Parameters<typeof readAccountActivity>[2],
    ) => readAccountActivity(unit, request, input),
  });
}
