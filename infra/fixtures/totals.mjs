import assert from 'node:assert/strict';
import {
  calculateAccountBalance,
  consolidateBalances,
  summarizeMovements,
  moneyMinor,
} from '../../packages/domain/dist/index.js';
import { fixture } from './loader.mjs';
export function verifyTotals(snapshot, workspace) {
  const accounts = snapshot.financial_account;
  const movements = snapshot.financial_transaction.map((row) => ({
    ...row,
    account_amount_minor: moneyMinor(row.account_amount_minor),
    posting_state: row.deleted_at === null ? 'CONFIRMED' : 'DELETED',
  }));
  const balances = [];
  for (const expected of fixture.expected.balances.filter(
    (row) => row.workspace_id === workspace,
  )) {
    const account = accounts.find((row) => row.id === expected.account_id);
    const reference = snapshot.balance_reference.find(
      (row) => row.account_id === account.id,
    );
    const balance = calculateAccountBalance({
      workspace_id: workspace,
      account,
      reference,
      movements: movements.filter((row) => row.account_id === account.id),
      as_of: expected.as_of,
      history_coverage: 'COMPLETE',
    });
    assert.equal(balance.amount_minor, expected.amount_minor);
    assert.equal(balance.completeness, 'COMPLETE');
    balances.push(balance);
  }
  for (const expected of fixture.expected.reports.filter(
    (row) => row.workspace_id === workspace,
  ))
    assert.deepEqual(
      summarizeMovements({
        workspace_id: workspace,
        accounts,
        movements,
        period: { from: expected.from, to: expected.to },
      }),
      expected.totals,
    );
  if (workspace === fixture.workspace_a) {
    for (const expected of fixture.expected.wealth) {
      const actual = consolidateBalances(
        workspace,
        balances.filter((row) => row.as_of === expected.as_of),
      );
      for (const [key, value] of Object.entries(expected))
        assert.equal(actual[key], value);
    }
    for (const expected of fixture.expected.allocations)
      assert.equal(
        snapshot.transaction_allocation
          .filter((row) => row.transaction_id === expected.transaction_id)
          .reduce((sum, row) => sum + BigInt(row.amount_minor), 0n)
          .toString(),
        expected.amount_minor,
      );
  }
}
// Oracle for a future document/search test; no document schema or search engine is claimed.
export function verifyDocumentVector() {
  const vector = fixture.document_search_vector;
  assert.equal(vector.status, 'VECTOR_ONLY_DOCUMENT_SCHEMA_PENDING');
  for (const item of vector.items)
    assert.equal(
      (BigInt(item.quantity) * BigInt(item.unit_amount_minor)).toString(),
      item.amount_minor,
    );
  const sum = (rows) =>
    rows
      .reduce((total, row) => total + BigInt(row.amount_minor), 0n)
      .toString();
  assert.equal(sum(vector.items), vector.expected.document_total_minor);
  assert.equal(
    sum(vector.items.filter((row) => row.matches)),
    vector.expected.matched_items_minor,
  );
  assert.equal(sum(vector.payments), vector.expected.payment_total_minor);
  assert.equal(
    vector.items.filter((row) => row.matches).length,
    vector.expected.matching_item_count,
  );
  assert.equal(
    new Set(vector.payments.map((row) => row.transaction_id)).size,
    2,
  );
  for (const payment of vector.payments) {
    const transaction = fixture.seed.find(
      (row) =>
        row.table === 'financial_transaction' &&
        row.values.id === payment.transaction_id,
    );
    assert.equal(transaction.values.economic_kind, 'DEBT_SETTLEMENT');
    assert.equal(
      (-BigInt(transaction.values.account_amount_minor)).toString(),
      payment.amount_minor,
    );
  }
}
