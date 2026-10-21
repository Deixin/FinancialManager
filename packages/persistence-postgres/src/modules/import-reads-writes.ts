import type { Kysely, Selectable } from 'kysely';
import type { WriteImportsTables } from '../internal/database.js';
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
  ImportQuery,
} from '@financial-manager/domain/imports';
import type { ImportScope } from '@financial-manager/finance-ports/imports';
function instant(raw: unknown) {
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'string') return raw;
  throw new ImportCentralError('INVALID_IMPORT_STATE');
}
export function postgresImportLedger(
  db: Kysely<WriteImportsTables>,
  scope: ImportScope,
  write: boolean,
) {
  const w = scope.workspace_id;
  const batch = (r: Selectable<WriteImportsTables['import_batch']>) =>
    captureImportBatch(
      {
        ...r,
        created_at: instant(r.created_at),
        committed_at: r.committed_at === null ? null : instant(r.committed_at),
      },
      w,
    );
  return Object.freeze({
    async candidates(q: ImportQuery) {
      if (scope.account_ids?.length === 0) return Object.freeze([]);
      let query = db
        .selectFrom('import_batch')
        .selectAll()
        .where('workspace_id', '=', w);
      if (q.statuses.length) query = query.where('status', 'in', q.statuses);
      if (q.account_id !== null)
        query = query.where('target_account_id', '=', q.account_id);
      if (scope.account_ids !== null)
        query = query.where('target_account_id', 'in', scope.account_ids);
      if (q.cursor) {
        const c = q.cursor,
          at = new Date(c.created_at);
        query = query.where((eb) =>
          eb.or([
            eb('created_at', '<', at),
            eb.and([eb('created_at', '=', at), eb('id', '<', c.id)]),
          ]),
        );
      }
      return Object.freeze(
        (
          await query
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .limit(q.limit + 1)
            .execute()
        ).map(batch),
      );
    },
    async batch(id: string) {
      let q = db
        .selectFrom('import_batch')
        .selectAll()
        .where('workspace_id', '=', w)
        .where('id', '=', id);
      if (write) q = q.forUpdate();
      const r = await q.executeTakeFirst();
      return r ? batch(r) : null;
    },
    async sources(id: string) {
      return Object.freeze(
        (
          await db
            .selectFrom('import_source as s')
            .innerJoin('import_batch as b', (join) =>
              join
                .onRef('b.id', '=', 's.batch_id')
                .onRef('b.workspace_id', '=', 's.workspace_id'),
            )
            .select([
              's.id',
              's.workspace_id',
              's.batch_id',
              's.file_name',
              's.file_hash',
              's.format',
              's.parser_name',
              's.parser_version',
              's.detected_currency',
              's.imported_at',
            ])
            .select((eb) => [
              eb
                .cast<string | null>('s.period_start', 'text')
                .as('period_start'),
              eb.cast<string | null>('s.period_end', 'text').as('period_end'),
            ])
            .where('b.workspace_id', '=', w)
            .where('b.id', '=', id)
            .orderBy('s.id')
            .limit(17)
            .execute()
        ).map((r) =>
          captureImportSource(
            {
              ...r,
              imported_at: instant(r.imported_at),
            },
            w,
            id,
          ),
        ),
      );
    },
    async counts(id: string) {
      const rows = await db
        .selectFrom('import_item as i')
        .innerJoin('import_batch as b', (join) =>
          join
            .onRef('b.id', '=', 'i.batch_id')
            .onRef('b.workspace_id', '=', 'i.workspace_id'),
        )
        .select(['i.disposition as kind', db.fn.countAll<string>().as('n')])
        .where('b.workspace_id', '=', w)
        .where('b.id', '=', id)
        .groupBy('i.disposition')
        .execute();
      const results = await db
        .selectFrom('import_effect as e')
        .innerJoin('import_batch as b', (join) =>
          join
            .onRef('b.id', '=', 'e.batch_id')
            .onRef('b.workspace_id', '=', 'e.workspace_id'),
        )
        .select(['e.action as kind', db.fn.countAll<string>().as('n')])
        .where('b.workspace_id', '=', w)
        .where('b.id', '=', id)
        .groupBy('e.action')
        .execute();
      const items = Object.fromEntries(itemDispositions.map((k) => [k, '0'])),
        effects = Object.fromEntries(effectActions.map((k) => [k, '0']));
      for (const r of rows) {
        if (!Object.hasOwn(items, r.kind))
          throw new ImportCentralError('INVALID_IMPORT_STATE');
        items[r.kind] = importCount(r.n);
      }
      for (const r of results) {
        if (!Object.hasOwn(effects, r.kind))
          throw new ImportCentralError('INVALID_IMPORT_STATE');
        effects[r.kind] = importCount(r.n);
      }
      return captureImportCounts({
        items,
        effects,
        total_items: Object.values(items)
          .reduce((a, n) => a + BigInt(n), 0n)
          .toString(),
        total_effects: Object.values(effects)
          .reduce((a, n) => a + BigInt(n), 0n)
          .toString(),
      });
    },
    async effects(id: string, after: string | null, limit: number) {
      let q = db
        .selectFrom('import_effect as e')
        .innerJoin('import_batch as b', (join) =>
          join
            .onRef('b.id', '=', 'e.batch_id')
            .onRef('b.workspace_id', '=', 'e.workspace_id'),
        )
        .selectAll('e')
        .where('b.workspace_id', '=', w)
        .where('b.id', '=', id);
      if (after !== null) q = q.where('e.id', '>', after);
      return Object.freeze(
        (await q.orderBy('e.id').limit(limit).execute()).map((r) =>
          captureImportEffect(
            { ...r, created_at: instant(r.created_at) },
            w,
            id,
          ),
        ),
      );
    },
    async effectTransactionIds(id: string) {
      return Object.freeze(
        (
          await db
            .selectFrom('import_effect as e')
            .innerJoin('import_batch as b', (join) =>
              join
                .onRef('b.id', '=', 'e.batch_id')
                .onRef('b.workspace_id', '=', 'e.workspace_id'),
            )
            .select('e.transaction_id')
            .distinct()
            .where('b.workspace_id', '=', w)
            .where('b.id', '=', id)
            .orderBy('e.transaction_id')
            .limit(10001)
            .execute()
        ).map((r) => r.transaction_id),
      );
    },
    async insert(b: ImportBatch) {
      if (b.workspace_id !== w)
        throw new ImportCentralError('DATA_ACCESS_FAILED');
      const rows = await db
        .insertInto('import_batch')
        .values(b)
        .returning('id')
        .execute();
      if (rows.length !== 1 || rows[0]?.id !== b.id)
        throw new ImportCentralError('DATA_ACCESS_FAILED');
    },
  });
}
