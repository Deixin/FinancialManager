import { createObservability } from '@financial-manager/observability';
export { createWorkerIdentity } from './identity.js';
export { createWorkerFeatures } from './features.js';
import type { ObservabilityOptions } from '@financial-manager/observability';

export const createWorkerObservability = (
  options: Omit<ObservabilityOptions, 'service'>,
) => createObservability({ ...options, service: 'worker' });
