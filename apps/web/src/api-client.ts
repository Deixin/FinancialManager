import { createV1Client } from '@financial-manager/contracts';
import type { WebClientOptions } from '@financial-manager/contracts';

/** BFF credentials stay in same-origin cookies; no browser bearer token. */
export function createWebApiClient(options: WebClientOptions) {
  return createV1Client({ ...options, profile: 'WEB' });
}
