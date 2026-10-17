import type { Kysely } from 'kysely';
interface GateDatabase {
  financial_account: { id: string; workspace_id: string; name: string };
  financial_transaction: {
    id: string;
    workspace_id: string;
    financial_date: string;
    account_amount_minor: string;
  };
}
declare const db: Kysely<GateDatabase>;
db.selectFrom('financial_account').select(['id', 'workspace_id']);
// @ts-expect-error unknown columns must never compile
db.selectFrom('financial_account').select('secret_column');
// @ts-expect-error unknown tables must never compile
db.selectFrom('another_module_table').selectAll();
db.updateTable('financial_transaction').set({
  // @ts-expect-error the driver contract uses canonical strings, never JS money numbers
  account_amount_minor: 9007199254740993,
});
// @ts-expect-error UUID column cannot receive a number
db.selectFrom('financial_account').where('id', '=', 1);
