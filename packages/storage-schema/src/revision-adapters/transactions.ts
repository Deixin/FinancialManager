import type { SqliteConnection } from '../index.js';
import type {
  RevisionScope,
  RevisionGroup,
  RevisionRecord,
} from '@financial-manager/finance-ports/revisions';
import type { RevisionPlan } from '@financial-manager/domain/revisions';
import {
  RevisionError,
  decodeRevisionState,
} from '@financial-manager/domain/revisions';
export function sqliteTransactionRevisions(
  db: SqliteConnection,
  scope: RevisionScope,
) {
  async function load(id: string) {
    const row = (
      await db.rows(
        'SELECT id,workspace_id,account_id,group_id,counterparty_id,financial_date,CAST(account_amount_minor AS TEXT) AS account_amount_minor,economic_kind,original_description,display_name,origin_kind,CAST(version AS TEXT) AS version,created_at,updated_at,deleted_at FROM financial_transaction WHERE workspace_id=? AND id=? AND (? IS NULL OR account_id IN (SELECT value FROM json_each(?)))',
        [
          scope.workspace_id,
          id,
          scope.account_ids === null ? null : JSON.stringify(scope.account_ids),
          scope.account_ids === null ? null : JSON.stringify(scope.account_ids),
        ],
      )
    )[0];
    if (!row) return null;
    if (
      scope.account_ids !== null &&
      !scope.account_ids.includes(String(row.account_id))
    )
      throw new RevisionError('ACCESS_DENIED');
    const allocations = await db.rows(
      'SELECT a.id,a.category_id,a.subcategory_id,CAST(a.amount_minor AS TEXT) AS amount_minor,a.note FROM transaction_allocation a INNER JOIN financial_transaction t ON t.workspace_id=a.workspace_id AND t.id=a.transaction_id WHERE a.workspace_id=? AND t.workspace_id=? AND a.transaction_id=? ORDER BY a.id',
      [scope.workspace_id, scope.workspace_id, id],
    );
    const tags = await db.rows(
      'SELECT a.tag_id FROM transaction_tag a INNER JOIN financial_transaction t ON t.workspace_id=a.workspace_id AND t.id=a.transaction_id WHERE a.workspace_id=? AND t.workspace_id=? AND a.transaction_id=? ORDER BY a.tag_id',
      [scope.workspace_id, scope.workspace_id, id],
    );
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
  }
  return Object.freeze({
    load,
    async group(id: string): Promise<RevisionGroup | null> {
      const row = (
        await db.rows(
          'SELECT id,group_type,state FROM transaction_group WHERE workspace_id=? AND id=?',
          [scope.workspace_id, id],
        )
      )[0];
      if (!row) return null;
      const members = await db.rows(
        'SELECT id,account_id FROM financial_transaction WHERE workspace_id=? AND group_id=? ORDER BY id',
        [scope.workspace_id, id],
      );
      if (
        (row.group_type !== 'TRANSFER' &&
          row.group_type !== 'CARD_PAYMENT' &&
          row.group_type !== 'OTHER_COMPOSITE') ||
        (row.state !== 'ACTIVE' &&
          row.state !== 'BROKEN' &&
          row.state !== 'VOIDED')
      )
        throw new RevisionError('INVALID_SNAPSHOT');
      return Object.freeze({
        id: String(row.id),
        group_type: row.group_type,
        state: row.state,
        members: Object.freeze(
          members.map((member) =>
            Object.freeze({
              id: String(member.id),
              account_id: String(member.account_id),
            }),
          ),
        ),
      });
    },
    async history(id: string, version: string) {
      const row = (
        await db.rows(
          'SELECT a.snapshot FROM transaction_revision a INNER JOIN financial_transaction t ON t.workspace_id=a.workspace_id AND t.id=a.transaction_id WHERE a.workspace_id=? AND t.workspace_id=? AND a.transaction_id=? AND a.version=?',
          [scope.workspace_id, scope.workspace_id, id, version],
        )
      )[0];
      if (!row) return null;
      try {
        return JSON.parse(String(row.snapshot));
      } catch {
        throw new RevisionError('INVALID_SNAPSHOT');
      }
    },
    async save(plan: RevisionPlan, record: RevisionRecord) {
      const after = plan.after,
        c = after.content;
      if (!plan.before)
        await db.run(
          'INSERT INTO financial_transaction(id,workspace_id,account_id,group_id,counterparty_id,financial_date,account_amount_minor,economic_kind,original_description,display_name,origin_kind,version,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            after.id,
            scope.workspace_id,
            c.account_id,
            c.group_id,
            c.counterparty_id,
            c.financial_date,
            c.account_amount_minor,
            c.economic_kind,
            c.original_description,
            c.display_name,
            c.origin_kind,
            after.version,
            after.deleted_at,
            after.created_at,
            after.updated_at,
          ],
        );
      else {
        const rows = await db.rows(
          'UPDATE financial_transaction SET account_id=?,group_id=?,counterparty_id=?,financial_date=?,account_amount_minor=?,economic_kind=?,original_description=?,display_name=?,origin_kind=?,version=?,deleted_at=?,updated_at=? WHERE workspace_id=? AND id=? AND version=? RETURNING id',
          [
            c.account_id,
            c.group_id,
            c.counterparty_id,
            c.financial_date,
            c.account_amount_minor,
            c.economic_kind,
            c.original_description,
            c.display_name,
            c.origin_kind,
            after.version,
            after.deleted_at,
            after.updated_at,
            scope.workspace_id,
            after.id,
            plan.before.version,
          ],
        );
        if (rows.length !== 1) throw new RevisionError('VERSION_CONFLICT');
      }
      await db.run(
        'DELETE FROM transaction_allocation WHERE workspace_id=? AND transaction_id=?',
        [scope.workspace_id, after.id],
      );
      for (const a of c.allocations)
        await db.run(
          'INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,?,?,?)',
          [
            a.id,
            scope.workspace_id,
            after.id,
            a.category_id,
            a.subcategory_id,
            a.amount_minor,
            a.note,
          ],
        );
      await db.run(
        'DELETE FROM transaction_tag WHERE workspace_id=? AND transaction_id=?',
        [scope.workspace_id, after.id],
      );
      for (const tag of c.tag_ids)
        await db.run(
          'INSERT INTO transaction_tag(workspace_id,transaction_id,tag_id) VALUES(?,?,?)',
          [scope.workspace_id, after.id, tag],
        );
      await db.run(
        'INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          record.id,
          scope.workspace_id,
          after.id,
          after.version,
          JSON.stringify(record.snapshot),
          record.actor_type,
          record.actor_id,
          record.device_id,
          record.change_source,
          record.created_at,
        ],
      );
    },
  });
}
