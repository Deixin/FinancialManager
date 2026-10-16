import { getRandomValues } from 'expo-crypto';
import { createCryptoIdentity } from '@financial-manager/contracts';
// getRandomBytes has a development Math.random fallback in Expo 58.0.6.
// getRandomValues calls the native CSPRNG directly and fails if unavailable.
export function createMobileIdentity(
  epochMilliseconds: () => number = Date.now,
) {
  return createCryptoIdentity({ getRandomValues }, epochMilliseconds);
}
