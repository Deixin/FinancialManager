import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import {
  environments,
  featureNames,
  disabledConfiguration,
  parseConfiguration,
  decodeConfiguration,
  configurationFromEnvironment,
  featureEnabled,
  enabledSections,
  createFeatureGate,
} from '../../packages/runtime-config/dist/index.js';
import { createApiFeatures } from '../../apps/api/dist/index.js';
import { createWorkerFeatures } from '../../apps/worker/dist/index.js';
import { createWebShellModel } from '../../apps/web/dist/index.js';
import { createDesktopShellModel } from '../../apps/desktop/dist/index.js';
import { createMobileShellModel } from '../../apps/mobile/dist/index.js';

// Configuration/identity canaries are synthetic; no financial or personal data.
const canary = 'SYNTHETIC_PRIVATE_CONFIGURATION_DO_NOT_EXPOSE';
const value = (revision = 1, features = { importReview: true }) => ({
  format_version: 1,
  environment: 'staging',
  revision,
  features,
});
const cloud = Object.freeze({ surface: 'api', authority: 'cloud' });
const invalid = { message: 'RUNTIME_CONFIGURATION_INVALID' };

test('five versioned bootstrap profiles parse with all incomplete features disabled', () => {
  for (const environment of environments) {
    const config = decodeConfiguration(
      readFileSync(
        new URL('../config/profiles/' + environment + '.json', import.meta.url),
        'utf8',
      ),
      environment,
    );
    assert.equal(config.environment, environment);
    assert.ok(
      featureNames.every((feature) => config.features[feature] === false),
    );
  }
});
test('configuration defaults are complete, immutable and independent of runtime globals', () => {
  const config = disabledConfiguration('local');
  assert.deepEqual(Object.keys(config.features), featureNames);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.features));
  assert.throws(() => {
    config.features.reports = true;
  }, TypeError);
  assert.deepEqual(
    enabledSections(config, { surface: 'desktop', authority: 'local' }),
    ['overview', 'movements', 'accounts', 'settings'],
  );
});
test('strict parsing rejects unknown keys, types, environment mixups and changes to scope', () => {
  for (const config of [
    { ...value(), environment: 'production' },
    { ...value(), format_version: 2 },
    { ...value(), private: canary },
    value(1, { externalAi: true }),
    value(1, { openFinance: true }),
    value(1, { reports: 'true' }),
    value(1, { reports: 1 }),
    value(1, { reports: null }),
    value(0, { reports: true }),
    value(-1),
    value(1.5),
    value(Number.MAX_SAFE_INTEGER),
    { ...value(), offlineLeaseDays: 7 },
    [],
    null,
  ])
    assert.throws(() => parseConfiguration(config, 'staging'), invalid);
  for (const text of [
    'invalid',
    'x'.repeat(8193),
    JSON.stringify({ ...value(), secret: canary }),
  ])
    assert.throws(() => decodeConfiguration(text, 'staging'), invalid);
});
test('configuration snapshots fields without executing accessors, toJSON or inherited settings', () => {
  let called = false;
  const getter = { ...value() };
  Object.defineProperty(getter, 'features', {
    get() {
      called = true;
      throw new Error(canary);
    },
  });
  assert.throws(() => parseConfiguration(getter, 'staging'), invalid);
  assert.throws(
    () =>
      parseConfiguration(
        {
          ...value(),
          toJSON() {
            called = true;
            return canary;
          },
        },
        'staging',
      ),
    invalid,
  );
  assert.throws(
    () => parseConfiguration(Object.create(value()), 'staging'),
    invalid,
  );
  assert.throws(
    () =>
      parseConfiguration(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error(canary);
            },
          },
        ),
        'staging',
      ),
    invalid,
  );
  assert.equal(called, false);
  const mutable = value();
  const config = parseConfiguration(mutable, 'staging');
  mutable.features.importReview = false;
  assert.equal(config.features.importReview, true);
});
test('environment adapter consumes only explicit public keys and never includes private values', () => {
  for (const hostile of [
    null,
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(canary);
        },
      },
    ),
  ])
    assert.throws(
      () => configurationFromEnvironment('staging', hostile),
      invalid,
    );
  const input = {
    FM_ENVIRONMENT: 'staging',
    FM_RUNTIME_CONFIG: JSON.stringify(value()),
    DATABASE_PASSWORD: canary,
    OIDC_CLIENT_SECRET: canary,
    NODE_ENV: 'production',
    NEXT_PUBLIC_REPORTS: 'true',
  };
  const config = configurationFromEnvironment('staging', input);
  assert.equal(config.features.importReview, true);
  assert.equal(config.features.reports, false);
  assert.equal(JSON.stringify(config).includes(canary), false);
  assert.deepEqual(
    configurationFromEnvironment('local', {
      NODE_ENV: 'production',
      NEXT_PUBLIC_REPORTS: 'true',
    }),
    disabledConfiguration('local'),
  );
  assert.throws(
    () => configurationFromEnvironment('production', input),
    invalid,
  );
  assert.throws(
    () =>
      configurationFromEnvironment('staging', { FM_RUNTIME_CONFIG: canary }),
    invalid,
  );
});
test('feature context cannot grant Web local authority, native migration or Local cloud sync', () => {
  const config = parseConfiguration(
    value(1, Object.fromEntries(featureNames.map((name) => [name, true]))),
    'staging',
  );
  assert.equal(
    featureEnabled(config, 'cloudSync', {
      surface: 'desktop',
      authority: 'local',
    }),
    false,
  );
  assert.equal(
    featureEnabled(config, 'cloudSync', { surface: 'web', authority: 'cloud' }),
    false,
  );
  assert.equal(
    featureEnabled(config, 'workspaceMigration', {
      surface: 'mobile',
      authority: 'cloud',
    }),
    false,
  );
  assert.equal(
    featureEnabled(config, 'reports', { surface: 'web', authority: 'local' }),
    false,
  );
  assert.equal(
    featureEnabled(config, 'cloudSync', {
      surface: 'mobile',
      authority: 'cloud',
    }),
    true,
  );
  assert.equal(featureEnabled(config, 'externalAi', cloud), false);
  assert.equal(
    featureEnabled(JSON.parse(JSON.stringify(config)), 'reports', cloud),
    false,
  );
});
test('live updates are atomic, canonical and monotonic without mutating older snapshots', () => {
  const gate = createFeatureGate('staging', value());
  const first = gate.snapshot();
  assert.equal(gate.enabled('importReview', cloud), true);
  gate.replace({
    features: { importReview: true },
    revision: 1,
    environment: 'staging',
    format_version: 1,
  });
  gate.replace(value(2, { importReview: false, reports: true }));
  assert.equal(gate.enabled('importReview', cloud), false);
  assert.equal(gate.enabled('reports', cloud), true);
  assert.equal(first.features.importReview, true);
});
test('invalid, stale or conflicting revisions fail closed until a higher valid revision arrives', () => {
  for (const bad of [
    null,
    value(1, { reports: true }),
    value(0, {}),
    { ...value(2), secret: canary },
  ]) {
    const gate = createFeatureGate('staging', value());
    assert.throws(() => gate.replace(bad), invalid);
    assert.ok(
      featureNames.every((feature) => !gate.snapshot().features[feature]),
    );
    assert.throws(() => gate.replace(value()), invalid);
    gate.replace(value(2));
    assert.equal(gate.enabled('importReview', cloud), true);
  }
});
test('disabled features and denied authorization never execute application handlers', async () => {
  let calls = 0;
  const gate = createFeatureGate('staging');
  await assert.rejects(
    gate.execute(
      'importReview',
      cloud,
      () => true,
      () => {
        calls++;
      },
    ),
    { message: 'FEATURE_UNAVAILABLE' },
  );
  gate.replace(value());
  for (const answer of [false, 'true', undefined])
    await assert.rejects(
      gate.execute(
        'importReview',
        cloud,
        () => answer,
        () => {
          calls++;
        },
      ),
      { message: 'FEATURE_ACCESS_DENIED' },
    );
  assert.equal(calls, 0);
  assert.equal(
    await gate.execute(
      'importReview',
      cloud,
      () => true,
      () => {
        calls++;
        return 'synthetic-complete';
      },
    ),
    'synthetic-complete',
  );
  assert.equal(calls, 1);
});
test('a flag disabled while authorization awaited blocks entry into the operation', async () => {
  const gate = createFeatureGate('staging', value());
  let authorize,
    entered = false;
  const pending = gate.execute(
    'importReview',
    cloud,
    () =>
      new Promise((resolve) => {
        authorize = resolve;
      }),
    () => {
      entered = true;
    },
  );
  gate.replace(value(2, {}));
  authorize(true);
  await assert.rejects(pending, { message: 'FEATURE_UNAVAILABLE' });
  assert.equal(entered, false);
});
test('flags do not abort already-entered work, consume queues or replace business errors', async () => {
  const gate = createFeatureGate('staging', value());
  assert.equal(
    await gate.execute(
      'importReview',
      cloud,
      () => true,
      () => {
        gate.replace(value(2, {}));
        return 'committed-synthetic-operation';
      },
    ),
    'committed-synthetic-operation',
  );
  const error = new Error(canary);
  gate.replace(value(3));
  await assert.rejects(
    gate.execute(
      'importReview',
      cloud,
      () => true,
      () => {
        throw error;
      },
    ),
    (actual) => actual === error,
  );
});
test('configured Web/Desktop/Mobile models omit disabled sections and refuse disabled deep links', () => {
  const config = disabledConfiguration('local');
  const local = {
    workspace: { id: 'synthetic-local', name: 'Synthetic', mode: 'local' },
    route: 'overview',
    state: 'ready',
  };
  const cloudInput = {
    ...local,
    workspace: { ...local.workspace, mode: 'cloud' },
  };
  for (const [factory, input] of [
    [createDesktopShellModel, local],
    [createWebShellModel, cloudInput],
    [createMobileShellModel, cloudInput],
  ]) {
    assert.deepEqual(
      factory(input, config).navigation.map((item) => item.id),
      ['overview', 'movements', 'accounts', 'settings'],
    );
    assert.throws(() => factory({ ...input, route: 'imports' }, config), {
      message: 'UI_SHELL_INVALID',
    });
  }
});
test('configured navigation can enable one optional section without unrelated capabilities', () => {
  const config = parseConfiguration(value(1, { reports: true }), 'staging');
  assert.deepEqual(
    enabledSections(config, { surface: 'desktop', authority: 'local' }),
    ['overview', 'movements', 'accounts', 'reports', 'settings'],
  );
  assert.equal(
    featureEnabled(config, 'cloudSync', {
      surface: 'desktop',
      authority: 'local',
    }),
    false,
  );
});
test('worker execution rechecks queued work and leaves disabled jobs unexecuted', async () => {
  const worker = createWorkerFeatures('staging', {
    FM_RUNTIME_CONFIG: JSON.stringify(value()),
  });
  let ran = false;
  const queued = () =>
    worker.execute(
      'importReview',
      () => true,
      () => {
        ran = true;
      },
    );
  worker.replace(value(2, {}));
  await assert.rejects(queued(), { message: 'FEATURE_UNAVAILABLE' });
  assert.equal(ran, false);
});
test(
  'real synthetic HTTP rejects forged client enabling and respects the server kill switch',
  { timeout: 10000 },
  async (t) => {
    const api = createApiFeatures('staging', {});
    let calls = 0;
    const server = createServer(async (request, response) => {
      try {
        await api.execute(
          'importReview',
          () => request.headers['x-synthetic-authorized'] === 'yes',
          () => {
            calls++;
          },
        );
        response.writeHead(204).end();
      } catch (error) {
        response
          .writeHead(error.message === 'FEATURE_UNAVAILABLE' ? 503 : 403, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          })
          .end(JSON.stringify({ code: error.message }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}/synthetic?importReview=true`;
    assert.equal(
      (
        await globalThis.fetch(url, {
          headers: {
            'x-synthetic-authorized': 'yes',
            'x-feature-import-review': 'true',
          },
        })
      ).status,
      503,
    );
    api.replace(value());
    assert.equal((await globalThis.fetch(url)).status, 403);
    assert.equal(
      (
        await globalThis.fetch(url, {
          headers: { 'x-synthetic-authorized': 'yes' },
        })
      ).status,
      204,
    );
    api.replace(value(2, {}));
    const denied = await globalThis.fetch(url, {
      headers: { 'x-synthetic-authorized': 'yes' },
    });
    assert.equal(denied.status, 503);
    assert.deepEqual(await denied.json(), { code: 'FEATURE_UNAVAILABLE' });
    assert.equal(calls, 1);
  },
);
