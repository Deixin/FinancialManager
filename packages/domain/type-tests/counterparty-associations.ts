import type {
  CounterpartyAssociationCommand,
  CounterpartyReference,
} from '../src/counterparties.js';
import type { RevisionState } from '../src/revisions.js';
declare const base: RevisionState;
const commands: readonly CounterpartyAssociationCommand[] = [
  { base, counterparty: { kind: 'KEEP' } },
  { base, counterparty: { kind: 'CLEAR' } },
  { base, counterparty: { kind: 'SET', counterparty_id: 'synthetic' } },
];
void commands;
declare const reference: CounterpartyReference;
// @ts-expect-error Reference projections cannot expose an identifier.
void reference.identifier_value;
// @ts-expect-error Reference projections are immutable.
reference.status = 'ACTIVE';
const missing: CounterpartyAssociationCommand = {
  base,
  // @ts-expect-error SET always specifies the chosen identity.
  counterparty: { kind: 'SET' },
};
void missing;
