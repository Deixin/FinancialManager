import { DomainError } from './errors.js';
import { moneyMinor } from './money.js';
import type { MoneyMinor } from './money.js';

export type CurrencyCode = 'BRL';
export type BalanceNature = 'ASSET' | 'LIABILITY';
export type AccountKind =
  | 'CHECKING'
  | 'SAVINGS'
  | 'DIGITAL'
  | 'CASH'
  | 'CREDIT_CARD'
  | 'INVESTMENT_SIMPLE'
  | 'LOAN_SIMPLE'
  | 'OTHER';
export interface Account {
  readonly id: string;
  readonly workspace_id: string;
  readonly currency_code: CurrencyCode;
  readonly balance_nature: BalanceNature;
  readonly account_kind: AccountKind;
  readonly status: 'ACTIVE' | 'ARCHIVED';
}
export type EconomicKind =
  | 'INCOME'
  | 'EXPENSE'
  | 'EXPENSE_REVERSAL'
  | 'TRANSFER'
  | 'DEBT_SETTLEMENT'
  | 'ADJUSTMENT'
  | 'OTHER';
export interface PlannedMovement {
  readonly id: string;
  readonly workspace_id: string;
  readonly account_id: string;
  readonly group_id: string | null;
  readonly financial_date: string;
  readonly account_amount_minor: MoneyMinor;
  readonly economic_kind: EconomicKind;
}
/** A read projection, not additional columns or lifecycle states in the ERD. */
export interface Movement extends PlannedMovement {
  readonly posting_state: 'CONFIRMED' | 'STAGING' | 'DELETED';
}
export interface BalanceReference {
  readonly workspace_id: string;
  readonly account_id: string;
  readonly amount_minor: MoneyMinor;
  readonly reference_date: string;
  readonly day_position: 'START_OF_DAY' | 'END_OF_DAY';
  readonly status: 'ACTIVE' | 'SUPERSEDED';
}
export function requireId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw new DomainError('INVALID_ID');
}
export function financialDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '0001-01-01' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new DomainError('INVALID_DATE');
  return value;
}
export function validateAccount(account: Account, workspace: string): void {
  requireId(workspace);
  requireId(account.id);
  requireId(account.workspace_id);
  if (account.workspace_id !== workspace)
    throw new DomainError('SCOPE_MISMATCH');
  if (account.currency_code !== 'BRL')
    throw new DomainError('UNSUPPORTED_CURRENCY');
  if (
    !['ASSET', 'LIABILITY'].includes(account.balance_nature) ||
    !['ACTIVE', 'ARCHIVED'].includes(account.status) ||
    ![
      'CHECKING',
      'SAVINGS',
      'DIGITAL',
      'CASH',
      'CREDIT_CARD',
      'INVESTMENT_SIMPLE',
      'LOAN_SIMPLE',
      'OTHER',
    ].includes(account.account_kind)
  )
    throw new DomainError('INVALID_ACCOUNT');
}
export function validatePlannedMovement(
  movement: PlannedMovement,
  account: Account,
  workspace: string,
): void {
  validateAccount(account, workspace);
  requireId(movement.id);
  requireId(movement.workspace_id);
  requireId(movement.account_id);
  if (movement.workspace_id !== workspace || movement.account_id !== account.id)
    throw new DomainError('SCOPE_MISMATCH');
  if (movement.group_id !== null) requireId(movement.group_id);
  financialDate(movement.financial_date);
  moneyMinor(movement.account_amount_minor);
  if (
    ![
      'INCOME',
      'EXPENSE',
      'EXPENSE_REVERSAL',
      'TRANSFER',
      'DEBT_SETTLEMENT',
      'ADJUSTMENT',
      'OTHER',
    ].includes(movement.economic_kind)
  )
    throw new DomainError('INVALID_MOVEMENT');
}
export function validateMovement(
  movement: Movement,
  account: Account,
  workspace: string,
): void {
  validatePlannedMovement(movement, account, workspace);
  if (!['CONFIRMED', 'STAGING', 'DELETED'].includes(movement.posting_state))
    throw new DomainError('INVALID_MOVEMENT');
}
