import { addMoney, moneyMinor, planTransfer } from '../src/index.js';
import type { Account, MoneyMinor } from '../src/index.js';

export function verifyMoneyContracts(account: Account): MoneyMinor {
  // @ts-expect-error Unvalidated decimal strings cannot enter monetary operations.
  addMoney('100', moneyMinor('1'));
  // @ts-expect-error Binary floating point is not a monetary domain type.
  const unsafe: MoneyMinor = 0.1;
  void unsafe;
  const plan = planTransfer({
    id: 'group',
    workspace_id: account.workspace_id,
    source_account: account,
    target_account: account,
    source_entry_id: 'left',
    target_entry_id: 'right',
    financial_date: '2026-09-01',
    amount_minor: moneyMinor('100'),
  });
  // @ts-expect-error Plans cannot be changed by their consumers.
  plan.entries[0].account_amount_minor = moneyMinor('200');
  return addMoney(moneyMinor('100'), moneyMinor('1'));
}
