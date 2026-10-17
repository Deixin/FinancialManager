/* global setTimeout,clearTimeout */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDualPool,
  prepareDualPostgres,
} from '../schema/dual-postgres.mjs';
import { corpus } from '../schema/us021-corpus.mjs';
import { queryGates, runQueryGate } from './kysely-gate.mjs';
import { runRepositoryProbe } from './repository-probe.mjs';
import { repositoryHashes, validateRepositoryEvidence } from './evidence.mjs';
import { migratePostgresTo } from '../schema/postgres-migrations.mjs';
const repositories = process.argv.includes('--repositories');
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us024-repositories');
const env = {
  ...process.env,
  US024_ARTIFACTS: directory.replaceAll('\\', '/'),
};
for (const key of Object.keys(env))
  if (/^(DOCKER_|COMPOSE_)/.test(key)) delete env[key];
const docker = (args, stderr = false) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    if (stderr) child.stderr.on('data', (data) => (output += data));
    else child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('DOCKER_TIMEOUT'));
    }, 120000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('DOCKER_FAILED'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error('DOCKER_FAILED'));
    });
  });
const compose = (...args) =>
  docker([
    'compose',
    '-p',
    'financial-manager-us024',
    '-f',
    path.join(root, 'infra/query/compose.yaml'),
    '--env-file',
    path.join(directory, 'empty.env'),
    ...args,
  ]);
let owned = false,
  locked = false,
  admin,
  fixture,
  runtime,
  stage = 'configuration';
const report = {
  format_version: 1,
  scope: repositories
    ? 'us024-scoped-postgresql-repositories'
    : 'g07-query-kysely-postgresql',
  synthetic_only: true,
  passed: false,
  checks: {},
  versions: { node: process.versions.node, kysely: '0.29.6', pg: '8.23.1' },
  pending: repositories
    ? [
        'product-policy-engine-and-http-handlers',
        'write-ports-with-revisions-idempotency-outbox',
        'native-product-adapters',
      ]
    : ['product-repositories-and-policy-engine', 'native-product-adapters'],
};
const step = async (name, operation) => {
  stage = name;
  await operation();
  report.checks[name] = true;
  console.log('G07-QUERY check: ' + name);
};
try {
  for (const folder of [path.join(root, '.tools'), directory]) {
    if (existsSync(folder))
      assert.equal(lstatSync(folder).isSymbolicLink(), false);
    else mkdirSync(folder, { mode: 0o700 });
  }
  mkdirSync(path.join(directory, '.lock'));
  locked = true;
  writeFileSync(path.join(directory, 'empty.env'), '');
  const context = JSON.parse(await docker(['context', 'inspect']));
  assert.ok(
    context.length === 1 &&
      /^(npipe:|unix:)/.test(context[0].Endpoints.docker.Host),
  );
  assert.equal(await compose('ps', '-a', '-q'), '');
  const credentials = Object.fromEntries(
    ['bootstrap', 'migrator', 'a', 'b', 'runtime'].map((key) => [
      key,
      randomBytes(32).toString('hex'),
    ]),
  );
  writeFileSync(
    path.join(directory, 'bootstrap-password'),
    credentials.bootstrap,
    { mode: 0o444 },
  );
  owned = true;
  await compose('up', '-d');
  const containerId = await compose('ps', '-q');
  const [container] = JSON.parse(await docker(['inspect', containerId]));
  assert.equal(
    container.Config.Labels['io.financial-manager.us024-synthetic'],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us024',
  );
  assert.deepEqual(container.HostConfig.PortBindings, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '43221' }],
  });
  assert.ok(container.HostConfig.Tmpfs['/var/lib/postgresql']);
  admin = createDualPool('us021_bootstrap', credentials.bootstrap);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await admin.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready);
  fixture = await prepareDualPostgres(credentials, admin);
  await admin.query(
    `CREATE ROLE us024_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.runtime}';GRANT us021_fixture TO us024_runtime;GRANT CONNECT ON DATABASE us021 TO us024_runtime`,
  );
  // Deliberately inherit only the synthetic fixture grant, never schema-owner rights.
  await admin.query('INSERT INTO us021_test.access VALUES($1,$2),($1,$3)', [
    'us024_runtime',
    corpus.workspace_a,
    corpus.workspace_b,
  ]);
  runtime = createDualPool('us024_runtime', credentials.runtime, 2);
  report.versions.postgresql = (
    await admin.query('SHOW server_version')
  ).rows[0].server_version;
  await step('typed_columns_and_values', async () => {
    const result = spawnSync(
      process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
      process.platform === 'win32'
        ? [
            '/d',
            '/c',
            'pnpm',
            'exec',
            'tsc',
            '-p',
            'infra/query/tsconfig.gate.json',
          ]
        : ['exec', 'tsc', '-p', 'infra/query/tsconfig.gate.json'],
      { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.status, 0);
  });
  await runQueryGate(runtime, admin, corpus, step);
  if (repositories) {
    stage = 'repository_schema';
    const migrator = createDualPool('fm_schema_migrator', credentials.migrator);
    try {
      assert.equal((await migratePostgresTo(migrator)).to, 2);
    } finally {
      await migrator.end();
    }
    await runRepositoryProbe(runtime, admin, corpus, credentials, step);
  }
  await step('operational_logs_sanitized', async () => {
    const logs = await docker(['logs', containerId], true);
    for (const secret of [
      ...Object.values(credentials),
      'SYNTHETIC_US024',
      'SYNTHETIC_US021_MOVEMENT',
      '9007199254740993',
    ])
      assert.equal(logs.includes(secret), false);
  });
  assert.ok(queryGates.every((name) => report.checks[name] === true));
  report.passed = true;
} catch (error) {
  const code = /^[A-Z0-9_]{2,50}$/.test(error?.code ?? '')
    ? '_' + error.code
    : '';
  console.error('US024_QUERY_FAILED_' + stage.toUpperCase() + code);
  process.exitCode = 1;
} finally {
  const closed = await Promise.allSettled([
    fixture?.close(),
    runtime?.end(),
    admin?.end(),
  ]);
  if (closed.some((result) => result.status === 'rejected')) {
    report.passed = false;
    process.exitCode = 1;
  }
  if (owned)
    try {
      await compose('down', '--volumes');
      assert.equal(await compose('ps', '-a', '-q'), '');
      assert.equal(
        await docker([
          'network',
          'ls',
          '--filter',
          'label=com.docker.compose.project=financial-manager-us024',
          '--format',
          '{{.ID}}',
        ]),
        '',
      );
      rmSync(path.join(directory, 'bootstrap-password'), { force: true });
      report.checks.owned_resources_removed = true;
      report.resources_closed = true;
    } catch {
      report.passed = false;
      process.exitCode = 1;
      console.error('US024_QUERY_CLEANUP_FAILED');
    }
  if (locked) rmdirSync(path.join(directory, '.lock'));
  if (owned) {
    report.source_sha256 = Object.fromEntries(
      [
        'infra/query/gate-types.ts',
        'infra/query/kysely-gate.mjs',
        'infra/query/run.mjs',
        'infra/query/compose.yaml',
        'infra/schema/dual-postgres.mjs',
        'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
        'pnpm-lock.yaml',
      ].map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(path.join(root, name)))
          .digest('hex'),
      ]),
    );
    report.completed_at_utc = new Date().toISOString();
    if (repositories) {
      report.source_sha256 = repositoryHashes();
      if (report.passed) validateRepositoryEvidence(report);
    }
    writeFileSync(
      path.join(
        directory,
        repositories ? 'repositories.json' : 'gate-initial.json',
      ),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
