import type { Kysely } from 'kysely';
import type { WriteTransactionsTables } from '../internal/database.js';
import { instantColumn } from '../internal/projection.js';
import {
  RevisionError,
  decodeRevisionState,
} from '@financial-manager/domain/revisions';
import type { RevisionPlan } from '@financial-manager/domain/revisions';
import type {
  RevisionScope,
  RevisionRecord,
  RevisionGroup,
} from '@financial-manager/finance-ports/revisions';
export function postgresTransactionRevisions(
  db: Kysely<WriteTransactionsTables>,
  scope: RevisionScope,
) {
  return Object.freeze({
    async createGroup(
      input: Readonly<{
        id: string;
        group_type: 'TRANSFER';
        created_at: string;
      }>,
    ) {
      await db
        .insertInto('transaction_group')
        .values({ ...input, workspace_id: scope.workspace_id, state: 'ACTIVE' })
        .execute();
    },
    async load(id: string) {
      let query = db
        .selectFrom('financial_transaction')
        .select([
          'id',
          'workspace_id',
          'account_id',
          'group_id',
          'counterparty_id',
          'economic_kind',
          'original_description',
          'display_name',
          'origin_kind',
        ])
        .select((eb) => [
          eb.cast<string>('financial_date', 'text').as('financial_date'),
          eb
            .cast<string>('account_amount_minor', 'text')
            .as('account_amount_minor'),
          eb.cast<string>('version', 'text').as('version'),
          instantColumn(eb, 'created_at').as('created_at'),
          instantColumn(eb, 'updated_at').as('updated_at'),
          instantColumn(eb, 'deleted_at').as('deleted_at'),
        ])
        .where('workspace_id', '=', scope.workspace_id)
        .where('id', '=', id)
        .forUpdate();
      if (scope.account_ids !== null)
        query = scope.account_ids.length
          ? query.where('account_id', 'in', scope.account_ids)
          : query.where((eb) => eb.val(false));
      const row = await query.executeTakeFirst();
      if (!row) return null;
      const allocations = await db
        .selectFrom('transaction_allocation as a')
        .innerJoin('financial_transaction as t', (join) =>
          join
            .onRef('t.workspace_id', '=', 'a.workspace_id')
            .onRef('t.id', '=', 'a.transaction_id'),
        )
        .select(['a.id', 'a.category_id', 'a.subcategory_id', 'a.note'])
        .select((eb) =>
          eb.cast<string>('a.amount_minor', 'text').as('amount_minor'),
        )
        .where('a.workspace_id', '=', scope.workspace_id)
        .where('t.workspace_id', '=', scope.workspace_id)
        .where('a.transaction_id', '=', id)
        .orderBy('a.id')
        .execute();
      const tags = await db
        .selectFrom('transaction_tag as a')
        .innerJoin('financial_transaction as t', (join) =>
          join
            .onRef('t.workspace_id', '=', 'a.workspace_id')
            .onRef('t.id', '=', 'a.transaction_id'),
        )
        .select('a.tag_id')
        .where('a.workspace_id', '=', scope.workspace_id)
        .where('t.workspace_id', '=', scope.workspace_id)
        .where('a.transaction_id', '=', id)
        .orderBy('a.tag_id')
        .execute();
      return decodeRevisionState({
        workspace_id: row.workspace_id,
        id: row.id,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        content: {
          account_id: row.account_id,
          group_id: row.group_id,
          counterparty_id: row.counterparty_id,
          financial_date: row.financial_date,
          account_amount_minor: row.account_amount_minor,
          economic_kind: row.economic_kind,
          original_description: row.original_description,
          display_name: row.display_name,
          origin_kind: row.origin_kind,
          deleted: row.deleted_at !== null,
          allocations,
          tag_ids: tags.map((tag) => tag.tag_id),
        },
      });
    },
    async group(id: string): Promise<RevisionGroup | null> {
      const row = await db
        .selectFrom('transaction_group')
        .select(['id', 'group_type', 'state'])
        .where('workspace_id', '=', scope.workspace_id)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return null;
      const members = await db
        .selectFrom('financial_transaction')
        .select(['id', 'account_id'])
        .where('workspace_id', '=', scope.workspace_id)
        .where('group_id', '=', id)
        .orderBy('id')
        .forUpdate()
        .execute();
      return Object.freeze({
        ...row,
        members: Object.freeze(members.map((row) => Object.freeze(row))),
      });
    },
    async history(id: string, version: string) {
      const row = await db
        .selectFrom('transaction_revision as a')
        .innerJoin('financial_transaction as t', (join) =>
          join
            .onRef('t.workspace_id', '=', 'a.workspace_id')
            .onRef('t.id', '=', 'a.transaction_id'),
        )
        .select((eb) => eb.cast<string>('a.snapshot', 'text').as('snapshot'))
        .where('a.workspace_id', '=', scope.workspace_id)
        .where('t.workspace_id', '=', scope.workspace_id)
        .where('a.transaction_id', '=', id)
        .where('a.version', '=', version)
        .executeTakeFirst();
      if (!row) return null;
      try {
        return JSON.parse(row.snapshot);
      } catch {
        throw new RevisionError('INVALID_SNAPSHOT');
      }
    },
    async save(plan: RevisionPlan, record: RevisionRecord) {
      const after = plan.after,
        c = after.content,
        values = {
          account_id: c.account_id,
          group_id: c.group_id,
          counterparty_id: c.counterparty_id,
          financial_date: c.financial_date,
          account_amount_minor: c.account_amount_minor,
          economic_kind: c.economic_kind,
          original_description: c.original_description,
          display_name: c.display_name,
          origin_kind: c.origin_kind,
          version: after.version,
          deleted_at: after.deleted_at,
          updated_at: after.updated_at,
        };
      if (!plan.before)
        await db
          .insertInto('financial_transaction')
          .values({
            ...values,
            id: after.id,
            workspace_id: scope.workspace_id,
            created_at: after.created_at,
          })
          .execute();
      else {
        const row = await db
          .updateTable('financial_transaction')
          .set(values)
          .where('workspace_id', '=', scope.workspace_id)
          .where('id', '=', after.id)
          .where('version', '=', plan.before.version)
          .returning('id')
          .executeTakeFirst();
        if (!row) throw new RevisionError('VERSION_CONFLICT');
      }
      await db
        .deleteFrom('transaction_allocation')
        .where('workspace_id', '=', scope.workspace_id)
        .where('transaction_id', '=', after.id)
        .execute();
      if (c.allocations.length)
        await db
          .insertInto('transaction_allocation')
          .values(
            c.allocations.map((row) => ({
              ...row,
              workspace_id: scope.workspace_id,
              transaction_id: after.id,
            })),
          )
          .execute();
      await db
        .deleteFrom('transaction_tag')
        .where('workspace_id', '=', scope.workspace_id)
        .where('transaction_id', '=', after.id)
        .execute();
      if (c.tag_ids.length)
        await db
          .insertInto('transaction_tag')
          .values(
            c.tag_ids.map((tag) => ({
              workspace_id: scope.workspace_id,
              transaction_id: after.id,
              tag_id: tag,
            })),
          )
          .execute();
      await db
        .insertInto('transaction_revision')
        .values({ ...record, snapshot: JSON.stringify(record.snapshot) })
        .execute();
    },
  });
}
