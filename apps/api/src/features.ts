import {
  createFeatureGate,
  configurationFromEnvironment,
} from '@financial-manager/runtime-config';
import type { Environment, Feature } from '@financial-manager/runtime-config';

export function createApiFeatures(
  environment: Environment,
  values: Readonly<Record<string, unknown>>,
) {
  const gate = createFeatureGate(
    environment,
    configurationFromEnvironment(environment, values),
  );
  return Object.freeze({
    snapshot: gate.snapshot,
    replace: gate.replace,
    execute<T>(
      feature: Feature,
      authorize: () => boolean | Promise<boolean>,
      operation: () => T | Promise<T>,
    ) {
      return gate.execute(
        feature,
        { surface: 'api', authority: 'cloud' },
        authorize,
        operation,
      );
    },
  });
}
