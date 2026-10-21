import type { SqliteConnection } from '../index.js';
export async function sqliteImportAccount(
  db: SqliteConnection,
  w: string,
  id: string,
) {
  const r = (
    await db.rows(
      'SELECT id,workspace_id,status FROM financial_account WHERE workspace_id=? AND id=?',
      [w, id],
    )
  )[0];
  if (!r) return null;
  if (
    typeof r.id !== 'string' ||
    typeof r.workspace_id !== 'string' ||
    (r.status !== 'ACTIVE' && r.status !== 'ARCHIVED')
  )
    throw Error('DATA_ACCESS_FAILED');
  return Object.freeze({
    id: r.id,
    workspace_id: r.workspace_id,
    status: r.status,
  });
}
