import { createV1Client } from '@financial-manager/contracts';
import type { NativeClientOptions } from '@financial-manager/contracts';

/** The session adapter supplies the current access token; no token persistence here. */
export function createMobileApiClient(options: NativeClientOptions) {
  return createV1Client({ ...options, profile: 'NATIVE' });
}
