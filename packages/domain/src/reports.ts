import { DomainError } from './errors.js';
import { fromMoneyInteger, moneyInteger } from './money.js';
import type { MoneyMinor } from './money.js';
import {
  financialDate,
  requireId,
  validateAccount,
  validateMovement,
} from './model.js';
import type { Account, Movement } from './model.js';

export interface MovementSummary {
  readonly currency_code: 'BRL';
  readonly income_minor: MoneyMinor;
  readonly expense_minor: MoneyMinor;
  readonly expense_reversal_minor: MoneyMinor;
  readonly net_expense_minor: MoneyMinor;
  readonly economic_result_minor: MoneyMinor;
  readonly cash_in_minor: MoneyMinor;
  readonly cash_out_minor: MoneyMinor;
  readonly cash_net_minor: MoneyMinor;
}

/** Accounts must already be authorized by the application service. Dates are inclusive. */
export function summarizeMovements(input: {
  readonly workspace_id: string;
  readonly accounts: readonly Account[];
  readonly movements: readonly Movement[];
  readonly period: { readonly from: string; readonly to: string };
}): MovementSummary {
  requireId(input.workspace_id);
  financialDate(input.period.from);
  financialDate(input.period.to);
  if (input.period.from > input.period.to)
    throw new DomainError('INVALID_PERIOD');
  const accounts = new Map<string, Account>();
  for (const account of input.accounts) {
    validateAccount(account, input.workspace_id);
    if (accounts.has(account.id)) throw new DomainError('DUPLICATE_ID');
    accounts.set(account.id, account);
  }
  let income = 0n,
    expense = 0n,
    reversals = 0n,
    cashIn = 0n,
    cashOut = 0n;
  const ids = new Set<string>();
  for (const movement of input.movements) {
    const account = accounts.get(movement.account_id);
    if (!account) throw new DomainError('SCOPE_MISMATCH');
    validateMovement(movement, account, input.workspace_id);
    if (ids.has(movement.id)) throw new DomainError('DUPLICATE_ID');
    ids.add(movement.id);
    if (
      movement.posting_state !== 'CONFIRMED' ||
      movement.financial_date < input.period.from ||
      movement.financial_date > input.period.to
    )
      continue;
    const delta = moneyInteger(movement.account_amount_minor);
    const economicAmount = account.balance_nature === 'ASSET' ? delta : -delta;
    switch (movement.economic_kind) {
      case 'INCOME':
        if (economicAmount <= 0n)
          throw new DomainError('INVALID_ECONOMIC_SIGN');
        income += economicAmount;
        break;
      case 'EXPENSE':
        if (economicAmount >= 0n)
          throw new DomainError('INVALID_ECONOMIC_SIGN');
        expense -= economicAmount;
        break;
      case 'EXPENSE_REVERSAL':
        if (economicAmount <= 0n)
          throw new DomainError('INVALID_ECONOMIC_SIGN');
        reversals += economicAmount;
        break;
    }
    if (account.balance_nature === 'ASSET') {
      if (delta > 0n) cashIn += delta;
      else cashOut -= delta;
    }
  }
  return Object.freeze({
    currency_code: 'BRL',
    income_minor: fromMoneyInteger(income),
    expense_minor: fromMoneyInteger(expense),
    expense_reversal_minor: fromMoneyInteger(reversals),
    net_expense_minor: fromMoneyInteger(expense - reversals),
    economic_result_minor: fromMoneyInteger(income - expense + reversals),
    cash_in_minor: fromMoneyInteger(cashIn),
    cash_out_minor: fromMoneyInteger(cashOut),
    cash_net_minor: fromMoneyInteger(cashIn - cashOut),
  });
}
