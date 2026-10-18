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
export async function categoryWorkspace(
  db: SqliteConnection,
  workspace: string,
) {
  const row = (
    await db.rows('SELECT storage_mode,purpose FROM workspace WHERE id=?', [
      workspace,
    ])
  )[0];
  if (!row) return null;
  if (
    (row.storage_mode !== 'LOCAL' && row.storage_mode !== 'CLOUD') ||
    (row.purpose !== 'PERSONAL' &&
      row.purpose !== 'BUSINESS' &&
      row.purpose !== 'OTHER')
  )
    throw new RevisionError('INVALID_SNAPSHOT');
  return Object.freeze({
    storage_mode: row.storage_mode,
    purpose: row.purpose,
  });
}
