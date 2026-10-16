import { createObservability } from '@financial-manager/observability';
export { createApiIdentity } from './identity.js';
export { createApiFeatures } from './features.js';
import type { ObservabilityOptions } from '@financial-manager/observability';

export const createApiObservability = (
  options: Omit<ObservabilityOptions, 'service'>,
) => createObservability({ ...options, service: 'api' });
