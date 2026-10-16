import { createCryptoIdentity } from '@financial-manager/contracts';
import type { SecureRandomProvider } from '@financial-manager/contracts';
export function createWorkerIdentity(
  epochMilliseconds: () => number = Date.now,
) {
  return createCryptoIdentity(
    (globalThis as { crypto?: SecureRandomProvider }).crypto,
    epochMilliseconds,
  );
}
