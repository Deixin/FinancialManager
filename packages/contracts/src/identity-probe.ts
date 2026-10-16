import {
  financialDate,
  utcInstant,
  instantEpochMilliseconds,
} from '@financial-manager/domain';
import {
  encodeUuidV7,
  uuidV7,
  uuidV7Milliseconds,
  resourceId,
} from './identity.js';
import type { IdentityRuntime } from './identity.js';
import { identityVectors } from './generated/identity-vectors.js';
export { identityVectors } from './generated/identity-vectors.js';
export const identityRuntimeChecks = Object.freeze([
  'rfc_vector',
  'legacy_and_invalid_ids',
  'same_millisecond_csprng',
  'increasing_clock_order',
  'clock_regression_and_independent_generators',
  'canonical_temporal_vectors',
] as const);
function check(value: unknown): void {
  if (!value) throw new Error('IDENTITY_PROBE_FAILED');
}
function rejects(operation: () => unknown): void {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  check(rejected);
}
// Explicitly synthetic runtime instrument. Never a product seed or log of generated IDs.
export function runIdentityProbe(
  factory: (clock: () => number) => IdentityRuntime,
): Readonly<Record<string, true>> {
  const vector = identityVectors.rfc;
  check(
    encodeUuidV7(vector.milliseconds, new Uint8Array(vector.entropy)) ===
      vector.uuid,
  );
  check(
    resourceId(identityVectors.legacy_uuid) === identityVectors.legacy_uuid,
  );
  for (const id of identityVectors.invalid_uuid) rejects(() => resourceId(id));
  const generated = new Set<string>();
  const fixed = factory(() => vector.milliseconds);
  for (let index = 0; index < 4096; index++) {
    const id = fixed.newId();
    check(uuidV7(id) === id && uuidV7Milliseconds(id) === vector.milliseconds);
    generated.add(id);
  }
  check(generated.size === 4096);
  let clock = vector.milliseconds,
    previous = '';
  const advancing = factory(() => clock++);
  for (let index = 0; index < 256; index++) {
    const id = advancing.newId();
    check(id > previous);
    previous = id;
  }
  let rollback = vector.milliseconds + 1000;
  const regressing = factory(() => rollback);
  const newer = regressing.newId();
  rollback -= 1000;
  const older = regressing.newId();
  check(older < newer && uuidV7Milliseconds(older) === rollback);
  const independent = factory(() => rollback);
  for (let index = 0; index < 512; index++) {
    generated.add(regressing.newId());
    generated.add(independent.newId());
  }
  check(generated.size === 5120);
  for (const value of identityVectors.valid_dates)
    check(financialDate(JSON.parse(JSON.stringify(value))) === value);
  for (const value of identityVectors.invalid_dates)
    rejects(() => financialDate(value));
  for (const value of identityVectors.valid_instants) {
    const parsed = utcInstant(value.text);
    check(instantEpochMilliseconds(parsed) === value.milliseconds);
    check(factory(() => value.milliseconds).nowInstant() === value.text);
    check(utcInstant(JSON.parse(JSON.stringify(parsed))) === value.text);
  }
  for (const value of identityVectors.invalid_instants)
    rejects(() => utcInstant(value));
  return Object.freeze(
    Object.fromEntries(
      identityRuntimeChecks.map((name) => [name, true as const]),
    ),
  );
}
