/* global setTimeout,clearTimeout */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createDualPool,
  prepareDualPostgres,
} from '../schema/dual-postgres.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migratePostgresTo, sha256 } from '../schema/postgres-migrations.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture } from '../fixtures/loader.mjs';
import {
  seedSyntheticSqlite,
  runSyntheticCases,
  syntheticCorpus,
} from '../../packages/storage-schema/dist/synthetic-probe.js';
import {
  seedInvariants,
  invariantHarness,
  runInvariants,
} from './protocol.mjs';
import {
  invariantChecks,
  invariantHashes,
  validateInvariantEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us027-invariants'),
  filename = path.join(directory, 'synthetic.sqlite');
const environment = {
  ...process.env,
  US027_ARTIFACTS: directory.replaceAll('\\', '/'),
};
for (const key of Object.keys(environment))
  if (/^(DOCKER_|COMPOSE_)/.test(key)) delete environment[key];
const docker = (args, stderr = false) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    if (stderr) child.stderr.on('data', (data) => (output += data));
    else child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('DOCKER_TIMEOUT'));
    }, 120000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(Error('DOCKER_FAILED'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(Error('DOCKER_FAILED'));
    });
  });
const compose = (...args) =>
  docker([
    'compose',
    '-p',
    'financial-manager-us027',
    '-f',
    path.join(root, 'infra/invariants/compose.yaml'),
    '--env-file',
    path.join(directory, 'empty.env'),
    ...args,
  ]);
let owned = false,
  locked = false,
  admin,
  bootstrapFixture,
  a,
  b,
  sqlite,
  stage = 'configuration';
const report = {
  format_version: 1,
  dataset_id: 'FIN-002',
  dataset_version: 1,
  corpus_id: 'FIN-INVARIANTS-001',
  corpus_version: 1,
  scope: 'us027-cross-engine-invariants',
  synthetic_only: true,
  passed: false,
  checks: {},
  versions: { node: process.versions.node },
  pending: [
    'product-write-routes-feed-outbox-and-idempotency',
    'native-product-runtime-integration',
    'document-search-product-schema-and-ct08-integration',
  ],
};
const step = async (name, operation) => {
  stage = name;
  await operation();
  report.checks[name] = true;
  console.log('US-027 check: ' + name);
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
  assert.equal(existsSync(filename), false);
  await step('deterministic_fixture_and_generation', async () => {
    const result = spawnSync(
      process.execPath,
      ['infra/fixtures/generate.mjs', '--check'],
      { cwd: root, windowsHide: true, encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
    assert.equal(fixture.synthetic_only, true);
  });
  const credentials = Object.fromEntries(
    ['bootstrap', 'migrator', 'a', 'b'].map((key) => [
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
  stage = 'start_postgresql';
  await compose('up', '-d');
  const containerId = await compose('ps', '-q'),
    [container] = JSON.parse(await docker(['inspect', containerId]));
  assert.equal(
    container.Config.Labels['io.financial-manager.us027-synthetic'],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us027',
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
  bootstrapFixture = await prepareDualPostgres(credentials, admin);
  await admin.query('INSERT INTO us021_test.access VALUES($1,$2),($3,$4)', [
    'us021_a',
    fixture.workspace_a,
    'us021_b',
    fixture.workspace_b,
  ]);
  a = createDualPool('us021_a', credentials.a, 2);
  b = createDualPool('us021_b', credentials.b);
  sqlite = openProbeDatabase(filename);
  await step('migrations_v2', async () => {
    assert.equal((await migrateSqliteTo(sqlite.db, { sha256 })).to, 2);
    const migrator = createDualPool('fm_schema_migrator', credentials.migrator);
    try {
      assert.equal((await migratePostgresTo(migrator)).to, 2);
    } finally {
      await migrator.end();
    }
  });
  report.versions.postgresql = (
    await admin.query('SHOW server_version')
  ).rows[0].server_version;
  report.versions.sqlite = (
    await sqlite.db.rows('SELECT sqlite_version() AS version')
  )[0].version;
  await seedSyntheticSqlite(sqlite.db);
  for (const [engine, db] of [
    ['sqlite', sqlite.db],
    ['postgresql', bootstrapFixture.adapter],
  ]) {
    await step(engine + '_schema_corpus', async () => {
      assert.deepEqual(
        await runSyntheticCases(db),
        syntheticCorpus.cases.map((row) => row.name),
      );
    });
  }
  for (const engine of ['sqlite', 'postgresql'])
    await seedInvariants(engine, sqlite, { a, b });
  const harnesses = [
    invariantHarness('sqlite', sqlite),
    invariantHarness('postgresql', null, { a, b }),
  ];
  const final = await runInvariants(harnesses, step);
  await step('sqlite_reopen', async () => {
    sqlite.close();
    sqlite = openProbeDatabase(filename);
    const reopened = invariantHarness('sqlite', sqlite);
    for (const [i, workspace] of [
      fixture.workspace_a,
      fixture.workspace_b,
    ].entries())
      assert.deepEqual(await reopened.snapshot(workspace), final[0][i]);
  });
  await step('operational_logs_sanitized', async () => {
    const logs = await docker(['logs', containerId], true);
    for (const secret of [
      ...Object.values(credentials),
      'SYNTHETIC FIN-002',
      '9007199254740993',
      'SYNTHETIC_PRIVATE_SEED_CANARY',
    ])
      assert.equal(logs.includes(secret), false);
  });
  report.passed = true;
} catch (error) {
  const code = /^[A-Z0-9_]{2,50}$/.test(error?.code ?? '')
    ? '_' + error.code
    : '';
  console.error('US027_REVISIONS_FAILED_' + stage.toUpperCase() + code);
  process.exitCode = 1;
} finally {
  const closed = await Promise.allSettled([
    bootstrapFixture?.close(),
    a?.end(),
    b?.end(),
    admin?.end(),
  ]);
  if (closed.some((result) => result.status === 'rejected')) {
    report.passed = false;
    process.exitCode = 1;
  }
  try {
    sqlite?.close();
  } catch {
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
          'label=com.docker.compose.project=financial-manager-us027',
          '--format',
          '{{.ID}}',
        ]),
        '',
      );
      for (const suffix of ['', '-journal', '-wal', '-shm'])
        rmSync(filename + suffix, { force: true });
      rmSync(path.join(directory, 'bootstrap-password'), { force: true });
      report.checks.owned_resources_removed = true;
      report.resources_closed = true;
    } catch {
      report.passed = false;
      process.exitCode = 1;
      console.error('US027_REVISIONS_CLEANUP_FAILED');
    }
  if (locked) rmdirSync(path.join(directory, '.lock'));
  if (owned) {
    report.source_sha256 = invariantHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) {
      assert.ok(invariantChecks.every((name) => report.checks[name] === true));
      validateInvariantEvidence(report);
    }
    writeFileSync(
      path.join(directory, 'invariants.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
