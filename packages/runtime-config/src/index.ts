export const environments = Object.freeze([
  'local',
  'ci',
  'integration',
  'staging',
  'production',
] as const);
export type Environment = (typeof environments)[number];
export const featureNames = Object.freeze([
  'importReview',
  'documentReview',
  'reports',
  'cloudSync',
  'workspaceMigration',
] as const);
export type Feature = (typeof featureNames)[number];
export type Features = Readonly<Record<Feature, boolean>>;
export type RuntimeConfiguration = Readonly<{
  format_version: 1;
  environment: Environment;
  revision: number;
  features: Features;
}>;
export type FeatureContext = Readonly<{
  surface: 'web' | 'desktop' | 'mobile' | 'api' | 'worker';
  authority: 'local' | 'cloud';
}>;
export type Section =
  | 'overview'
  | 'movements'
  | 'accounts'
  | 'imports'
  | 'documents'
  | 'reports'
  | 'settings';
export class ConfigurationError extends Error {
  constructor() {
    super('RUNTIME_CONFIGURATION_INVALID');
    this.name = 'ConfigurationError';
  }
}
export class FeatureUnavailableError extends Error {
  constructor() {
    super('FEATURE_UNAVAILABLE');
    this.name = 'FeatureUnavailableError';
  }
}
export class FeatureAccessDeniedError extends Error {
  constructor() {
    super('FEATURE_ACCESS_DENIED');
    this.name = 'FeatureAccessDeniedError';
  }
}
function invalid(): never {
  throw new ConfigurationError();
}
export function requireEnvironment(value: unknown): Environment {
  if (typeof value !== 'string' || !environments.includes(value as Environment))
    invalid();
  return value as Environment;
}
// Only plain own data fields: no accessors, inherited configuration or toJSON.
function fields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    invalid();
  }
}
const validated = new WeakSet<object>();
function snapshot(
  environment: Environment,
  revision: number,
  features: Features,
): RuntimeConfiguration {
  const value = Object.freeze({
    format_version: 1 as const,
    environment,
    revision,
    features: Object.freeze({ ...features }),
  });
  validated.add(value);
  return value;
}
export function disabledConfiguration(
  environment: Environment,
  revision = 0,
): RuntimeConfiguration {
  requireEnvironment(environment);
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2147483647)
    invalid();
  return snapshot(
    environment,
    revision,
    Object.fromEntries(featureNames.map((name) => [name, false])) as Record<
      Feature,
      boolean
    >,
  );
}
export function parseConfiguration(
  value: unknown,
  expectedEnvironment: Environment,
): RuntimeConfiguration {
  requireEnvironment(expectedEnvironment);
  const root = fields(value);
  if (
    Object.keys(root).sort().join(',') !==
      'environment,features,format_version,revision' ||
    root.format_version !== 1 ||
    root.environment !== expectedEnvironment ||
    typeof root.revision !== 'number' ||
    !Number.isSafeInteger(root.revision) ||
    root.revision < 0 ||
    root.revision > 2147483647
  )
    invalid();
  const input = fields(root.features);
  if (Object.keys(input).some((key) => !featureNames.includes(key as Feature)))
    invalid();
  const features = { ...disabledConfiguration(expectedEnvironment).features };
  for (const name of featureNames) {
    if (Object.hasOwn(input, name)) {
      if (typeof input[name] !== 'boolean') invalid();
      features[name] = input[name];
    }
  }
  if (root.revision === 0 && Object.values(features).some(Boolean)) invalid();
  return snapshot(expectedEnvironment, root.revision, features);
}
export function decodeConfiguration(
  text: unknown,
  environment: Environment,
): RuntimeConfiguration {
  if (typeof text !== 'string' || text.length > 8192) invalid();
  try {
    return parseConfiguration(JSON.parse(text), environment);
  } catch {
    invalid();
  }
}
export function configurationFromEnvironment(
  environment: Environment,
  values: Readonly<Record<string, unknown>>,
): RuntimeConfiguration {
  requireEnvironment(environment);
  try {
    const expected = Object.getOwnPropertyDescriptor(values, 'FM_ENVIRONMENT');
    const payload = Object.getOwnPropertyDescriptor(
      values,
      'FM_RUNTIME_CONFIG',
    );
    if (
      (expected &&
        (!('value' in expected) || expected.value !== environment)) ||
      (payload && !('value' in payload))
    )
      invalid();
    return payload
      ? decodeConfiguration(payload.value, environment)
      : disabledConfiguration(environment);
  } catch {
    invalid();
  }
}
function supported(feature: Feature, context: FeatureContext): boolean {
  if (
    !context ||
    !['web', 'desktop', 'mobile', 'api', 'worker'].includes(context.surface) ||
    !['local', 'cloud'].includes(context.authority)
  )
    return false;
  if (context.authority === 'local' && context.surface !== 'desktop')
    return false;
  if (feature === 'cloudSync')
    return context.authority === 'cloud' && context.surface !== 'web';
  if (feature === 'workspaceMigration')
    return ['desktop', 'api', 'worker'].includes(context.surface);
  return true;
}
export function featureEnabled(
  configuration: RuntimeConfiguration,
  feature: Feature,
  context: FeatureContext,
): boolean {
  return (
    validated.has(configuration) &&
    featureNames.includes(feature) &&
    configuration.features[feature] === true &&
    supported(feature, context)
  );
}
export function enabledSections(
  configuration: RuntimeConfiguration,
  context: FeatureContext,
): readonly Section[] {
  const optional: Partial<Record<Section, Feature>> = {
    imports: 'importReview',
    documents: 'documentReview',
    reports: 'reports',
  };
  return Object.freeze(
    (
      [
        'overview',
        'movements',
        'accounts',
        'imports',
        'documents',
        'reports',
        'settings',
      ] as const
    ).filter(
      (section) =>
        !optional[section] ||
        featureEnabled(configuration, optional[section]!, context),
    ),
  );
}
export function createFeatureGate(environment: Environment, initial?: unknown) {
  requireEnvironment(environment);
  let current =
    initial === undefined
      ? disabledConfiguration(environment)
      : parseConfiguration(initial, environment);
  let highWater = current.revision;
  let healthy = true;
  const enabled = (feature: Feature, context: FeatureContext) =>
    featureEnabled(current, feature, context);
  return Object.freeze({
    snapshot: () => current,
    enabled,
    replace(value: unknown) {
      try {
        const next = parseConfiguration(value, environment);
        const same =
          next.revision === highWater &&
          JSON.stringify(next) === JSON.stringify(current);
        if (
          next.revision < highWater ||
          (next.revision === highWater && (!healthy || !same))
        )
          invalid();
        current = next;
        highWater = next.revision;
        healthy = true;
        return current;
      } catch {
        current = disabledConfiguration(environment, highWater);
        healthy = false;
        invalid();
      }
    },
    async execute<T>(
      feature: Feature,
      context: FeatureContext,
      authorize: () => boolean | Promise<boolean>,
      operation: () => T | Promise<T>,
    ): Promise<T> {
      const scope = Object.freeze({
        surface: context?.surface,
        authority: context?.authority,
      });
      if (!enabled(feature, scope)) throw new FeatureUnavailableError();
      if ((await authorize()) !== true) throw new FeatureAccessDeniedError();
      // A kill switch changed while authorization awaited: don't enter the operation.
      if (!enabled(feature, scope)) throw new FeatureUnavailableError();
      return await operation();
    },
  });
}
