import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  profileNames,
  validateProfile,
  profileMetadata,
  composeModel,
  EnvironmentError,
} from '../environments/model.mjs';
import {
  manifest,
  localDocker,
  startProfile,
  stopProfile,
  verifyProfile,
  workspace,
  sourceDirectory,
} from '../environments/runtime.mjs';
import { homologateEnvironments } from '../environments/homologate.mjs';
import { validateEnvironmentEvidence } from './environments-evidence.mjs';

try {
  const { values, positionals } = parseArgs({
    options: { profile: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  const [action] = positionals;
  if (
    positionals.length !== 1 ||
    !['check', 'up', 'verify', 'down', 'test'].includes(action) ||
    ['up', 'verify', 'down'].includes(action) !== Boolean(values.profile)
  )
    throw new EnvironmentError('ENVIRONMENT_ARGUMENTS_INVALID');
  if (action === 'check') {
    for (const profile of profileNames)
      composeModel(
        manifest,
        profileMetadata(manifest, profile, randomUUID()),
        path.join(workspace, '.tools/environments', profile),
        sourceDirectory,
      );
    console.log(
      'US-014 configuration OK: four synthetic Docker-local profiles, pinned images and distinct ports.',
    );
  } else {
    if (values.profile) validateProfile(values.profile);
    const session = await localDocker();
    if (action === 'up') {
      await startProfile(session, values.profile);
      await verifyProfile(session, values.profile);
      console.log('US-014 ' + values.profile + ': ready (synthetic only).');
    }
    if (action === 'verify') {
      await verifyProfile(session, values.profile);
      console.log('US-014 ' + values.profile + ': verified.');
    }
    if (action === 'down') {
      await stopProfile(session, values.profile);
      console.log('US-014 ' + values.profile + ': owned resources removed.');
    }
    if (action === 'test') {
      const report = await homologateEnvironments(session, {
        progress: (stage) => console.log('US-014 check: ' + stage),
      });
      if (report.passed) validateEnvironmentEvidence(report);
      const directory = path.join(workspace, '.tools/environments-reports');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, 'latest.json'),
        JSON.stringify(report, null, 2) + '\n',
        { mode: 0o600 },
      );
      if (!report.passed)
        throw new EnvironmentError(
          report.failure_code ?? 'ENVIRONMENT_TEST_FAILED',
        );
      console.log(
        'US-014: four profiles verified; owned services, networks and secrets removed.',
      );
    }
  }
} catch (error) {
  console.error(
    error instanceof EnvironmentError
      ? error.code
      : 'ENVIRONMENT_OPERATION_FAILED',
  );
  process.exitCode = 1;
}
