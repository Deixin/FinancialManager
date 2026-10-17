import { createPostgresRevisionService } from '@financial-manager/persistence-postgres/revisions';
import type { PostgresRevisionOptions } from '@financial-manager/persistence-postgres/revisions';
import { createWorkerIdentity } from './identity.js';
export function createWorkerRevisionModel(
  options: Omit<PostgresRevisionOptions, 'identity'>,
) {
  return createPostgresRevisionService({
    ...options,
    identity: createWorkerIdentity(),
  });
}
