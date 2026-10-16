/* global setTimeout,clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  migrateSqlite,
  sqliteMigration,
  sqliteMigrationSha256,
} from '../../packages/storage-schema/dist/index.js';
import {
  seedSyntheticSqlite,
  runSyntheticCases,
} from '../../packages/storage-schema/dist/synthetic-probe.js';
import { corpus } from './us021-corpus.mjs';
import { openProbeDatabase } from './sqlite-adapter.mjs';
import { createDualPool, prepareDualPostgres } from './dual-postgres.mjs';
import { sourceHashes, validateDualEvidence } from './dual-evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us021-dual');
const environment = {
  ...process.env,
  US021_ARTIFACTS: directory.replaceAll('\\', '/'),
};
for (const name of Object.keys(environment))
  if (/^(DOCKER_|COMPOSE_)/.test(name)) delete environment[name];
const run = (args, captureError = false) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data.toString()));
    if (captureError)
      child.stderr.on('data', (data) => (output += data.toString()));
    else child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('DOCKER_TIMEOUT'));
    }, 120000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('DOCKER_UNAVAILABLE'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error('DOCKER_FAILED'));
    });
  });
const compose = (...args) =>
  run([
    'compose',
    '-p',
    'financial-manager-us021',
    '-f',
    path.join(root, 'infra/schema/dual-compose.yaml'),
    '--env-file',
    path.join(directory, 'empty.env'),
    ...args,
  ]);
let owned = false,
  locked = false,
  sqlite,
  postgres,
  admin,
  stage = 'configuration';
const report = {
  format_version: 1,
  scope: 'us021-postgresql-sqlite-equivalence',
  synthetic_only: true,
  passed: false,
  checks: {},
  engines: {},
  pending: [
    'ios-native-runtime',
    'product-vault-policy-and-migrations',
    'uuid-generator-and-full-cross-engine-suite',
  ],
};
const step = async (name, operation) => {
  stage = name;
  await operation();
  report.checks[name] = true;
  console.log('US-021 dual check: ' + name);
};
const filename = path.join(directory, 'synthetic.sqlite');
const removeDatabases = () => {
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    rmSync(filename + suffix, { force: true });
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
  const context = JSON.parse(await run(['context', 'inspect']));
  assert.ok(
    context.length === 1 &&
      /^(npipe:|unix:)/.test(context[0].Endpoints.docker.Host),
  );
  assert.equal(await compose('ps', '-a', '-q'), '');
  assert.equal(existsSync(filename), false);
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
  const containerId = await compose('ps', '-q');
  const [container] = JSON.parse(await run(['inspect', containerId]));
  assert.equal(
    container.Config.Labels['io.financial-manager.us021-synthetic'],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us021',
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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(ready);
  sqlite = openProbeDatabase(filename);
  await step('migration_rollback', async () => {
    const broken = openProbeDatabase(':memory:');
    try {
      await assert.rejects(
        migrateSqlite({
          ...broken.db,
          async exec(sql) {
            await broken.db.exec(sql);
            if (sql === sqliteMigration) throw new Error('SYNTHETIC_SQL_ERROR');
          },
        }),
        { message: 'SQLITE_MIGRATION_FAILED' },
      );
      assert.equal(
        (
          await broken.db.rows(
            "SELECT name FROM sqlite_schema WHERE type='table'",
          )
        ).length,
        0,
      );
    } finally {
      broken.close();
    }
  });
  await step('migration_idempotency_and_checksum', async () => {
    assert.equal(await migrateSqlite(sqlite.db), true);
    assert.equal(await migrateSqlite(sqlite.db), false);
    await sqlite.db.run('UPDATE _schema_migration SET checksum=?', [
      '0'.repeat(64),
    ]);
    await assert.rejects(migrateSqlite(sqlite.db), {
      message: 'SQLITE_MIGRATION_MISMATCH',
    });
    await sqlite.db.run('UPDATE _schema_migration SET checksum=?', [
      sqliteMigrationSha256,
    ]);
  });
  stage = 'sqlite_shared_corpus';
  await seedSyntheticSqlite(sqlite.db);
  const localCases = await runSyntheticCases(sqlite.db);
  report.engines.sqlite = {
    version: (await sqlite.db.rows('SELECT sqlite_version() AS version'))[0]
      .version,
    cases: Object.fromEntries(localCases.map((name) => [name, true])),
  };
  console.log('US-021 shared SQLite cases: ' + localCases.length);
  stage = 'postgresql_shared_corpus';
  postgres = await prepareDualPostgres(credentials, admin);
  const cloudCases = await runSyntheticCases(postgres.adapter);
  report.engines.postgresql = {
    version: (
      await admin.query('SHOW server_version')
    ).rows[0].server_version.split(' ')[0],
    cases: Object.fromEntries(cloudCases.map((name) => [name, true])),
  };
  assert.deepEqual(cloudCases, localCases);
  console.log('US-021 shared PostgreSQL cases: ' + cloudCases.length);
  await step('foreign_keys_and_strict_integer', async () => {
    assert.equal(
      (await sqlite.db.rows('PRAGMA foreign_keys'))[0].foreign_keys,
      '1',
    );
    assert.equal(
      (
        await sqlite.db.rows(
          'SELECT typeof(account_amount_minor) AS storage FROM financial_transaction WHERE id=?',
          [
            corpus.seed.find((row) => row.table === 'financial_transaction')
              .values.id,
          ],
        )
      )[0].storage,
      'integer',
    );
    assert.equal((await sqlite.db.rows('PRAGMA foreign_key_check')).length, 0);
  });
  await step('commit_guard_cannot_be_bypassed', async () => {
    const transaction = corpus.cases.find(
      (item) => item.name === 'partial_split_rolls_back_at_commit',
    ).statements[0];
    await sqlite.db.exec('BEGIN IMMEDIATE');
    await sqlite.db.run(transaction.sql, transaction.parameters);
    await assert.rejects(
      sqlite.db.run(
        'UPDATE _allocation_commit_guard SET valid=1 WHERE valid=0',
      ),
    );
    await sqlite.db.exec('ROLLBACK');
    await sqlite.db.exec('BEGIN IMMEDIATE');
    await sqlite.db.run('DELETE FROM _allocation_commit_guard');
    await assert.rejects(sqlite.db.exec('COMMIT'));
    await sqlite.db.exec('ROLLBACK');
    await assert.rejects(
      sqlite.db.run('INSERT INTO _allocation_valid_anchor VALUES(0)'),
    );
  });
  await step('single_writer_serialization', async () => {
    const other = openProbeDatabase(filename);
    try {
      await sqlite.db.exec('BEGIN IMMEDIATE');
      await assert.rejects(other.db.exec('BEGIN IMMEDIATE'));
      await sqlite.db.exec('ROLLBACK');
      await other.db.exec('BEGIN IMMEDIATE;COMMIT');
    } finally {
      other.close();
    }
  });
  await step('local_workspace_without_identity', async () => {
    const local = openProbeDatabase(':memory:');
    try {
      await migrateSqlite(local.db);
      await local.db.run(
        "INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation) VALUES (?,'Synthetic local','PERSONAL','LOCAL','BRL',?)",
        ['0199d021-0000-7000-8000-000000009999', corpus.workspace_a],
      );
      assert.equal(
        (
          await local.db.rows(
            "SELECT name FROM sqlite_schema WHERE name IN('cloud_user','workspace_member')",
          )
        ).length,
        0,
      );
    } finally {
      local.close();
    }
  });
  await step('reopened_balance_and_integrity', async () => {
    sqlite.close();
    sqlite = openProbeDatabase(filename);
    await sqlite.db.exec(
      'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF',
    );
    const check = corpus.cases[0].query;
    assert.deepEqual(
      await sqlite.db.rows(check.sql, check.parameters),
      check.rows,
    );
    assert.equal(
      (await sqlite.db.rows('PRAGMA integrity_check'))[0].integrity_check,
      'ok',
    );
  });
  await step('postgres_rls_context', async () => {
    await postgres.adapter.exec('BEGIN IMMEDIATE');
    await postgres.adapter.run("SELECT set_config('app.workspace_id',?,true)", [
      corpus.workspace_b,
    ]);
    assert.equal(
      (await postgres.adapter.rows('SELECT * FROM financial_account')).length,
      0,
    );
    await postgres.adapter.exec('ROLLBACK');
  });
  await step('operational_logs_sanitized', async () => {
    const logs = await run(['logs', containerId], true);
    for (const secret of [
      ...Object.values(credentials),
      'SYNTHETIC_US021_MOVEMENT',
      '9007199254740993',
    ])
      assert.equal(logs.includes(secret), false);
  });
  report.passed = true;
} catch (error) {
  const code = String(error.message);
  console.error(
    'US021_DUAL_FAILED_' +
      stage.toUpperCase() +
      (caseNames().includes(code) ? '_' + code : ''),
  );
  process.exitCode = 1;
} finally {
  const pools = await Promise.allSettled([postgres?.close(), admin?.end()]);
  try {
    sqlite?.close();
  } catch {
    pools.push({ status: 'rejected' });
  }
  if (pools.some((result) => result.status === 'rejected')) {
    report.passed = false;
    process.exitCode = 1;
    console.error('US021_DUAL_CONNECTION_CLEANUP_FAILED');
  }
  if (owned)
    try {
      await compose('down', '--volumes');
      assert.equal(await compose('ps', '-a', '-q'), '');
      assert.equal(
        await run([
          'network',
          'ls',
          '--filter',
          'label=com.docker.compose.project=financial-manager-us021',
          '--format',
          '{{.ID}}',
        ]),
        '',
      );
      removeDatabases();
      rmSync(path.join(directory, 'bootstrap-password'), { force: true });
      report.checks.owned_resources_removed = true;
      report.resources_closed = true;
    } catch {
      report.passed = false;
      console.error('US021_DUAL_CLEANUP_FAILED');
      process.exitCode = 1;
    }
  if (locked) rmdirSync(path.join(directory, '.lock'));
  if (owned) {
    report.source_sha256 = sourceHashes('dual');
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateDualEvidence(report);
    writeFileSync(
      path.join(directory, 'latest.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
function caseNames() {
  return corpus.cases.map((item) => 'PROBE_' + item.name.toUpperCase());
}
