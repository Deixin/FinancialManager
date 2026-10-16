import { DomainError } from './errors.js';
import { fromMoneyInteger, moneyInteger } from './money.js';
import type { MoneyMinor } from './money.js';
import {
  financialDate,
  requireId,
  validateAccount,
  validatePlannedMovement,
} from './model.js';
import type { Account, PlannedMovement } from './model.js';

/** Persist both entries and their group in one transaction in the application service. */
export interface CompositePlan {
  readonly id: string;
  readonly workspace_id: string;
  readonly group_type: 'TRANSFER' | 'CARD_PAYMENT';
  readonly entries: readonly [PlannedMovement, PlannedMovement];
}

export interface CompositeInput {
  readonly id: string;
  readonly workspace_id: string;
  readonly source_account: Account;
  readonly target_account: Account;
  readonly source_entry_id: string;
  readonly target_entry_id: string;
  readonly financial_date: string;
  readonly amount_minor: MoneyMinor;
}

export function validateCompositePlan(
  plan: CompositePlan,
  accounts: readonly Account[],
): void {
  requireId(plan.id);
  requireId(plan.workspace_id);
  if (
    !['TRANSFER', 'CARD_PAYMENT'].includes(plan.group_type) ||
    plan.entries.length !== 2
  )
    throw new DomainError('INVALID_COMPOSITE');
  const [source, target] = plan.entries;
  if (source.id === target.id) throw new DomainError('DUPLICATE_ID');
  if (
    source.account_id === target.account_id ||
    source.financial_date !== target.financial_date
  )
    throw new DomainError('INVALID_COMPOSITE');
  const byId = new Map<string, Account>();
  for (const account of accounts) {
    validateAccount(account, plan.workspace_id);
    if (byId.has(account.id)) throw new DomainError('DUPLICATE_ID');
    byId.set(account.id, account);
  }
  const entryAccounts = plan.entries.map((entry) => {
    const account = byId.get(entry.account_id);
    if (!account) throw new DomainError('SCOPE_MISMATCH');
    validatePlannedMovement(entry, account, plan.workspace_id);
    if (account.status !== 'ACTIVE' || entry.group_id !== plan.id)
      throw new DomainError('INVALID_COMPOSITE');
    return account;
  });
  const sourceAccount = entryAccounts[0]!;
  const targetAccount = entryAccounts[1]!;
  const debit = moneyInteger(source.account_amount_minor);
  const credit = moneyInteger(target.account_amount_minor);
  if (sourceAccount.balance_nature !== 'ASSET' || debit >= 0n)
    throw new DomainError('INVALID_COMPOSITE');
  if (plan.group_type === 'TRANSFER') {
    if (
      targetAccount.balance_nature !== 'ASSET' ||
      credit <= 0n ||
      debit + credit !== 0n ||
      source.economic_kind !== 'TRANSFER' ||
      target.economic_kind !== 'TRANSFER'
    )
      throw new DomainError('INVALID_COMPOSITE');
  } else if (
    targetAccount.balance_nature !== 'LIABILITY' ||
    targetAccount.account_kind !== 'CREDIT_CARD' ||
    credit >= 0n ||
    debit !== credit ||
    source.economic_kind !== 'DEBT_SETTLEMENT' ||
    target.economic_kind !== 'DEBT_SETTLEMENT'
  ) {
    throw new DomainError('INVALID_COMPOSITE');
  }
}

function planComposite(
  input: CompositeInput,
  groupType: CompositePlan['group_type'],
): CompositePlan {
  financialDate(input.financial_date);
  const amount = moneyInteger(input.amount_minor);
  if (amount <= 0n) throw new DomainError('NON_POSITIVE_AMOUNT');
  const kind = groupType === 'TRANSFER' ? 'TRANSFER' : 'DEBT_SETTLEMENT';
  const common = {
    workspace_id: input.workspace_id,
    group_id: input.id,
    financial_date: input.financial_date,
    economic_kind: kind,
  } as const;
  const entries: CompositePlan['entries'] = Object.freeze([
    Object.freeze({
      ...common,
      id: input.source_entry_id,
      account_id: input.source_account.id,
      account_amount_minor: fromMoneyInteger(-amount),
    }),
    Object.freeze({
      ...common,
      id: input.target_entry_id,
      account_id: input.target_account.id,
      account_amount_minor: fromMoneyInteger(
        groupType === 'TRANSFER' ? amount : -amount,
      ),
    }),
  ]);
  const plan = Object.freeze({
    id: input.id,
    workspace_id: input.workspace_id,
    group_type: groupType,
    entries,
  });
  validateCompositePlan(plan, [input.source_account, input.target_account]);
  return plan;
}

/** Moves value between two own asset accounts without creating economic consumption. */
export function planTransfer(input: CompositeInput): CompositePlan {
  return planComposite(input, 'TRANSFER');
}

/** Reduces the asset balance and the positive debt displayed by the card. */
export function planCardPayment(input: CompositeInput): CompositePlan {
  return planComposite(input, 'CARD_PAYMENT');
}
