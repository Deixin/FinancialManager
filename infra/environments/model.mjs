import path from 'node:path';

export const profileNames = Object.freeze([
  'local',
  'ci',
  'integration',
  'staging',
]);
const services = ['postgres', 'identity', 'mail', 'edge'];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class EnvironmentError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EnvironmentError';
    this.code = code;
  }
}
export function requireEnvironment(condition, code) {
  if (!condition) throw new EnvironmentError(code);
}
function keys(value, expected) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',')
  );
}
export function validateProfiles(manifest) {
  requireEnvironment(
    keys(manifest, [
      'format_version',
      'synthetic_only',
      'deployment',
      'images',
      'profiles',
    ]) &&
      manifest.format_version === 1 &&
      manifest.synthetic_only === true &&
      manifest.deployment === 'docker-local' &&
      keys(manifest.images, services) &&
      keys(manifest.profiles, profileNames),
    'ENVIRONMENT_CONFIG_INVALID',
  );
  const allowed = {
    postgres: /^postgres:18\.6-alpine@sha256:[a-f0-9]{64}$/,
    identity: /^quay\.io\/keycloak\/keycloak:26\.8\.0@sha256:[a-f0-9]{64}$/,
    mail: /^axllent\/mailpit:v1\.27\.4@sha256:[a-f0-9]{64}$/,
    edge: /^caddy:2\.10\.2-alpine@sha256:[a-f0-9]{64}$/,
  };
  for (const service of services)
    requireEnvironment(
      allowed[service].test(manifest.images[service]),
      'ENVIRONMENT_IMAGE_UNPINNED',
    );
  const ports = new Set();
  for (const name of profileNames) {
    const profile = manifest.profiles[name];
    requireEnvironment(
      keys(profile, ['identity_port', 'mail_port', 'database_port']),
      'ENVIRONMENT_CONFIG_INVALID',
    );
    for (const port of Object.values(profile)) {
      requireEnvironment(
        Number.isInteger(port) &&
          port >= 1024 &&
          port <= 65535 &&
          !ports.has(port),
        'ENVIRONMENT_PORT_INVALID',
      );
      ports.add(port);
    }
  }
  return manifest;
}
export function validateProfile(profile) {
  requireEnvironment(
    profileNames.includes(profile),
    'ENVIRONMENT_PROFILE_INVALID',
  );
  return profile;
}
export function projectName(profile, owner) {
  validateProfile(profile);
  requireEnvironment(uuid.test(owner), 'ENVIRONMENT_OWNER_INVALID');
  return `financial-manager-env-${profile}-${owner.slice(0, 8)}`;
}
export function profileMetadata(manifest, profile, owner) {
  validateProfiles(manifest);
  return {
    format_version: 1,
    synthetic_only: true,
    profile: validateProfile(profile),
    owner,
    project: projectName(profile, owner),
    ...manifest.profiles[profile],
  };
}
export function realmFixture(metadata) {
  const origin = `https://127.0.0.1:${metadata.identity_port}`;
  return {
    realm: `fm-${metadata.profile}`,
    enabled: true,
    sslRequired: 'all',
    registrationAllowed: false,
    resetPasswordAllowed: false,
    rememberMe: false,
    bruteForceProtected: true,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    smtpServer: {
      host: 'mail',
      port: '1025',
      from: `identity@${metadata.profile}.synthetic.invalid`,
      ssl: 'false',
      starttls: 'false',
      auth: 'false',
    },
    clients: [
      {
        clientId: `fm-${metadata.profile}-native`,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: true,
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        redirectUris: [origin + '/synthetic-callback'],
        webOrigins: [],
        attributes: { 'pkce.code.challenge.method': 'S256' },
      },
    ],
    users: [],
  };
}
export function composeModel(manifest, metadata, directory, sourceDirectory) {
  requireEnvironment(
    path.isAbsolute(directory) && path.isAbsolute(sourceDirectory),
    'ENVIRONMENT_PATH_INVALID',
  );
  const expected = profileMetadata(manifest, metadata.profile, metadata.owner);
  requireEnvironment(
    JSON.stringify(expected) === JSON.stringify(metadata),
    'ENVIRONMENT_CONFIG_INVALID',
  );
  const labels = {
    'io.financial-manager.environment': metadata.profile,
    'io.financial-manager.owner': metadata.owner,
    'io.financial-manager.synthetic': 'true',
  };
  const file = (filename) =>
    path
      .join(directory, filename)
      .replaceAll('\\', '/')
      .replaceAll('$', () => '$$');
  const source = (filename) =>
    path
      .join(sourceDirectory, filename)
      .replaceAll('\\', '/')
      .replaceAll('$', () => '$$');
  const bind = (filename, target) => ({
    type: 'bind',
    source: file(filename),
    target,
    read_only: true,
  });
  const shared = {
    labels,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    logging: {
      driver: 'local',
      options: { 'max-size': '1m', 'max-file': '2' },
    },
  };
  return {
    name: metadata.project,
    services: {
      postgres: {
        ...shared,
        image: manifest.images.postgres,
        user: '70:70',
        read_only: true,
        environment: {
          POSTGRES_DB: 'fm_app',
          POSTGRES_USER: 'fm_bootstrap',
          POSTGRES_PASSWORD_FILE: '/run/secrets/bootstrap-password',
          POSTGRES_HOST_AUTH_METHOD: 'scram-sha-256',
          POSTGRES_INITDB_ARGS: '--auth-host=scram-sha-256',
        },
        command: [
          'postgres',
          '-c',
          'log_statement=none',
          '-c',
          'log_min_error_statement=panic',
          '-c',
          'log_min_messages=panic',
          '-c',
          'log_error_verbosity=terse',
          '-c',
          'log_parameter_max_length=0',
          '-c',
          'log_parameter_max_length_on_error=0',
          '-c',
          'statement_timeout=10000',
        ],
        ports: [`127.0.0.1:${metadata.database_port}:5432`],
        volumes: [
          bind('bootstrap-password', '/run/secrets/bootstrap-password'),
          bind('identity-password', '/run/secrets/identity-password'),
          bind('runtime-password', '/run/secrets/runtime-password'),
          bind('profile.json', '/run/config/profile.json'),
          {
            type: 'bind',
            source: source('0001-foundation.sql'),
            target: '/docker-entrypoint-initdb.d/0001-foundation.sql',
            read_only: true,
          },
        ],
        tmpfs: [
          '/var/lib/postgresql:uid=70,gid=70,mode=0700,size=256m',
          '/var/run/postgresql:uid=70,gid=70,mode=0700,size=16m',
          '/tmp:mode=1777,size=16m',
        ],
        healthcheck: {
          test: [
            'CMD',
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'fm_bootstrap',
            '-d',
            'fm_app',
          ],
          interval: '2s',
          timeout: '2s',
          retries: 45,
        },
        mem_limit: '512m',
        cpus: 2,
        networks: ['isolated', 'database_entry'],
      },
      identity: {
        ...shared,
        image: manifest.images.identity,
        user: '1000:0',
        entrypoint: ['/bin/bash', '-ec'],
        command: [
          'export KC_DB_PASSWORD="$$(< /run/secrets/identity-password)"; exec /opt/keycloak/bin/kc.sh start --import-realm',
        ],
        environment: {
          KC_DB: 'postgres',
          KC_DB_URL: 'jdbc:postgresql://postgres:5432/fm_identity',
          KC_DB_USERNAME: 'fm_identity',
          KC_DB_POOL_INITIAL_SIZE: '1',
          KC_DB_POOL_MIN_SIZE: '1',
          KC_DB_POOL_MAX_SIZE: '5',
          KC_HOSTNAME: `https://127.0.0.1:${metadata.identity_port}`,
          KC_HOSTNAME_STRICT: 'true',
          KC_HTTP_ENABLED: 'true',
          KC_PROXY_HEADERS: 'xforwarded',
          KC_HTTP_ACCESS_LOG_ENABLED: 'false',
          KC_LOG_LEVEL: 'error',
          KC_HEALTH_ENABLED: 'true',
        },
        volumes: [
          bind('identity-password', '/run/secrets/identity-password'),
          bind('realm.json', '/opt/keycloak/data/import/realm.json'),
        ],
        tmpfs: ['/opt/keycloak/data:mode=1777,size=128m'],
        healthcheck: {
          test: [
            'CMD',
            '/bin/bash',
            '-ec',
            'exec 3<>/dev/tcp/127.0.0.1/9000; printf "GET /health/ready HTTP/1.0\\r\\n\\r\\n" >&3; IFS= read -r line <&3; [[ "$$line" == *" 200 "* ]]',
          ],
          interval: '3s',
          timeout: '3s',
          retries: 60,
          start_period: '15s',
        },
        depends_on: { postgres: { condition: 'service_healthy' } },
        mem_limit: '1536m',
        cpus: 2,
        networks: ['isolated'],
      },
      mail: {
        ...shared,
        image: manifest.images.mail,
        read_only: true,
        environment: { MP_DATABASE: '/data/mailpit.db', MP_QUIET: 'true' },
        tmpfs: ['/data:mode=1777,size=64m', '/tmp:mode=1777,size=16m'],
        mem_limit: '128m',
        networks: ['isolated'],
      },
      edge: {
        ...shared,
        cap_add: ['NET_BIND_SERVICE'],
        image: manifest.images.edge,
        user: '1000:1000',
        read_only: true,
        ports: [
          `127.0.0.1:${metadata.identity_port}:8443`,
          `127.0.0.1:${metadata.mail_port}:8444`,
        ],
        volumes: [
          {
            type: 'bind',
            source: source('Caddyfile'),
            target: '/etc/caddy/Caddyfile',
            read_only: true,
          },
        ],
        tmpfs: [
          '/data:uid=1000,gid=1000,mode=0700,size=32m',
          '/config:uid=1000,gid=1000,mode=0700,size=16m',
        ],
        depends_on: {
          identity: { condition: 'service_healthy' },
          mail: { condition: 'service_started' },
        },
        mem_limit: '64m',
        networks: ['isolated', 'entry'],
      },
    },
    networks: {
      isolated: { internal: true, labels },
      entry: { labels },
      database_entry: { labels },
    },
  };
}

export function dockerEnvironment(environment) {
  const safe = {};
  const allowed = new Set([
    'path',
    'systemroot',
    'windir',
    'comspec',
    'temp',
    'tmp',
    'userprofile',
    'home',
    'homedrive',
    'homepath',
    'appdata',
    'localappdata',
    'programfiles',
    'programdata',
    'xdg_runtime_dir',
    'xdg_config_home',
  ]);
  for (const [key, value] of Object.entries(environment))
    if (allowed.has(key.toLowerCase())) safe[key] = value;
  return safe;
}
