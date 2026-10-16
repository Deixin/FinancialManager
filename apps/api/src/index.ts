import { createObservability } from '@financial-manager/observability';
import type { ObservabilityOptions } from '@financial-manager/observability';

export const createApiObservability = (
  options: Omit<ObservabilityOptions, 'service'>,
) => createObservability({ ...options, service: 'api' });
