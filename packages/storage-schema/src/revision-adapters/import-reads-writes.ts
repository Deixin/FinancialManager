import type { SqliteConnection } from '../index.js';
import {
  captureImportBatch,
  captureImportSource,
  captureImportEffect,
  captureImportCounts,
  importCount,
  itemDispositions,
  effectActions,
  ImportCentralError,
} from '@financial-manager/domain/imports';
import type {
  ImportBatch,
  ImportCounts,
  ImportQuery,
} from '@financial-manager/domain/imports';
import type { ImportScope } from '@financial-manager/finance-ports/imports';
export function sqliteImportLedger(db: SqliteConnection, scope: ImportScope) {
  const w = scope.workspace_id;
  const makeCounts = (
    items: readonly Readonly<Record<string, string | number | null>>[],
    effects: readonly Readonly<Record<string, string | number | null>>[],
  ): ImportCounts => {
    const i = Object.fromEntries(itemDispositions.map((k) => [k, '0'])),
      e = Object.fromEntries(effectActions.map((k) => [k, '0']));
    for (const r of items) {
      if (typeof r.kind !== 'string' || !Object.hasOwn(i, r.kind))
        throw new ImportCentralError('INVALID_IMPORT_STATE');
      i[r.kind] = importCount(r.n);
    }
    for (const r of effects) {
      if (typeof r.kind !== 'string' || !Object.hasOwn(e, r.kind))
        throw new ImportCentralError('INVALID_IMPORT_STATE');
      e[r.kind] = importCount(r.n);
    }
    return captureImportCounts({
      items: i,
      effects: e,
      total_items: Object.values(i)
        .reduce((a, n) => a + BigInt(n), 0n)
        .toString(),
      total_effects: Object.values(e)
        .reduce((a, n) => a + BigInt(n), 0n)
        .toString(),
    });
  };
  return Object.freeze({
    async candidates(q: ImportQuery) {
      if (scope.account_ids?.length === 0) return Object.freeze([]);
      const states = JSON.stringify(q.statuses),
        accounts = JSON.stringify(scope.account_ids ?? []),
        at = q.cursor?.created_at ?? null,
        id = q.cursor?.id ?? null;
      const rows = await db.rows(
        'SELECT b.id,b.workspace_id,b.target_account_id,b.batch_kind,b.status,b.reverses_batch_id,b.created_by_member_id,b.created_at,b.committed_at,CAST(b.version AS TEXT) AS version,b.failure_code FROM import_batch b WHERE b.workspace_id=? AND (? IS NULL OR b.target_account_id=?) AND (json_array_length(?)=0 OR b.status IN (SELECT value FROM json_each(?))) AND (?=1 OR b.target_account_id IN (SELECT value FROM json_each(?))) AND (? IS NULL OR b.created_at<? OR (b.created_at=? AND b.id<?)) ORDER BY b.created_at DESC,b.id DESC LIMIT ?',
        [
          w,
          q.account_id,
          q.account_id,
          states,
          states,
          scope.account_ids === null ? 1 : 0,
          accounts,
          at,
          at,
          at,
          id,
          q.limit + 1,
        ],
      );
      return Object.freeze(rows.map((r) => captureImportBatch(r, w)));
    },
    async batch(id: string) {
      const rows = await db.rows(
        'SELECT id,workspace_id,target_account_id,batch_kind,status,reverses_batch_id,created_by_member_id,created_at,committed_at,CAST(version AS TEXT) AS version,failure_code FROM import_batch WHERE workspace_id=? AND id=?',
        [w, id],
      );
      return rows[0] ? captureImportBatch(rows[0], w) : null;
    },
    async sources(id: string) {
      return Object.freeze(
        (
          await db.rows(
            'SELECT s.id,s.workspace_id,s.batch_id,s.file_name,s.file_hash,s.format,s.parser_name,s.parser_version,s.detected_currency,s.period_start,s.period_end,s.imported_at FROM import_source s INNER JOIN import_batch b ON b.id=s.batch_id AND b.workspace_id=s.workspace_id WHERE b.workspace_id=? AND b.id=? ORDER BY s.id LIMIT 17',
            [w, id],
          )
        ).map((r) => captureImportSource(r, w, id)),
      );
    },
    async counts(id: string) {
      const items = await db.rows(
        'SELECT i.disposition AS kind,CAST(count(*) AS TEXT) AS n FROM import_item i INNER JOIN import_batch b ON b.id=i.batch_id AND b.workspace_id=i.workspace_id WHERE b.workspace_id=? AND b.id=? GROUP BY i.disposition',
        [w, id],
      );
      const effects = await db.rows(
        'SELECT e.action AS kind,CAST(count(*) AS TEXT) AS n FROM import_effect e INNER JOIN import_batch b ON b.id=e.batch_id AND b.workspace_id=e.workspace_id WHERE b.workspace_id=? AND b.id=? GROUP BY e.action',
        [w, id],
      );
      return makeCounts(items, effects);
    },
    async effects(id: string, after: string | null, limit: number) {
      return Object.freeze(
        (
          await db.rows(
            'SELECT e.id,e.workspace_id,e.batch_id,e.import_item_id,e.transaction_id,e.action,e.before_revision_id,e.after_revision_id,e.created_at FROM import_effect e INNER JOIN import_batch b ON b.id=e.batch_id AND b.workspace_id=e.workspace_id WHERE b.workspace_id=? AND b.id=? AND (? IS NULL OR e.id>?) ORDER BY e.id LIMIT ?',
            [w, id, after, after, limit],
          )
        ).map((r) => captureImportEffect(r, w, id)),
      );
    },
    async effectTransactionIds(id: string) {
      return Object.freeze(
        (
          await db.rows(
            'SELECT DISTINCT e.transaction_id FROM import_effect e INNER JOIN import_batch b ON b.id=e.batch_id AND b.workspace_id=e.workspace_id WHERE b.workspace_id=? AND b.id=? ORDER BY e.transaction_id LIMIT 10001',
            [w, id],
          )
        ).map((r) => {
          if (typeof r.transaction_id !== 'string')
            throw new ImportCentralError('INVALID_IMPORT_STATE');
          return r.transaction_id;
        }),
      );
    },
    async insert(b: ImportBatch) {
      if (b.workspace_id !== w)
        throw new ImportCentralError('DATA_ACCESS_FAILED');
      const rows = await db.rows(
        'INSERT INTO import_batch(id,workspace_id,target_account_id,batch_kind,status,reverses_batch_id,created_by_member_id,created_at,committed_at,version,failure_code) VALUES(?,?,?,?,?,?,?,?,?,CAST(? AS INTEGER),?) RETURNING id',
        [
          b.id,
          w,
          b.target_account_id,
          b.batch_kind,
          b.status,
          b.reverses_batch_id,
          b.created_by_member_id,
          b.created_at,
          b.committed_at,
          b.version,
          b.failure_code,
        ],
      );
      if (rows.length !== 1 || rows[0]?.id !== b.id)
        throw new ImportCentralError('DATA_ACCESS_FAILED');
    },
  });
}
