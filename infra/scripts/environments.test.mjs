import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EnvironmentError,
  profileNames,
  validateProfiles,
  validateProfile,
  profileMetadata,
  composeModel,
  realmFixture,
  dockerEnvironment,
} from '../environments/model.mjs';
import {
  workspace,
  sourceDirectory,
  assertDirectory,
  withProfileLock,
} from '../environments/runtime.mjs';

const source = JSON.parse(
  readFileSync(
    new URL('../environments/profiles.json', import.meta.url),
    'utf8',
  ),
);
const copy = (value) => JSON.parse(JSON.stringify(value));
const owner = '00000000-0000-4000-8000-000000000014';
function rejects(action, code) {
  assert.throws(
    action,
    (error) =>
      error instanceof EnvironmentError &&
      error.code === code &&
      error.message === code,
  );
}

test('environment profiles accept only local synthetic deployments and distinct integer ports', () => {
  assert.equal(
    validateProfiles(copy(source)).profiles.staging.identity_port,
    44350,
  );
  for (const changed of [
    { ...source, synthetic_only: false },
    { ...source, deployment: 'remote' },
    { ...source, production: {} },
    {
      ...source,
      profiles: { ...source.profiles, production: source.profiles.local },
    },
  ])
    rejects(() => validateProfiles(changed), 'ENVIRONMENT_CONFIG_INVALID');
  for (const value of [44320, 0, 65536, '44322', 44322.5]) {
    const changed = copy(source);
    changed.profiles.local.database_port = value;
    rejects(() => validateProfiles(changed), 'ENVIRONMENT_PORT_INVALID');
  }
});

test('profiles reject unpinned images, mutable latest tags and unapproved registries', () => {
  for (const image of [
    'postgres:18.6-alpine',
    'postgres:latest',
    'registry.synthetic.invalid/postgres@sha256:' + 'a'.repeat(64),
  ]) {
    const changed = copy(source);
    changed.images.postgres = image;
    rejects(() => validateProfiles(changed), 'ENVIRONMENT_IMAGE_UNPINNED');
  }
});

test('profile selection cannot smuggle a path, production target or Compose name', () => {
  for (const profile of [
    'production',
    '../local',
    'LOCAL',
    'local;noop',
    'local\n',
    null,
  ])
    rejects(() => validateProfile(profile), 'ENVIRONMENT_PROFILE_INVALID');
  rejects(
    () => profileMetadata(source, 'local', 'invalid-owner'),
    'ENVIRONMENT_OWNER_INVALID',
  );
});

test('generated Compose models provide exclusive project identities and loopback-only port bindings', () => {
  const names = new Set(),
    ports = new Set();
  for (const profile of profileNames) {
    const metadata = profileMetadata(source, profile, owner);
    const model = composeModel(
      source,
      metadata,
      path.join(workspace, '.tools/environments', profile),
      sourceDirectory,
    );
    assert.ok(!names.has(model.name));
    names.add(model.name);
    assert.equal(model.networks.isolated.internal, true);
    for (const service of Object.values(model.services)) {
      assert.equal(service.labels['io.financial-manager.owner'], owner);
      assert.equal(service.labels['io.financial-manager.synthetic'], 'true');
      for (const binding of service.ports ?? []) {
        assert.ok(binding.startsWith('127.0.0.1:'));
        assert.ok(!ports.has(binding));
        ports.add(binding);
      }
    }
  }
});

test('HTTP backends have no public route and database ingress is separate from HTTPS ingress', () => {
  const model = composeModel(
    source,
    profileMetadata(source, 'integration', owner),
    path.join(workspace, '.tools/environments/integration'),
    sourceDirectory,
  );
  assert.deepEqual(model.services.identity.networks, ['isolated']);
  assert.equal(model.services.identity.ports, undefined);
  assert.deepEqual(model.services.mail.networks, ['isolated']);
  assert.equal(model.services.mail.ports, undefined);
  assert.deepEqual(model.services.edge.networks, ['isolated', 'entry']);
  assert.deepEqual(model.services.postgres.networks, [
    'isolated',
    'database_entry',
  ]);
  assert.deepEqual(model.services.edge.cap_add, ['NET_BIND_SERVICE']);
});

test('database credentials use protected file mounts rather than Compose environment or command values', () => {
  const model = composeModel(
    source,
    profileMetadata(source, 'local', owner),
    path.join(workspace, '.tools/environments/local'),
    sourceDirectory,
  );
  for (const service of Object.values(model.services)) {
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.ok((service.tmpfs ?? []).length > 0);
    assert.ok(
      Object.entries(service.environment ?? {}).every(
        ([key]) => !key.endsWith('_PASSWORD') && !key.endsWith('_SECRET'),
      ),
    );
    for (const mount of service.volumes ?? []) {
      assert.equal(mount.type, 'bind');
      assert.equal(mount.read_only, true);
      assert.ok(!mount.source.includes('docker.sock'));
    }
  }
  assert.equal(model.services.postgres.user, '70:70');
  assert.equal(model.services.postgres.read_only, true);
  assert.equal(model.services.identity.environment.KC_DB, 'postgres');
  assert.ok(!model.services.identity.command.join(' ').includes('start-dev'));
});

test('profile OIDC metadata has exact redirect targets, no synthetic account password or wildcard', () => {
  for (const profile of profileNames) {
    const metadata = profileMetadata(source, profile, owner),
      realm = realmFixture(metadata);
    assert.equal(realm.realm, 'fm-' + profile);
    assert.equal(realm.sslRequired, 'all');
    assert.deepEqual(realm.users, []);
    assert.equal(realm.clients[0].directAccessGrantsEnabled, false);
    assert.equal(realm.clients[0].serviceAccountsEnabled, false);
    assert.equal(
      realm.clients[0].attributes['pkce.code.challenge.method'],
      'S256',
    );
    assert.deepEqual(realm.clients[0].redirectUris, [
      `https://127.0.0.1:${metadata.identity_port}/synthetic-callback`,
    ]);
    assert.equal(realm.smtpServer.host, 'mail');
  }
});

test('ambient Docker, Compose, cloud and PostgreSQL variables cannot override a generated stack', () => {
  const safe = dockerEnvironment({
    PATH: 'synthetic-path',
    SystemRoot: 'synthetic-root',
    HOME: 'synthetic-home',
    DOCKER_HOST: 'tcp://synthetic.invalid',
    DOCKER_CONTEXT: 'remote',
    DOCKER_CONFIG: 'synthetic-credentials',
    COMPOSE_FILE: 'untrusted.yaml',
    COMPOSE_PROJECT_NAME: 'unrelated',
    COMPOSE_PROFILES: 'production',
    COMPOSE_ENV_FILES: '.env',
    AWS_SECRET_ACCESS_KEY: 'synthetic',
    PGPASSWORD: 'synthetic',
    NODE_OPTIONS: 'synthetic',
    FM_ENV_PROFILE: 'production',
  });
  assert.deepEqual(safe, {
    PATH: 'synthetic-path',
    SystemRoot: 'synthetic-root',
    HOME: 'synthetic-home',
  });
});

test('Compose path interpolation escapes dollar characters without changing the supplied directory', () => {
  const directory = path.join(workspace, '.tools/synthetic-$dollar');
  const model = composeModel(
    source,
    profileMetadata(source, 'local', owner),
    directory,
    sourceDirectory,
  );
  assert.ok(
    model.services.postgres.volumes[0].source.includes('synthetic-$$dollar'),
  );
  rejects(
    () =>
      composeModel(
        source,
        profileMetadata(source, 'local', owner),
        'relative',
        sourceDirectory,
      ),
    'ENVIRONMENT_PATH_INVALID',
  );
});

test('managed paths refuse traversal and directory junctions before any external file is written', () => {
  rejects(
    () => assertDirectory(path.resolve(workspace, '../outside')),
    'ENVIRONMENT_PATH_INVALID',
  );
  const external = mkdtempSync(path.join(tmpdir(), 'fm-us014-synthetic-'));
  const internal = path.join(workspace, '.tools', 'us014-path-' + randomUUID());
  mkdirSync(internal);
  const link = path.join(internal, 'junction');
  try {
    symlinkSync(
      external,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    rejects(
      () => assertDirectory(path.join(link, 'must-not-exist')),
      'ENVIRONMENT_PATH_INVALID',
    );
  } finally {
    unlinkSync(link);
    rmdirSync(internal);
    rmdirSync(external);
  }
});

test('profile operations are mutually exclusive and release their lease after failure', async () => {
  await withProfileLock('integration', async () => {
    await assert.rejects(
      withProfileLock('integration', async () => assert.fail('must not enter')),
      (error) => error.code === 'ENVIRONMENT_PROFILE_BUSY',
    );
  });
  await assert.rejects(
    withProfileLock('integration', async () => {
      throw new EnvironmentError('ENVIRONMENT_SYNTHETIC_FAILURE');
    }),
    /ENVIRONMENT_SYNTHETIC_FAILURE/,
  );
  assert.equal(await withProfileLock('integration', async () => true), true);
});
