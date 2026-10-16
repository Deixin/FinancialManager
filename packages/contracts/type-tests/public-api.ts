import { createFetchTransport } from '../src/index.js';
import type {
  CreateTransactionInput,
  V1Client,
  components,
} from '../src/index.js';
import { moneyMinor } from '@financial-manager/domain';

// Native consumers receive only a structural transport type, not DOM classes.
export const fetchTransport = createFetchTransport(globalThis.fetch);
export async function verifyGeneratedContracts(
  client: V1Client,
  input: CreateTransactionInput,
) {
  // @ts-expect-error Every operation needs a workspace path parameter.
  await client.listAccounts({ query: { limit: 10 } });
  // @ts-expect-error Idempotency-Key is required for mutations.
  await client.createTransaction({ path: input.path, body: input.body });
  // @ts-expect-error Money cannot be a JSON number.
  const numeric: components['schemas']['MoneyMinor'] = 100;
  // @ts-expect-error Monetary strings need runtime construction first.
  const unvalidated: components['schemas']['MoneyMinor'] = '100';
  void numeric;
  void unvalidated;
  const amount: components['schemas']['MoneyMinor'] = moneyMinor(
    '9223372036854775807',
  );
  // @ts-expect-error A single manual movement cannot create half a transfer.
  const transfer: components['schemas']['CreateTransaction']['economicKind'] =
    'TRANSFER';
  void transfer;
  const result = await client.createTransaction(input);
  if (result.ok) {
    const returned: components['schemas']['MoneyMinor'] =
      result.data.data.amountMinor;
    // @ts-expect-error Generated monetary responses are readonly.
    result.data.data.amountMinor = amount;
    return returned;
  }
  return result.error.code;
}
