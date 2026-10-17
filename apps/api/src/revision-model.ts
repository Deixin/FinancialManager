import { createPostgresRevisionService } from '@financial-manager/persistence-postgres/revisions';
import type { PostgresRevisionOptions } from '@financial-manager/persistence-postgres/revisions';
import { createApiIdentity } from './identity.js';
export function createApiRevisionModel(
  options: Omit<PostgresRevisionOptions, 'identity'>,
) {
  return createPostgresRevisionService({
    ...options,
    identity: createApiIdentity(),
  });
}
