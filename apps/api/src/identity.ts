import { createCryptoIdentity } from '@financial-manager/contracts';
import type { SecureRandomProvider } from '@financial-manager/contracts';
// Node 24 Web Crypto; no fallback to a process-local pseudorandom source.
export function createApiIdentity(epochMilliseconds: () => number = Date.now) {
  return createCryptoIdentity(
    (globalThis as { crypto?: SecureRandomProvider }).crypto,
    epochMilliseconds,
  );
}
