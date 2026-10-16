import { moneyMinor } from '@financial-manager/domain';
import type {
  Account,
  BalanceReference,
  Movement,
  MovementSummary,
} from '@financial-manager/domain';

/** FIN-001: entirely synthetic; no identity, bank statement or personal data. */
export const SYNTHETIC_WORKSPACE = 'synthetic-workspace-fin-001';
export const SYNTHETIC_ACCOUNTS: readonly Account[] = Object.freeze([
  Object.freeze({
    id: 'synthetic-bank',
    workspace_id: SYNTHETIC_WORKSPACE,
    currency_code: 'BRL',
    account_kind: 'CHECKING',
    balance_nature: 'ASSET',
    status: 'ACTIVE',
  }),
  Object.freeze({
    id: 'synthetic-savings',
    workspace_id: SYNTHETIC_WORKSPACE,
    currency_code: 'BRL',
    account_kind: 'SAVINGS',
    balance_nature: 'ASSET',
    status: 'ACTIVE',
  }),
  Object.freeze({
    id: 'synthetic-card',
    workspace_id: SYNTHETIC_WORKSPACE,
    currency_code: 'BRL',
    account_kind: 'CREDIT_CARD',
    balance_nature: 'LIABILITY',
    status: 'ACTIVE',
  }),
]);
export const SYNTHETIC_REFERENCES: readonly BalanceReference[] = Object.freeze(
  SYNTHETIC_ACCOUNTS.map((account) =>
    Object.freeze({
      workspace_id: SYNTHETIC_WORKSPACE,
      account_id: account.id,
      amount_minor: moneyMinor(
        account.id === 'synthetic-bank' ? '100000' : '0',
      ),
      reference_date: '2026-09-01',
      day_position: 'START_OF_DAY',
      status: 'ACTIVE',
    }),
  ),
);
function movement(
  id: string,
  account: string,
  date: string,
  amount: string,
  kind: Movement['economic_kind'],
  group: string | null = null,
  state: Movement['posting_state'] = 'CONFIRMED',
): Movement {
  return Object.freeze({
    id: `synthetic-${id}`,
    workspace_id: SYNTHETIC_WORKSPACE,
    account_id: `synthetic-${account}`,
    financial_date: date,
    account_amount_minor: moneyMinor(amount),
    economic_kind: kind,
    group_id: group === null ? null : `synthetic-${group}`,
    posting_state: state,
  });
}
export const SYNTHETIC_MOVEMENTS: readonly Movement[] = Object.freeze([
  movement('income', 'bank', '2026-09-02', '50000', 'INCOME'),
  movement('expense', 'bank', '2026-09-03', '-20000', 'EXPENSE'),
  movement('purchase', 'card', '2026-09-10', '12000', 'EXPENSE'),
  movement(
    'transfer-out',
    'bank',
    '2026-09-15',
    '-10000',
    'TRANSFER',
    'transfer',
  ),
  movement(
    'transfer-in',
    'savings',
    '2026-09-15',
    '10000',
    'TRANSFER',
    'transfer',
  ),
  movement(
    'payment-bank',
    'bank',
    '2026-10-05',
    '-12000',
    'DEBT_SETTLEMENT',
    'payment',
  ),
  movement(
    'payment-card',
    'card',
    '2026-10-05',
    '-12000',
    'DEBT_SETTLEMENT',
    'payment',
  ),
  movement('refund', 'card', '2026-10-07', '-2000', 'EXPENSE_REVERSAL'),
  movement(
    'staging',
    'bank',
    '2026-09-04',
    '-99999',
    'EXPENSE',
    null,
    'STAGING',
  ),
  movement(
    'deleted',
    'bank',
    '2026-09-05',
    '-88888',
    'EXPENSE',
    null,
    'DELETED',
  ),
]);

// Golden totals are written explicitly, independently of the domain algorithms.
export const SYNTHETIC_SEPTEMBER_SUMMARY: MovementSummary = Object.freeze({
  currency_code: 'BRL',
  income_minor: moneyMinor('50000'),
  expense_minor: moneyMinor('32000'),
  expense_reversal_minor: moneyMinor('0'),
  net_expense_minor: moneyMinor('32000'),
  economic_result_minor: moneyMinor('18000'),
  cash_in_minor: moneyMinor('60000'),
  cash_out_minor: moneyMinor('30000'),
  cash_net_minor: moneyMinor('30000'),
});
export const SYNTHETIC_OCTOBER_SUMMARY: MovementSummary = Object.freeze({
  currency_code: 'BRL',
  income_minor: moneyMinor('0'),
  expense_minor: moneyMinor('0'),
  expense_reversal_minor: moneyMinor('2000'),
  net_expense_minor: moneyMinor('-2000'),
  economic_result_minor: moneyMinor('2000'),
  cash_in_minor: moneyMinor('0'),
  cash_out_minor: moneyMinor('12000'),
  cash_net_minor: moneyMinor('-12000'),
});
