import type { SqliteConnection } from '../index.js';
import { RevisionError } from '@financial-manager/domain/revisions';
export async function revisionWorkspace(
  db: SqliteConnection,
  workspace: string,
): Promise<'LOCAL' | 'CLOUD' | null> {
  const row = (
    await db.rows('SELECT storage_mode FROM workspace WHERE id=?', [workspace])
  )[0];
  if (!row) return null;
  if (row.storage_mode !== 'LOCAL' && row.storage_mode !== 'CLOUD')
    throw new RevisionError('INVALID_SNAPSHOT');
  return row.storage_mode;
}
