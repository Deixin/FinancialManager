// Synthetic FIN-002 projection only. Never imported by the application.
import { canonicalFixture as fixture } from '../../packages/test-fixtures/dist/canonical.js';
const workspace = fixture.workspace_a,
  now = '2026-10-17T12:00:00.000Z';
export function syntheticSnapshot(w = workspace) {
  const seed = fixture.seed.filter((r) => r.values.workspace_id === w);
  return {
    workspace_id: w,
    read_at: now,
    accounts: seed
      .filter((r) => r.table === 'financial_account')
      .map((r) => ({
        account: { ...r.values, institution_name: null },
        references: seed
          .filter(
            (s) =>
              s.table === 'balance_reference' &&
              s.values.account_id === r.values.id,
          )
          .map((s) => ({ ...s.values })),
      })),
    movements: seed
      .filter(
        (r) =>
          r.table === 'financial_transaction' && r.values.deleted_at === null,
      )
      .map(({ values: r }) => ({
        id: r.id,
        workspace_id: r.workspace_id,
        account_id: r.account_id,
        group_id: r.group_id,
        financial_date: r.financial_date,
        account_amount_minor: r.account_amount_minor,
        economic_kind: r.economic_kind,
        posting_state: 'CONFIRMED',
      })),
  };
}
