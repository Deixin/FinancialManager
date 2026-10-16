import { DomainError } from './errors.js';
import { moneyInteger, fromMoneyInteger } from './money.js';
import type { MoneyMinor } from './money.js';
import {
  financialDate,
  requireId,
  validateAccount,
  validateMovement,
} from './model.js';
import type { Account, BalanceReference, Movement } from './model.js';

export type HistoryCoverage = 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN';
export type BalanceWarning =
  'MISSING_REFERENCE' | 'INCOMPLETE_HISTORY' | 'UNKNOWN_HISTORY';
export interface AccountBalance {
  readonly workspace_id: string;
  readonly account_id: string;
  readonly currency_code: 'BRL';
  readonly balance_nature: 'ASSET' | 'LIABILITY';
  readonly as_of: string;
  readonly amount_minor: MoneyMinor;
  readonly completeness: 'COMPLETE' | 'INCOMPLETE';
  readonly warnings: readonly BalanceWarning[];
}
export function calculateAccountBalance(input: {
  readonly workspace_id: string;
  readonly account: Account;
  readonly reference: BalanceReference | null;
  readonly movements: readonly Movement[];
  readonly as_of: string;
  readonly history_coverage: HistoryCoverage;
}): AccountBalance {
  const { workspace_id: workspace, account, reference, movements } = input;
  validateAccount(account, workspace);
  financialDate(input.as_of);
  const warnings: BalanceWarning[] = [];
  if (!['COMPLETE', 'INCOMPLETE', 'UNKNOWN'].includes(input.history_coverage))
    throw new DomainError('INVALID_REFERENCE');
  if (input.history_coverage === 'INCOMPLETE')
    warnings.push('INCOMPLETE_HISTORY');
  if (input.history_coverage === 'UNKNOWN') warnings.push('UNKNOWN_HISTORY');
  let total = 0n;
  if (reference) {
    if (
      reference.workspace_id !== workspace ||
      reference.account_id !== account.id
    )
      throw new DomainError('SCOPE_MISMATCH');
    if (
      reference.status !== 'ACTIVE' ||
      !['START_OF_DAY', 'END_OF_DAY'].includes(reference.day_position)
    )
      throw new DomainError('INVALID_REFERENCE');
    financialDate(reference.reference_date);
    if (reference.reference_date > input.as_of)
      throw new DomainError('REFERENCE_AFTER_AS_OF');
    total = moneyInteger(reference.amount_minor);
  } else warnings.push('MISSING_REFERENCE');
  const ids = new Set<string>();
  for (const movement of movements) {
    validateMovement(movement, account, workspace);
    if (ids.has(movement.id)) throw new DomainError('DUPLICATE_ID');
    ids.add(movement.id);
    if (
      movement.posting_state !== 'CONFIRMED' ||
      movement.financial_date > input.as_of
    )
      continue;
    if (
      reference &&
      (movement.financial_date < reference.reference_date ||
        (movement.financial_date === reference.reference_date &&
          reference.day_position === 'END_OF_DAY'))
    )
      continue;
    total += moneyInteger(movement.account_amount_minor);
  }
  return Object.freeze({
    workspace_id: workspace,
    account_id: account.id,
    currency_code: 'BRL',
    balance_nature: account.balance_nature,
    as_of: input.as_of,
    amount_minor: fromMoneyInteger(total),
    completeness: warnings.length ? 'INCOMPLETE' : 'COMPLETE',
    warnings: Object.freeze(warnings),
  });
}
export function consolidateBalances(
  workspace: string,
  balances: readonly AccountBalance[],
): {
  readonly currency_code: 'BRL';
  readonly as_of: string | null;
  readonly asset_balance_minor: MoneyMinor;
  readonly liability_balance_minor: MoneyMinor;
  readonly net_worth_minor: MoneyMinor;
  readonly completeness: 'COMPLETE' | 'INCOMPLETE';
} {
  requireId(workspace);
  let assets = 0n,
    liabilities = 0n;
  const ids = new Set<string>();
  const asOf = balances[0]?.as_of ?? null;
  let complete = balances.length > 0;
  for (const balance of balances) {
    requireId(balance.account_id);
    requireId(balance.workspace_id);
    if (balance.workspace_id !== workspace)
      throw new DomainError('SCOPE_MISMATCH');
    if (balance.currency_code !== 'BRL')
      throw new DomainError('UNSUPPORTED_CURRENCY');
    if (ids.has(balance.account_id)) throw new DomainError('DUPLICATE_ID');
    ids.add(balance.account_id);
    financialDate(balance.as_of);
    if (balance.as_of !== asOf) throw new DomainError('INVALID_PERIOD');
    const amount = moneyInteger(balance.amount_minor);
    if (balance.balance_nature === 'ASSET') assets += amount;
    else if (balance.balance_nature === 'LIABILITY') liabilities += amount;
    else throw new DomainError('INVALID_ACCOUNT');
    if (
      !['COMPLETE', 'INCOMPLETE'].includes(balance.completeness) ||
      balance.warnings.some(
        (warning) =>
          ![
            'MISSING_REFERENCE',
            'INCOMPLETE_HISTORY',
            'UNKNOWN_HISTORY',
          ].includes(warning),
      ) ||
      (balance.completeness === 'COMPLETE') !== (balance.warnings.length === 0)
    )
      throw new DomainError('INVALID_REFERENCE');
    if (balance.completeness !== 'COMPLETE') complete = false;
  }
  return Object.freeze({
    currency_code: 'BRL',
    as_of: asOf,
    asset_balance_minor: fromMoneyInteger(assets),
    liability_balance_minor: fromMoneyInteger(liabilities),
    net_worth_minor: fromMoneyInteger(assets - liabilities),
    completeness: complete ? 'COMPLETE' : 'INCOMPLETE',
  });
}
