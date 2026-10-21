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
import { fixture, readSnapshot } from '../fixtures/loader.mjs';
import { verifyTotals } from '../fixtures/totals.mjs';
import { runImportProtocol } from './protocol.mjs';
import { sqliteImportCatalog } from '../../packages/storage-schema/dist/import-migrations.js';
import { postgresImportCatalog } from './migrations.mjs';
import { runRevisionProtocol } from '../revisions/protocol.mjs';
import {
  importChecks as revisionChecks,
  importHashes as revisionHashes,
  validateImportEvidence as validateRevisionEvidence,
  pending,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us050-import-central'),
  filename = path.join(directory, 'synthetic.sqlite');
const environment = {
  ...process.env,
  US050_ARTIFACTS: directory.replaceAll('\\', '/'),
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
    'financial-manager-us050-import-central',
    '-f',
    path.join(root, 'infra/import-central/compose.yaml'),
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
  scope: 'us050-import-central',
  synthetic_only: true,
  passed: false,
  checks: {},
  versions: { node: process.versions.node },
  pending: [...pending],
};
const step = async (name, operation) => {
  stage = name;
  await operation();
  report.checks[name] = true;
  console.log('US-050 check: ' + name);
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
    container.Config.Labels[
      'io.financial-manager.us050-import-central-synthetic'
    ],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us050-import-central',
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
  await step('migrations_v3_guarded_empty_roundtrip', async () => {
    const migrator = createDualPool('fm_schema_migrator', credentials.migrator);
    try {
      const catalog = await postgresImportCatalog();
      assert.equal((await migratePostgresTo(migrator, { catalog })).to, 3);
      assert.equal(
        (await migratePostgresTo(migrator, { catalog, target: 2 })).to,
        2,
      );
      assert.equal((await migratePostgresTo(migrator, { catalog })).to, 3);
    } finally {
      await migrator.end();
    }
    assert.equal(
      (
        await migrateSqliteTo(sqlite.db, {
          sha256,
          catalog: sqliteImportCatalog,
        })
      ).to,
      3,
    );
    assert.equal(
      (
        await migrateSqliteTo(sqlite.db, {
          sha256,
          catalog: sqliteImportCatalog,
          target: 2,
        })
      ).to,
      2,
    );
    assert.equal(
      (
        await migrateSqliteTo(sqlite.db, {
          sha256,
          catalog: sqliteImportCatalog,
        })
      ).to,
      3,
    );
    for (const table of [
      'import_batch',
      'import_source',
      'import_item',
      'import_effect',
    ]) {
      await admin.query(
        'GRANT SELECT,INSERT,UPDATE,DELETE ON fm.' +
          table +
          ' TO us021_fixture',
      );
      await admin.query(
        'CREATE POLICY synthetic_authorized_fixture ON fm.' +
          table +
          ' TO us021_fixture USING(EXISTS(SELECT 1 FROM us021_test.access a WHERE a.database_role=session_user AND a.workspace_id=' +
          table +
          '.workspace_id)) WITH CHECK(EXISTS(SELECT 1 FROM us021_test.access a WHERE a.database_role=session_user AND a.workspace_id=' +
          table +
          '.workspace_id))',
      );
    }
  });
  await runRevisionProtocol(sqlite, { a, b }, admin, step);
  await runImportProtocol(sqlite, { a, b }, admin, step, { credentials });
  await step('sqlite_reopen', async () => {
    const importsBefore = await sqlite.db.rows(
      'SELECT id,status,CAST(version AS TEXT) AS version FROM import_batch ORDER BY id',
    );
    const previous = (
      await readSnapshot(sqlite.db, 'sqlite', fixture.workspace_a)
    ).snapshot;
    sqlite.close();
    sqlite = openProbeDatabase(filename);
    assert.deepEqual(
      await sqlite.db.rows(
        'SELECT id,status,CAST(version AS TEXT) AS version FROM import_batch ORDER BY id',
      ),
      importsBefore,
    );
    for (const workspace of [fixture.workspace_a, fixture.workspace_b]) {
      const { snapshot } = await readSnapshot(sqlite.db, 'sqlite', workspace);
      if (workspace === fixture.workspace_a)
        assert.deepEqual(snapshot, previous);
      verifyTotals(snapshot, workspace);
    }
    const local = await sqlite.db.rows(
      'SELECT actor_type,actor_id,device_id FROM transaction_revision WHERE workspace_id=?',
      ['0199d026-0000-7000-8000-000000000901'],
    );
    assert.equal(local.length, 1);
    assert.ok(
      local.every(
        (row) =>
          row.actor_type === 'LOCAL_USER' &&
          row.actor_id === null &&
          row.device_id === null,
      ),
    );
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
  console.error('US050_IMPORTS_FAILED_' + stage.toUpperCase() + code);
  const location = error?.stack?.match(
    /(?:protocol|harness)\.mjs:\d+:\d+/,
  )?.[0];
  if (location) console.error('TEST_LOCATION_' + location);
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
          'label=com.docker.compose.project=financial-manager-us050-import-central',
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
      console.error('US050_IMPORTS_CLEANUP_FAILED');
    }
  if (locked) rmdirSync(path.join(directory, '.lock'));
  if (owned) {
    report.source_sha256 = revisionHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) {
      assert.ok(revisionChecks.every((name) => report.checks[name] === true));
      validateRevisionEvidence(report);
    }
    writeFileSync(
      path.join(directory, 'imports.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
