import type {
  Counterparty,
  CounterpartyCommand,
} from '../src/counterparties.js';
declare const item: Counterparty;
const commands: readonly CounterpartyCommand[] = [
  { kind: 'CREATE', item },
  { kind: 'UPDATE', base: item, item },
];
void commands;
// @ts-expect-error A counterparty has no monetary value.
void item.amount_minor;
// @ts-expect-error Identity is immutable.
item.id = 'synthetic';
// @ts-expect-error Updates require a complete captured base.
const missing: CounterpartyCommand = { kind: 'UPDATE', item };
void missing;
// @ts-expect-error Used counterparties are archived rather than deleted.
const deletion: CounterpartyCommand = { kind: 'DELETE', id: item.id };
void deletion;
