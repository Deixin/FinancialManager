import { readFileSync } from 'node:fs';
import {
  environments,
  decodeConfiguration,
  featureNames,
} from '../../packages/runtime-config/dist/index.js';
try {
  for (const name of environments) {
    const config = decodeConfiguration(
      readFileSync(
        new URL('./profiles/' + name + '.json', import.meta.url),
        'utf8',
      ),
      name,
    );
    if (featureNames.some((feature) => config.features[feature]))
      throw new Error('PROFILE_FEATURE_NOT_READY');
  }
  console.log(
    'US-017 configuration OK: five profiles, all incomplete features disabled.',
  );
} catch {
  console.error('RUNTIME_CONFIGURATION_CHECK_FAILED');
  process.exitCode = 1;
}
