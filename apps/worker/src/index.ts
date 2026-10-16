import { createObservability } from '@financial-manager/observability';
import type { ObservabilityOptions } from '@financial-manager/observability';

export const createWorkerObservability = (
  options: Omit<ObservabilityOptions, 'service'>,
) => createObservability({ ...options, service: 'worker' });
