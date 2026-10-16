import { createV1Client } from '@financial-manager/contracts';
import type { NativeClientOptions } from '@financial-manager/contracts';

/** Explicit cloud access only; the local Desktop workspace does not need this client. */
export function createDesktopCloudClient(options: NativeClientOptions) {
  return createV1Client({ ...options, profile: 'NATIVE' });
}
