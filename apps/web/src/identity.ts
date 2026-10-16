import { createCryptoIdentity } from '@financial-manager/contracts';
import type { SecureRandomProvider } from '@financial-manager/contracts';
export function createWebIdentity(epochMilliseconds: () => number = Date.now) {
  const crypto = (globalThis as { crypto?: SecureRandomProvider }).crypto;
  return createCryptoIdentity(crypto, epochMilliseconds);
}
