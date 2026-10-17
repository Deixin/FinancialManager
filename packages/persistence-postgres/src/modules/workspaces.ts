import type { Kysely } from 'kysely';
import type { WorkspaceTables } from '../internal/database.js';
export async function revisionWorkspace(
  db: Kysely<WorkspaceTables>,
  workspace: string,
) {
  const row = await db
    .selectFrom('workspace')
    .select('storage_mode')
    .where('id', '=', workspace)
    .executeTakeFirst();
  return row?.storage_mode ?? null;
}
