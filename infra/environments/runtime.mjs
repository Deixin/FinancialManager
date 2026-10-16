/* global setTimeout, clearTimeout */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  chmodSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';
import pg from 'pg';
import {
  EnvironmentError,
  requireEnvironment as ensure,
  validateProfiles,
  validateProfile,
  profileMetadata,
  composeModel,
  realmFixture,
  dockerEnvironment,
} from './model.mjs';

export const workspace = fileURLToPath(new URL('../../', import.meta.url));
export const sourceDirectory = path.join(workspace, 'infra/environments');
export const manifest = validateProfiles(
  JSON.parse(readFileSync(path.join(sourceDirectory, 'profiles.json'), 'utf8')),
);
const control = path.join(workspace, '.tools/environments');
const ownedFiles = [
  'state.json',
  'profile.json',
  'bootstrap-password',
  'identity-password',
  'runtime-password',
  'realm.json',
  'compose.json',
  'empty.env',
  'ca.pem',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const sourceHashes = () =>
  Object.fromEntries(
    [
      'profiles.json',
      'model.mjs',
      'runtime.mjs',
      '0001-foundation.sql',
      'Caddyfile',
      'homologate.mjs',
      '../scripts/run-environments.mjs',
      '../scripts/environments-evidence.mjs',
      '../../package.json',
      '../../pnpm-lock.yaml',
      '../../.github/workflows/ci.yml',
    ].map((name) => [
      name,
      hash(readFileSync(path.join(sourceDirectory, name))),
    ]),
  );

export async function runTool(
  command,
  args,
  { environment = dockerEnvironment(process.env), timeout = 30000 } = {},
) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspace,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      size = 0,
      stopped = false;
    const fail = (code) => {
      if (!stopped) {
        stopped = true;
        child.kill();
        reject(new EnvironmentError(code));
      }
    };
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) fail('ENVIRONMENT_TOOL_OUTPUT_LIMIT');
      else output += chunk.toString();
    });
    child.stderr.resume();
    const timer = setTimeout(() => fail('ENVIRONMENT_TOOL_TIMEOUT'), timeout);
    child.once('error', () => {
      clearTimeout(timer);
      fail('ENVIRONMENT_TOOL_UNAVAILABLE');
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (!stopped) {
        stopped = true;
        if (code === 0) resolve(output);
        else reject(new EnvironmentError('ENVIRONMENT_TOOL_FAILED'));
      }
    });
  });
}
export async function localDocker() {
  ensure(
    !process.env.DOCKER_HOST &&
      !process.env.DOCKER_CONTEXT &&
      !process.env.DOCKER_CONFIG,
    'ENVIRONMENT_DOCKER_OVERRIDE_REFUSED',
  );
  const context = (await runTool('docker', ['context', 'show'])).trim();
  ensure(
    /^[a-zA-Z0-9_.-]+$/.test(context),
    'ENVIRONMENT_DOCKER_CONTEXT_INVALID',
  );
  const host = JSON.parse(
    await runTool('docker', [
      'context',
      'inspect',
      context,
      '--format',
      '{{json .Endpoints.docker.Host}}',
    ]),
  );
  ensure(
    typeof host === 'string' &&
      (host.startsWith('unix:///') || host.startsWith('npipe://')),
    'ENVIRONMENT_REMOTE_DOCKER_REFUSED',
  );
  const docker = (args, options) =>
    runTool('docker', ['--context', context, ...args], options);
  ensure(
    (await docker(['info', '--format', '{{.OSType}}'])).trim() === 'linux',
    'ENVIRONMENT_LINUX_DOCKER_REQUIRED',
  );
  const versions = {
    node: process.versions.node,
    docker: (
      await docker(['version', '--format', '{{.Server.Version}}'])
    ).trim(),
    compose: (await docker(['compose', 'version', '--short']))
      .trim()
      .replace(/^v/, ''),
  };
  ensure(
    /^\d+\.\d+\.\d+/.test(versions.docker) &&
      /^\d+\.\d+\.\d+/.test(versions.compose),
    'ENVIRONMENT_TOOL_VERSION_INVALID',
  );
  return { docker, versions };
}
export function assertDirectory(directory) {
  const relative = path.relative(workspace, directory);
  ensure(
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative),
    'ENVIRONMENT_PATH_INVALID',
  );
  let current = workspace;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    ensure(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'ENVIRONMENT_PATH_INVALID',
    );
    const resolved = path.relative(
      realpathSync(workspace),
      realpathSync(current),
    );
    ensure(
      resolved !== '' &&
        !resolved.startsWith('..') &&
        !path.isAbsolute(resolved),
      'ENVIRONMENT_PATH_INVALID',
    );
  }
}
async function protectControl() {
  assertDirectory(control);
  if (process.platform !== 'win32') chmodSync(control, 0o700);
  if (process.platform === 'win32') {
    const identity = await runTool('whoami', ['/user', '/fo', 'csv', '/nh']);
    const sid = identity.match(/S-1-5-[0-9-]+/)?.[0];
    ensure(sid, 'ENVIRONMENT_PRIVATE_DIRECTORY_FAILED');
    await runTool('icacls', [
      control,
      '/inheritance:r',
      '/grant:r',
      `*${sid}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ]);
  }
}
export async function withProfileLock(profile, operation) {
  validateProfile(profile);
  await protectControl();
  const filename = path.join(control, `lock-${profile}`),
    lease = randomUUID();
  if (existsSync(filename)) {
    ensure(
      lstatSync(filename).isFile() && !lstatSync(filename).isSymbolicLink(),
      'ENVIRONMENT_LOCK_INVALID',
    );
    let previous;
    try {
      previous = JSON.parse(readFileSync(filename, 'utf8'));
    } catch {
      throw new EnvironmentError('ENVIRONMENT_LOCK_INVALID');
    }
    ensure(
      Number.isInteger(previous.pid) &&
        previous.pid > 0 &&
        typeof previous.lease === 'string',
      'ENVIRONMENT_LOCK_INVALID',
    );
    let absent = false;
    try {
      process.kill(previous.pid, 0);
    } catch (error) {
      absent = error.code === 'ESRCH';
    }
    ensure(absent, 'ENVIRONMENT_PROFILE_BUSY');
    rmSync(filename);
  }
  writeFileSync(filename, JSON.stringify({ pid: process.pid, lease }), {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    return await operation();
  } finally {
    if (JSON.parse(readFileSync(filename, 'utf8')).lease === lease)
      rmSync(filename);
  }
}
function paths(profile) {
  validateProfile(profile);
  return { directory: path.join(control, profile) };
}
function readState(profile, { forCleanup = false } = {}) {
  const { directory } = paths(profile);
  assertDirectory(directory);
  const stateFile = path.join(directory, 'state.json');
  if (!existsSync(stateFile)) {
    ensure(
      readdirSync(directory).length === 0,
      'ENVIRONMENT_ARTIFACTS_UNKNOWN',
    );
    return null;
  }
  ensure(
    lstatSync(stateFile).isFile() && !lstatSync(stateFile).isSymbolicLink(),
    'ENVIRONMENT_STATE_INVALID',
  );
  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    throw new EnvironmentError('ENVIRONMENT_STATE_INVALID');
  }
  ensure(
    state.format_version === 1 &&
      state.synthetic_only === true &&
      state.profile === profile &&
      /^[a-f0-9]{64}$/.test(state.compose_hash),
    'ENVIRONMENT_STATE_INVALID',
  );
  const metadata = profileMetadata(manifest, profile, state.owner);
  ensure(metadata.project === state.project, 'ENVIRONMENT_STATE_INVALID');
  if (forCleanup) {
    for (const name of readdirSync(directory))
      ensure(
        ownedFiles.includes(name) &&
          lstatSync(path.join(directory, name)).isFile() &&
          !lstatSync(path.join(directory, name)).isSymbolicLink(),
        'ENVIRONMENT_ARTIFACTS_UNKNOWN',
      );
    const compose = JSON.stringify(
      composeModel(manifest, metadata, directory, sourceDirectory),
    );
    ensure(hash(compose) === state.compose_hash, 'ENVIRONMENT_CONFIG_DRIFT');
    if (existsSync(path.join(directory, 'compose.json')))
      ensure(
        hash(readFileSync(path.join(directory, 'compose.json'))) ===
          state.compose_hash,
        'ENVIRONMENT_CONFIG_DRIFT',
      );
    else
      writeFileSync(path.join(directory, 'compose.json'), compose, {
        flag: 'wx',
        mode: 0o600,
      });
    if (!existsSync(path.join(directory, 'empty.env')))
      writeFileSync(path.join(directory, 'empty.env'), '', {
        flag: 'wx',
        mode: 0o600,
      });
    return { state, metadata, directory };
  }
  for (const name of ownedFiles.filter((name) => name !== 'ca.pem')) {
    const filename = path.join(directory, name);
    ensure(
      existsSync(filename) &&
        lstatSync(filename).isFile() &&
        !lstatSync(filename).isSymbolicLink(),
      'ENVIRONMENT_ARTIFACTS_INVALID',
    );
  }
  ensure(
    hash(readFileSync(path.join(directory, 'compose.json'))) ===
      state.compose_hash,
    'ENVIRONMENT_CONFIG_DRIFT',
  );
  ensure(
    JSON.stringify(
      JSON.parse(readFileSync(path.join(directory, 'profile.json'), 'utf8')),
    ) === JSON.stringify(metadata),
    'ENVIRONMENT_CONFIG_DRIFT',
  );
  ensure(
    JSON.stringify(
      JSON.parse(readFileSync(path.join(directory, 'compose.json'), 'utf8')),
    ) ===
      JSON.stringify(
        composeModel(manifest, metadata, directory, sourceDirectory),
      ),
    'ENVIRONMENT_CONFIG_DRIFT',
  );
  for (const name of [
    'bootstrap-password',
    'identity-password',
    'runtime-password',
  ])
    ensure(
      /^[a-f0-9]{64}$/.test(readFileSync(path.join(directory, name), 'utf8')),
      'ENVIRONMENT_SECRET_INVALID',
    );
  return { state, metadata, directory };
}
function prepare(profile, owner = randomUUID()) {
  const existing = readState(profile);
  if (existing) return existing;
  const { directory } = paths(profile),
    metadata = profileMetadata(manifest, profile, owner);
  const write = (name, value, mode = 0o600) =>
    writeFileSync(path.join(directory, name), value, { flag: 'wx', mode });
  const compose = JSON.stringify(
    composeModel(manifest, metadata, directory, sourceDirectory),
  );
  const state = {
    format_version: 1,
    synthetic_only: true,
    profile,
    owner: metadata.owner,
    project: metadata.project,
    compose_hash: hash(compose),
  };
  // Ownership is recorded before creating secrets; down can recover partial setup.
  write('state.json', JSON.stringify(state));
  for (const name of [
    'bootstrap-password',
    'identity-password',
    'runtime-password',
  ])
    write(name, randomBytes(32).toString('hex'), 0o444);
  write('profile.json', JSON.stringify(metadata), 0o444);
  write('realm.json', JSON.stringify(realmFixture(metadata)), 0o444);
  write('empty.env', '');
  write('compose.json', compose);
  return { state, metadata, directory };
}
function composeFor(session, context) {
  return (...args) =>
    session.docker(
      [
        'compose',
        '--project-name',
        context.metadata.project,
        '--env-file',
        path.join(context.directory, 'empty.env'),
        '-f',
        path.join(context.directory, 'compose.json'),
        ...args,
      ],
      { timeout: 240000 },
    );
}
async function inspectOwned(session, context) {
  const { metadata } = context;
  const ids = (
    await session.docker([
      'ps',
      '-aq',
      '--filter',
      `label=com.docker.compose.project=${metadata.project}`,
    ])
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const containers = ids.length
    ? JSON.parse(await session.docker(['inspect', ...ids]))
    : [];
  for (const container of containers)
    ensure(
      container.Config.Labels['io.financial-manager.owner'] ===
        metadata.owner &&
        container.Config.Labels['io.financial-manager.environment'] ===
          metadata.profile &&
        container.Config.Labels['io.financial-manager.synthetic'] === 'true',
      'ENVIRONMENT_OWNERSHIP_MISMATCH',
    );
  const networks = (
    await session.docker([
      'network',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${metadata.project}`,
    ])
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (networks.length)
    for (const network of JSON.parse(
      await session.docker(['network', 'inspect', ...networks]),
    ))
      ensure(
        network.Labels['io.financial-manager.owner'] === metadata.owner,
        'ENVIRONMENT_OWNERSHIP_MISMATCH',
      );
  return containers;
}
export async function startProfile(
  session,
  profile,
  { exclusive = false, owner = randomUUID() } = {},
) {
  return await withProfileLock(profile, async () => {
    if (exclusive)
      ensure(!profileArtifactsExist(profile), 'ENVIRONMENT_PROFILE_IN_USE');
    const context = prepare(profile, owner),
      compose = composeFor(session, context);
    await inspectOwned(session, context);
    // Validate the generated model without reading an ambient .env or Compose overrides.
    await compose('config', '--quiet');
    await compose(
      'up',
      '-d',
      '--no-recreate',
      '--wait',
      '--wait-timeout',
      '180',
    );
    const ca = await compose(
      'exec',
      '-T',
      'edge',
      'cat',
      '/data/caddy/pki/authorities/local/root.crt',
    );
    ensure(
      ca.startsWith('-----BEGIN CERTIFICATE-----'),
      'ENVIRONMENT_TLS_NOT_READY',
    );
    writeFileSync(path.join(context.directory, 'ca.pem'), ca, { mode: 0o600 });
    return context.metadata;
  });
}
export async function stopProfile(session, profile, { owner } = {}) {
  return await withProfileLock(profile, async () => {
    const context = readState(profile, { forCleanup: true });
    if (!context) {
      rmdirSync(paths(profile).directory);
      return;
    }
    if (owner)
      ensure(
        context.metadata.owner === owner,
        'ENVIRONMENT_OWNERSHIP_MISMATCH',
      );
    await inspectOwned(session, context);
    await composeFor(session, context)('down', '--volumes', '--timeout', '10');
    ensure(
      (await inspectOwned(session, context)).length === 0,
      'ENVIRONMENT_CLEANUP_INCOMPLETE',
    );
    const remainingNetworks = (
      await session.docker([
        'network',
        'ls',
        '-q',
        '--filter',
        `label=com.docker.compose.project=${context.metadata.project}`,
      ])
    ).trim();
    ensure(!remainingNetworks, 'ENVIRONMENT_CLEANUP_INCOMPLETE');
    for (const name of readdirSync(context.directory))
      ensure(
        ownedFiles.includes(name) &&
          lstatSync(path.join(context.directory, name)).isFile() &&
          !lstatSync(path.join(context.directory, name)).isSymbolicLink(),
        'ENVIRONMENT_ARTIFACTS_UNKNOWN',
      );
    for (const name of ownedFiles)
      rmSync(path.join(context.directory, name), { force: true });
    // Nonrecursive removal: verified owned path, no unknown files may be discarded.
    rmdirSync(context.directory);
  });
}
export function profileArtifactsExist(profile) {
  return existsSync(path.join(paths(profile).directory, 'state.json'));
}
export function secretValues(profile) {
  const context = readState(profile);
  ensure(context, 'ENVIRONMENT_SETUP_REQUIRED');
  return Object.fromEntries(
    ['bootstrap', 'identity', 'runtime'].map((name) => [
      name,
      readFileSync(path.join(context.directory, name + '-password'), 'utf8'),
    ]),
  );
}
export function connectProfile(
  metadata,
  password,
  { user = 'fm_runtime', database = 'fm_app' } = {},
) {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: metadata.database_port,
    user,
    password,
    database,
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 1000,
    query_timeout: 10000,
    application_name: 'fm-synthetic-environment',
  });
  pool.on('error', () => {});
  pool.on('connect', (client) => client.on('error', () => {}));
  return pool;
}
export async function httpsJson(profile, url, { caProfile = profile } = {}) {
  const context = readState(caProfile);
  ensure(context, 'ENVIRONMENT_SETUP_REQUIRED');
  const ca = readFileSync(path.join(context.directory, 'ca.pem'));
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        ca,
        rejectUnauthorized: true,
        timeout: 5000,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let body = '',
          length = 0;
        res.on('data', (chunk) => {
          length += chunk.length;
          if (length > 1048576) req.destroy();
          else body += chunk.toString();
        });
        res.on('end', () => {
          try {
            ensure(res.statusCode === 200, 'ENVIRONMENT_ENDPOINT_UNHEALTHY');
            resolve(JSON.parse(body));
          } catch {
            reject(new EnvironmentError('ENVIRONMENT_ENDPOINT_UNHEALTHY'));
          }
        });
        res.on('error', () =>
          reject(new EnvironmentError('ENVIRONMENT_TLS_FAILED')),
        );
      },
    );
    req.once('timeout', () => req.destroy());
    req.once('error', () =>
      reject(new EnvironmentError('ENVIRONMENT_TLS_FAILED')),
    );
    req.end();
  });
}
export async function verifyProfile(session, profile) {
  return await withProfileLock(profile, async () => {
    const context = readState(profile);
    ensure(context, 'ENVIRONMENT_SETUP_REQUIRED');
    const containers = await inspectOwned(session, context),
      { metadata } = context;
    ensure(containers.length === 4, 'ENVIRONMENT_SERVICE_MISSING');
    for (const container of containers) {
      const service = container.Config.Labels['com.docker.compose.service'];
      ensure(
        container.Config.Image === manifest.images[service] &&
          container.State.Running &&
          !container.HostConfig.Privileged &&
          container.HostConfig.CapDrop.includes('ALL') &&
          container.Mounts.every((mount) => mount.Type !== 'volume'),
        'ENVIRONMENT_CONTAINER_UNSAFE',
      );
      const networks = Object.keys(container.NetworkSettings.Networks);
      ensure(
        networks.includes(metadata.project + '_isolated') &&
          networks.length ===
            (service === 'edge' || service === 'postgres' ? 2 : 1) &&
          (service !== 'edge' ||
            networks.includes(metadata.project + '_entry')) &&
          (service !== 'postgres' ||
            networks.includes(metadata.project + '_database_entry')),
        'ENVIRONMENT_NETWORK_UNSAFE',
      );
      const bindings = Object.values(
        container.HostConfig.PortBindings ?? {},
      ).flat();
      ensure(
        bindings.every((binding) => binding.HostIp === '127.0.0.1'),
        'ENVIRONMENT_PORT_UNSAFE',
      );
      const expectedPorts =
        service === 'edge'
          ? [metadata.identity_port, metadata.mail_port]
          : service === 'postgres'
            ? [metadata.database_port]
            : [];
      ensure(
        bindings
          .map((binding) => Number(binding.HostPort))
          .sort()
          .join(',') === expectedPorts.sort().join(','),
        'ENVIRONMENT_PORT_UNSAFE',
      );
      ensure(
        !container.Config.Env.some((value) => /PASSWORD=|SECRET=/.test(value)),
        'ENVIRONMENT_SECRET_EXPOSED',
      );
      ensure(
        Object.keys(container.HostConfig.Tmpfs ?? {}).length > 0,
        'ENVIRONMENT_STORAGE_UNSAFE',
      );
    }
    const [network] = JSON.parse(
      await session.docker([
        'network',
        'inspect',
        metadata.project + '_isolated',
      ]),
    );
    ensure(network.Internal === true, 'ENVIRONMENT_NETWORK_UNSAFE');
    const credentials = secretValues(profile),
      pool = connectProfile(metadata, credentials.runtime);
    let databaseVersion;
    try {
      const result = await pool.query(
        'SELECT profile,owner,schema_version FROM environment_probe.instance',
      );
      ensure(
        result.rowCount === 1 &&
          result.rows[0].profile === profile &&
          result.rows[0].owner === metadata.owner &&
          result.rows[0].schema_version === 1,
        'ENVIRONMENT_DATABASE_MISMATCH',
      );
      const role = (
        await pool.query(
          'SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user',
        )
      ).rows[0];
      ensure(
        Object.values(role).every((value) => value === false),
        'ENVIRONMENT_ROLE_UNSAFE',
      );
      databaseVersion = (await pool.query('SHOW server_version')).rows[0]
        .server_version;
      let denied = false;
      try {
        await pool.query('DELETE FROM environment_probe.instance');
      } catch (error) {
        denied = error.code === '42501';
      }
      ensure(denied, 'ENVIRONMENT_RUNTIME_WRITE_ALLOWED');
    } finally {
      await pool.end();
    }
    const identityPool = connectProfile(metadata, credentials.identity, {
      user: 'fm_identity',
    });
    let isolated = false;
    try {
      await identityPool.query('SELECT 1');
    } catch (error) {
      isolated = error.code === '42501';
    } finally {
      await identityPool.end();
    }
    ensure(isolated, 'ENVIRONMENT_DATABASE_ROLES_NOT_ISOLATED');
    const issuer = `https://127.0.0.1:${metadata.identity_port}/realms/fm-${profile}`;
    const discovery = await httpsJson(
      profile,
      issuer + '/.well-known/openid-configuration',
    );
    ensure(
      discovery.issuer === issuer &&
        discovery.jwks_uri === issuer + '/protocol/openid-connect/certs',
      'ENVIRONMENT_ISSUER_MISMATCH',
    );
    const jwks = await httpsJson(profile, discovery.jwks_uri);
    ensure(
      Array.isArray(jwks.keys) &&
        jwks.keys.some((key) => key.kty === 'RSA') &&
        jwks.keys.every((key) => !key.d),
      'ENVIRONMENT_JWKS_INVALID',
    );
    const mail = await httpsJson(
      profile,
      `https://127.0.0.1:${metadata.mail_port}/api/v1/info`,
    );
    ensure(mail && typeof mail === 'object', 'ENVIRONMENT_MAIL_UNHEALTHY');
    const logs = await session.docker([
      'compose',
      '--project-name',
      metadata.project,
      '--env-file',
      path.join(context.directory, 'empty.env'),
      '-f',
      path.join(context.directory, 'compose.json'),
      'logs',
      '--no-color',
    ]);
    ensure(
      Object.values(credentials).every((secret) => !logs.includes(secret)),
      'ENVIRONMENT_LOG_SECRET_EXPOSED',
    );
    return {
      profile,
      passed: true,
      database_version: databaseVersion,
      checks: {
        pinned_images: true,
        loopback_ports: true,
        isolated_network: true,
        ephemeral_storage: true,
        private_runtime_credentials: true,
        database_marker: true,
        runtime_role_restricted: true,
        identity_database_isolated: true,
        tls_pinned_to_profile: true,
        oidc_discovery_and_jwks: true,
        mail_sink_ready: true,
        logs_without_credentials: true,
      },
    };
  });
}
