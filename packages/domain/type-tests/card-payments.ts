import type { CardPaymentCommand } from '../src/card-payments.js';

export function verifyCardPaymentContracts(command: CardPaymentCommand): void {
  if (command.kind !== 'CREATE') return;
  // @ts-expect-error Captured commands are immutable.
  command.amount_minor = '10';
  // @ts-expect-error Money crosses this boundary as a canonical decimal string.
  const unsafe: CardPaymentCommand = { ...command, amount_minor: 10.5 };
  // @ts-expect-error Account descriptors are immutable.
  command.target_account.status = 'ARCHIVED';
  void unsafe;
}
