import { instantFromEpochMilliseconds } from '@financial-manager/domain';
import type { UtcInstant } from '@financial-manager/domain';
export type ResourceId = string & { readonly __resourceId: unique symbol };
export type UuidV7 = ResourceId & { readonly __uuidV7: unique symbol };
export type IdentityErrorCode =
  | 'INVALID_RESOURCE_ID'
  | 'INVALID_UUID_V7'
  | 'INVALID_UUID_TIME'
  | 'ENTROPY_UNAVAILABLE'
  | 'CLOCK_UNAVAILABLE';
export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  constructor(code: IdentityErrorCode) {
    super(code);
    this.name = 'IdentityError';
    this.code = code;
  }
}
export const MAX_UUID_MILLISECONDS = 281474976710655;
export function resourceId(value: unknown): ResourceId {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new IdentityError('INVALID_RESOURCE_ID');
  return value as ResourceId;
}
export function uuidV7(value: unknown): UuidV7 {
  const id = resourceId(value);
  if (id[14] !== '7') throw new IdentityError('INVALID_UUID_V7');
  return id as UuidV7;
}
// RFC 9562 §5.7: 48-bit Unix milliseconds + 74 fresh random bits.
// This is a format codec, not a random-number generator or conflict clock.
export function encodeUuidV7(
  milliseconds: number,
  entropy: Uint8Array,
): UuidV7 {
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > MAX_UUID_MILLISECONDS
  )
    throw new IdentityError('INVALID_UUID_TIME');
  if (!(entropy instanceof Uint8Array) || entropy.length !== 10)
    throw new IdentityError('ENTROPY_UNAVAILABLE');
  const time = milliseconds.toString(16).padStart(12, '0');
  const hex = Array.from(entropy, (byte) => byte.toString(16).padStart(2, '0'));
  return uuidV7(
    `${time.slice(0, 8)}-${time.slice(8)}-7${(entropy[0]! & 15).toString(16)}${hex[1]}-${((entropy[2]! & 63) | 128).toString(16)}${hex[3]}-${hex.slice(4).join('')}`,
  );
}
// Diagnostic only: do not use the embedded clock for authorization, business dates,
// revisions, feed order, conflict resolution or expiry policies.
export function uuidV7Milliseconds(value: UuidV7): number {
  return Number.parseInt(uuidV7(value).slice(0, 13).replace('-', ''), 16);
}
export interface IdentityPorts {
  readonly epochMilliseconds: () => number;
  readonly randomBytes: (count: number) => Uint8Array;
}
export interface IdentityRuntime {
  readonly newId: () => UuidV7;
  readonly nowInstant: () => UtcInstant;
}
export interface SecureRandomProvider {
  getRandomValues(array: Uint8Array): Uint8Array;
}
export function createIdentityRuntime(ports: IdentityPorts): IdentityRuntime {
  const clock = ports.epochMilliseconds,
    random = ports.randomBytes;
  const now = () => {
    try {
      return clock();
    } catch {
      throw new IdentityError('CLOCK_UNAVAILABLE');
    }
  };
  return Object.freeze({
    newId() {
      const milliseconds = now();
      if (
        !Number.isSafeInteger(milliseconds) ||
        milliseconds < 0 ||
        milliseconds > MAX_UUID_MILLISECONDS
      )
        throw new IdentityError('INVALID_UUID_TIME');
      let bytes: Uint8Array;
      try {
        bytes = random(10);
      } catch {
        throw new IdentityError('ENTROPY_UNAVAILABLE');
      }
      return encodeUuidV7(milliseconds, bytes);
    },
    nowInstant: () => instantFromEpochMilliseconds(now()),
  });
}
export function createCryptoIdentity(
  crypto: SecureRandomProvider | undefined,
  epochMilliseconds: () => number,
): IdentityRuntime {
  return createIdentityRuntime({
    epochMilliseconds,
    randomBytes(count) {
      if (!crypto || typeof crypto.getRandomValues !== 'function')
        throw new IdentityError('ENTROPY_UNAVAILABLE');
      const bytes = new Uint8Array(count);
      crypto.getRandomValues(bytes);
      return bytes;
    },
  });
}
