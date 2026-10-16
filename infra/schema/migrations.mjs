/* global setTimeout,clearTimeout */
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
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
import { migrateSqlite } from '../../packages/storage-schema/dist/index.js';
import {
  migrateSqliteTo,
  sqliteCatalog,
  migrationContent,
} from '../../packages/storage-schema/dist/migrations.js';
import {
  seedSyntheticSqlite,
  runSyntheticCases,
} from '../../packages/storage-schema/dist/synthetic-probe.js';
import { applyInitialMigration } from '../../apps/api/persistence/postgres/migrate.mjs';
import {
  migratePostgresTo,
  postgresCatalog,
  sha256,
} from './postgres-migrations.mjs';
import { createDualPool, prepareDualPostgres } from './dual-postgres.mjs';
import { openProbeDatabase } from './sqlite-adapter.mjs';
import { businessTables } from './sqlite-model.mjs';
import { corpus } from './us021-corpus.mjs';
import {
  migrationHashes,
  validateMigrationEvidence,
} from './migration-evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us022-migrations'),
  filename = path.join(directory, 'synthetic.sqlite');
const environment = {
  ...process.env,
  US022_ARTIFACTS: directory.replaceAll('\\', '/'),
};
for (const name of Object.keys(environment))
  if (/^(DOCKER_|COMPOSE_)/.test(name)) delete environment[name];
const docker = (args, includeStderr = false) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    if (includeStderr) child.stderr.on('data', (data) => (output += data));
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
  docker([
    'compose',
    '-p',
    'financial-manager-us022',
    '-f',
    path.join(root, 'infra/schema/migrations-compose.yaml'),
    '--env-file',
    path.join(directory, 'empty.env'),
    ...args,
  ]);
const worker = (message) =>
  new Promise((resolve, reject) => {
    const child = fork(new URL('./migration-worker.mjs', import.meta.url), [], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let result,
      checkpoint = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('WORKER_TIMEOUT'));
    }, 20000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('WORKER_FAILED'));
    });
    child.on('message', (value) => {
      if (value.checkpoint === message.checkpoint && message.checkpoint) {
        checkpoint = true;
        child.kill('SIGKILL');
      } else if (value.result) result = value.result;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (checkpoint) resolve({ interrupted: true });
      else if (code === 0 && result) resolve(result);
      else reject(new Error('WORKER_FAILED'));
    });
    child.send(message);
  });
let admin,
  postgres,
  migrator,
  sqlite,
  owned = false,
  locked = false,
  stage = 'configuration';
const report = {
  format_version: 1,
  scope: 'us022-transactional-dual-engine-migrations',
  synthetic_only: true,
  passed: false,
  checks: {},
  engines: {},
  cases_per_engine: 33,
  interruptions_per_engine: 6,
  pending: [
    'product-vault-and-native-host-integration',
    'destructive-migrations-with-protected-backup',
    'api-client-version-adapters',
  ],
};
const step = async (name, operation) => {
  stage = name;
  await operation();
  report.checks[name] = true;
  console.log('US-022 check: ' + name);
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
  await compose('up', '-d');
  const containerId = await compose('ps', '-q');
  const [container] = JSON.parse(await docker(['inspect', containerId]));
  assert.equal(
    container.Config.Labels['io.financial-manager.us022-synthetic'],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us022',
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
  // Reuse exactly the authorized synthetic roles/policies and shared financial corpus.
  postgres = await prepareDualPostgres(credentials, admin);
  migrator = createDualPool('fm_schema_migrator', credentials.migrator, 2);
  sqlite = openProbeDatabase(filename);
  await migrateSqlite(sqlite.db);
  await seedSyntheticSqlite(sqlite.db);
  report.engines.postgresql = (
    await admin.query('SHOW server_version')
  ).rows[0].server_version;
  report.engines.sqlite = (
    await sqlite.db.rows('SELECT sqlite_version() AS version')
  )[0].version;
  const history = async (engine) =>
    engine === 'sqlite'
      ? sqlite.db.rows(
          'SELECT version,checksum FROM _schema_migration ORDER BY version',
        )
      : (
          await admin.query(
            'SELECT version::text,checksum FROM fm.schema_migration ORDER BY version',
          )
        ).rows;
  const indexExists = async (engine) =>
    engine === 'sqlite'
      ? (
          await sqlite.db.rows(
            "SELECT name FROM sqlite_schema WHERE type='index' AND name='balance_reference_lookup'",
          )
        ).length !== 0
      : (
          await admin.query(
            "SELECT to_regclass('fm.balance_reference_lookup') AS relation",
          )
        ).rows[0].relation !== null;
  const migrate = (engine, target, catalog) =>
    engine === 'sqlite'
      ? migrateSqliteTo(sqlite.db, {
          sha256,
          target,
          ...(catalog ? { catalog } : {}),
        })
      : migratePostgresTo(migrator, {
          target,
          ...(catalog ? { catalog } : {}),
        });
  const catalogFor = async (engine) =>
    engine === 'sqlite' ? sqliteCatalog : postgresCatalog();
  const snapshot = async (engine) => {
    const hash = createHash('sha256');
    for (const table of businessTables) {
      // RLS-bound fixture for all financial reads; never use the schema owner/bootstrap.
      const rows = await (
        engine === 'sqlite' ? sqlite.db : postgres.adapter
      ).rows(`SELECT * FROM ${table}`);
      hash.update(
        JSON.stringify(
          [...rows].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
        ),
      );
    }
    return hash.digest('hex');
  };
  const before = {
    sqlite: await snapshot('sqlite'),
    postgres: await snapshot('postgres'),
  };
  await step('fresh_upgrade_and_supported_downgrade', async () => {
    const fresh = openProbeDatabase(':memory:');
    try {
      assert.deepEqual(await migrateSqliteTo(fresh.db, { sha256 }), {
        from: 0,
        to: 2,
        applied: 2,
      });
      assert.equal(
        (await migrateSqliteTo(fresh.db, { sha256, target: 1 })).applied,
        1,
      );
    } finally {
      fresh.close();
    }
    // Separate empty database exercises PostgreSQL 0 -> 2 -> 1 without fixture grants.
    await admin.query('CREATE DATABASE us022_empty OWNER fm_schema_owner');
    const connection = migrator.options;
    const pg = await import('pg');
    const empty = new pg.default.Pool({
      ...connection,
      password: credentials.migrator,
      database: 'us022_empty',
      max: 1,
    });
    try {
      assert.deepEqual(await migratePostgresTo(empty), {
        from: 0,
        to: 2,
        applied: 2,
      });
      assert.equal((await migratePostgresTo(empty, { target: 1 })).applied, 1);
    } finally {
      await empty.end();
      await admin.query('DROP DATABASE us022_empty');
    }
  });
  for (const engine of ['sqlite', 'postgres'])
    await step(engine + '_process_interruption_up_and_down', async () => {
      for (const target of [2, 1]) {
        if (target === 1) await migrate(engine, 2);
        const current = target === 2 ? 1 : 2;
        for (const checkpoint of [
          'after_ddl',
          'after_history',
          'before_commit',
        ]) {
          const old = await history(engine);
          assert.deepEqual(
            await worker({
              engine,
              filename,
              password: credentials.migrator,
              target,
              checkpoint,
            }),
            { interrupted: true },
          );
          // PostgreSQL acquires the same lock, waiting for backend disconnect rollback.
          assert.equal((await migrate(engine, current)).applied, 0);
          assert.deepEqual(await history(engine), old);
          assert.equal(await indexExists(engine), current === 2);
          assert.equal(await snapshot(engine), before[engine]);
        }
        assert.equal((await migrate(engine, target)).applied, 1);
        assert.equal((await migrate(engine, target)).applied, 0);
      }
    });
  await step('serialized_concurrent_migrators', async () => {
    for (const engine of ['sqlite', 'postgres']) {
      const results = await Promise.all([
        worker({ engine, filename, password: credentials.migrator, target: 2 }),
        worker({ engine, filename, password: credentials.migrator, target: 2 }),
      ]);
      assert.deepEqual(results.map((item) => item.applied).sort(), [0, 1]);
      assert.equal((await history(engine)).length, 2);
      assert.equal(await indexExists(engine), true);
    }
  });
  await step('checksum_history_and_unsupported_plans', async () => {
    for (const engine of ['sqlite', 'postgres']) {
      const catalog = await catalogFor(engine),
        old = await history(engine);
      const altered = catalog.map((item) =>
        item.version === 2 ? { ...item, down: item.down + '\n-- drift' } : item,
      );
      await assert.rejects(
        migrate(engine, 1, altered),
        /MIGRATION_CHECKSUM_MISMATCH/,
      );
      for (const version of [0, 3, 1.5])
        await assert.rejects(
          migrate(engine, version),
          /MIGRATION_TARGET_UNSUPPORTED/,
        );
      const irreversible = {
        version: 3,
        name: 'synthetic-irreversible',
        up:
          engine === 'sqlite'
            ? 'CREATE TABLE synthetic_irreversible(id INTEGER);'
            : 'CREATE TABLE fm.synthetic_irreversible(id integer);',
        down: null,
        destructive: false,
      };
      irreversible.checksum = await sha256(migrationContent(irreversible));
      await migrate(engine, 3, [...catalog, irreversible]);
      await assert.rejects(
        migrate(engine, 1, [...catalog, irreversible]),
        /MIGRATION_DOWN_UNSUPPORTED/,
      );
      await assert.rejects(migrate(engine, 2), /MIGRATION_HISTORY_INVALID/);
      // Restore only synthetic version 3 through its explicit inverse for the test.
      if (engine === 'sqlite') {
        await sqlite.db.exec(
          'BEGIN IMMEDIATE;DROP TABLE synthetic_irreversible;DELETE FROM _schema_migration WHERE version=3;COMMIT',
        );
      } else
        await admin.query(
          'BEGIN;DROP TABLE fm.synthetic_irreversible;DELETE FROM fm.schema_migration WHERE version=3;COMMIT',
        );
      assert.deepEqual(await history(engine), old);
      const destructive = {
        ...irreversible,
        name: 'synthetic-destructive',
        destructive: true,
      };
      destructive.checksum = await sha256(migrationContent(destructive));
      await assert.rejects(
        migrate(engine, 3, [...catalog, destructive]),
        /MIGRATION_DESTRUCTIVE_UNSUPPORTED/,
      );
      // Tamper only technical metadata as the operator; runtime users cannot do this.
      if (engine === 'sqlite')
        await sqlite.db.run(
          'UPDATE _schema_migration SET checksum=? WHERE version=2',
          ['0'.repeat(64)],
        );
      else
        await admin.query(
          'UPDATE fm.schema_migration SET checksum=$1 WHERE version=2',
          ['0'.repeat(64)],
        );
      await assert.rejects(migrate(engine, 2), /MIGRATION_CHECKSUM_MISMATCH/);
      if (engine === 'sqlite')
        await sqlite.db.run(
          'UPDATE _schema_migration SET checksum=? WHERE version=2',
          [catalog[1].checksum],
        );
      else
        await admin.query(
          'UPDATE fm.schema_migration SET checksum=$1 WHERE version=2',
          [catalog[1].checksum],
        );
    }
  });
  await step('legacy_clients_fail_closed_on_new_schema', async () => {
    await assert.rejects(migrateSqlite(sqlite.db), /SQLITE_MIGRATION_MISMATCH/);
    await assert.rejects(
      applyInitialMigration(migrator),
      /MIGRATION_CHECKSUM_MISMATCH/,
    );
  });
  await step('financial_corpus_and_snapshots_preserved', async () => {
    for (const engine of ['sqlite', 'postgres']) {
      assert.equal(await snapshot(engine), before[engine]);
      const results = await runSyntheticCases(
        engine === 'sqlite' ? sqlite.db : postgres.adapter,
      );
      assert.equal(results.length, 33);
      const afterCorpus = await snapshot(engine);
      await migrate(engine, 1);
      assert.equal(await snapshot(engine), afterCorpus);
      await migrate(engine, 2);
      assert.equal(await snapshot(engine), afterCorpus);
    }
    assert.equal(
      (await sqlite.db.rows('PRAGMA integrity_check'))[0].integrity_check,
      'ok',
    );
    assert.equal((await sqlite.db.rows('PRAGMA foreign_key_check')).length, 0);
  });
  await step('rls_and_metadata_privileges_preserved', async () => {
    // Check the known financial relations explicitly, independent of search_path.
    for (const table of businessTables) {
      const row = (
        await admin.query(
          'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
          ['fm.' + table],
        )
      ).rows[0];
      assert.equal(row.relrowsecurity, true);
      assert.equal(row.relforcerowsecurity, true);
    }
    const a = createDualPool('us021_a', credentials.a);
    try {
      await assert.rejects(
        a.query('INSERT INTO fm.schema_migration VALUES(3,$1,now())', [
          '0'.repeat(64),
        ]),
      );
    } finally {
      await a.end();
    }
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
    const logs = await docker(['logs', containerId], true);
    for (const canary of [
      ...Object.values(credentials),
      'SYNTHETIC_US021_MOVEMENT',
      '9007199254740993',
    ])
      assert.equal(logs.includes(canary), false);
  });
  report.passed = true;
} catch (error) {
  const code = /^[A-Z0-9_]{2,50}$/.test(error?.code ?? '')
    ? '_' + error.code
    : '';
  console.error('US022_MIGRATIONS_FAILED_' + stage.toUpperCase() + code);
  process.exitCode = 1;
} finally {
  const closed = await Promise.allSettled([
    postgres?.close(),
    migrator?.end(),
    admin?.end(),
  ]);
  try {
    sqlite?.close();
  } catch {
    closed.push({ status: 'rejected' });
  }
  if (closed.some((item) => item.status === 'rejected')) {
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
          'label=com.docker.compose.project=financial-manager-us022',
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
      console.error('US022_CLEANUP_FAILED');
    }
  if (locked) rmdirSync(path.join(directory, '.lock'));
  if (owned) {
    report.source_sha256 = migrationHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateMigrationEvidence(report);
    writeFileSync(
      path.join(directory, 'latest.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
