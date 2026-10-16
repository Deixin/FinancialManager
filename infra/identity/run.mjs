/* global setTimeout,clearTimeout,localStorage,sessionStorage */
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import pg from 'pg';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createApiIdentity } from '../../apps/api/dist/identity.js';
import { createWorkerIdentity } from '../../apps/worker/dist/identity.js';
import {
  runIdentityProbe,
  identityVectors,
} from '../../packages/contracts/dist/identity-probe.js';
import {
  resourceId,
  uuidV7,
  uuidV7Milliseconds,
} from '../../packages/contracts/dist/identity.js';
import { financialDate, utcInstant } from '../../packages/domain/dist/index.js';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import {
  seedSyntheticSqlite,
  syntheticCorpus,
} from '../../packages/storage-schema/dist/synthetic-probe.js';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migratePostgresTo, sha256 } from '../schema/postgres-migrations.mjs';
import {
  nodeChecks,
  sourceHashes,
  validateIdentityEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us023-identity'),
  filename = path.join(directory, 'synthetic.sqlite');
const env = {
  ...process.env,
  US023_ARTIFACTS: directory.replaceAll('\\', '/'),
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
    'financial-manager-us023',
    '-f',
    path.join(root, 'infra/identity/compose.yaml'),
    '--env-file',
    path.join(directory, 'empty.env'),
    ...args,
  ]);
const pool = (user, password) => {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: 43223,
    database: 'us023',
    user,
    password,
    max: 1,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 1000,
    query_timeout: 15000,
    options: '-c search_path=pg_catalog -c timezone=UTC',
  });
  pool.on('error', () => {});
  return pool;
};
let owned = false,
  locked = false,
  admin,
  migrator,
  sqlite,
  browser,
  server,
  stage = 'configuration';
const report = {
  format_version: 1,
  synthetic_only: true,
  scope: 'us023-js-postgresql-identity-time',
  passed: false,
  checks: {},
  engines: { node: process.versions.node },
  same_millisecond_sample_count: 4096,
  pending: ['ios-runtime', 'product-command-and-repository-integration'],
};
const step = async (name, operation) => {
  stage = name;
  await operation();
  report.checks[name] = true;
  console.log('US-023 check: ' + name);
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
  const credentials = {
    bootstrap: randomBytes(32).toString('hex'),
    migrator: randomBytes(32).toString('hex'),
  };
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
    container.Config.Labels['io.financial-manager.us023-synthetic'],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us023',
  );
  assert.deepEqual(container.HostConfig.PortBindings, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '43223' }],
  });
  assert.ok(container.HostConfig.Tmpfs['/var/lib/postgresql']);
  admin = pool('us023_bootstrap', credentials.bootstrap);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await admin.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready);
  await admin.query(
    `CREATE ROLE fm_schema_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;CREATE ROLE fm_schema_migrator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${credentials.migrator}';GRANT fm_schema_owner TO fm_schema_migrator;REVOKE ALL ON DATABASE us023 FROM PUBLIC;REVOKE CREATE ON SCHEMA public FROM PUBLIC;GRANT CONNECT ON DATABASE us023 TO fm_schema_migrator;GRANT CREATE ON DATABASE us023 TO fm_schema_owner`,
  );
  migrator = pool('fm_schema_migrator', credentials.migrator);
  await migratePostgresTo(migrator);
  report.engines.postgresql = (
    await admin.query('SHOW server_version')
  ).rows[0].server_version;
  const operator = async (operation) => {
    const client = await migrator.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE fm_schema_owner');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  report.checks = { ...runIdentityProbe(createApiIdentity) };
  await step('api_and_worker_csprng', async () => {
    assert.deepEqual(runIdentityProbe(createWorkerIdentity), report.checks);
  });
  await step('four_timezone_processes', async () => {
    for (const timezone of [
      'UTC',
      'America/Fortaleza',
      'America/New_York',
      'Asia/Tokyo',
    ]) {
      const result = spawnSync(
        process.execPath,
        ['infra/identity/timezone-worker.mjs'],
        {
          cwd: root,
          env: { ...process.env, TZ: timezone },
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
        },
      );
      assert.equal(result.status, 0);
      const value = JSON.parse(result.stdout);
      assert.equal(value.passed, true);
      for (const name of Object.keys(value.checks))
        assert.equal(value.checks[name], true);
    }
  });
  await step('chromium_real_crypto_and_no_storage_egress', async () => {
    const compiled = await build({
      entryPoints: [path.join(root, 'infra/identity/browser.ts')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
    });
    server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none';script-src 'self';connect-src 'none';base-uri 'none';frame-ancestors 'none'",
      );
      if (request.url === '/probe.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(compiled.outputFiles[0].text);
      } else if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          '<!doctype html><meta charset="utf-8"><title>US-023 synthetic identity probe</title><script src="/probe.js" defer></script>',
        );
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    report.engines.chromium = browser.version();
    for (const timezoneId of [
      'UTC',
      'America/Fortaleza',
      'America/New_York',
      'Asia/Tokyo',
    ]) {
      const context = await browser.newContext({ timezoneId });
      const page = await context.newPage();
      let errors = 0,
        external = 0;
      page.on('pageerror', () => errors++);
      page.on('request', (request) => {
        if (!request.url().startsWith(url + '/')) external++;
      });
      await page.goto(url);
      await page.waitForFunction(() => globalThis.us023Report !== undefined);
      const value = await page.evaluate(() => globalThis.us023Report);
      assert.equal(value.passed, true);
      assert.deepEqual(
        Object.keys(value.checks).sort(),
        Object.keys(runIdentityProbe(createApiIdentity)).sort(),
      );
      assert.equal(errors, 0);
      assert.equal(external, 0);
      assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0,
      );
      await context.close();
    }
    await browser.close();
    browser = undefined;
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  });
  await step('postgres_native_v7_and_sorting', async () => {
    const native = (
      await operator((client) =>
        client.query(
          'SELECT uuidv7()::text AS id FROM generate_series(1,4096)',
        ),
      )
    ).rows.map((row) => row.id);
    assert.equal(new Set(native).size, 4096);
    for (const id of native) {
      uuidV7(id);
      assert.ok(Math.abs(uuidV7Milliseconds(id) - Date.now()) < 60000);
    }
    await operator(async (client) => {
      await client.query(
        'CREATE SCHEMA us023 AUTHORIZATION fm_schema_owner; CREATE TABLE us023.temporal(id fm.resource_id PRIMARY KEY,day fm.financial_day NOT NULL,instant fm.technical_instant NOT NULL)',
      );
      for (const id of [
        identityVectors.rfc.uuid,
        identityVectors.legacy_uuid,
        ...native.slice(0, 32),
        createApiIdentity().newId(),
      ])
        await client.query('INSERT INTO us023.temporal VALUES($1,$2,$3)', [
          resourceId(id),
          '2026-10-16',
          '2026-10-16T00:00:00.000Z',
        ]);
      const ids = (
        await client.query('SELECT id::text FROM us023.temporal ORDER BY id')
      ).rows.map((row) => row.id);
      assert.deepEqual(ids, [...ids].sort());
    });
  });
  await step('postgres_temporal_domains_and_precision', async () => {
    const identity = createApiIdentity();
    for (const [index, value] of identityVectors.valid_instants.entries()) {
      const day = financialDate(
        identityVectors.valid_dates[index % identityVectors.valid_dates.length],
      );
      const instant = utcInstant(value.text);
      const id = identity.newId();
      const row = await operator(async (client) => {
        await client.query('INSERT INTO us023.temporal VALUES($1,$2,$3)', [
          id,
          day,
          instant,
        ]);
        return (
          await client.query(
            `SELECT id::text,to_char(day,'YYYY-MM-DD') AS day,to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS instant FROM us023.temporal WHERE id=$1`,
            [id],
          )
        ).rows[0];
      });
      assert.deepEqual(JSON.parse(JSON.stringify(row)), { id, day, instant });
    }
    for (const text of [
      '2026-10-16T00:00:00.0001Z',
      '0001-01-01T00:00:00.000001Z',
      '10000-01-01T00:00:00.000Z',
    ])
      await assert.rejects(
        operator((client) =>
          client.query('INSERT INTO us023.temporal VALUES($1,$2,$3)', [
            identity.newId(),
            '2026-10-16',
            text,
          ]),
        ),
      );
    for (const text of identityVectors.invalid_instants)
      assert.throws(() => utcInstant(text));
    for (const text of identityVectors.invalid_dates)
      assert.throws(() => financialDate(text));
  });
  await step('sqlite_product_roundtrip', async () => {
    sqlite = openProbeDatabase(filename);
    await migrateSqliteTo(sqlite.db, { sha256 });
    await seedSyntheticSqlite(sqlite.db);
    report.engines.sqlite = (
      await sqlite.db.rows('SELECT sqlite_version() AS version')
    )[0].version;
    const identity = createApiIdentity(),
      account = syntheticCorpus.seed.find(
        (row) => row.table === 'financial_account',
      ).values;
    for (const [index, value] of identityVectors.valid_instants.entries()) {
      const id = identity.newId(),
        day =
          identityVectors.valid_dates[
            index % identityVectors.valid_dates.length
          ];
      await sqlite.db.run(
        "INSERT INTO balance_reference(id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status,created_at) VALUES(?,?,?,0,?,'START_OF_DAY','MANUAL','SUPERSEDED',?)",
        [id, account.workspace_id, account.id, day, value.text],
      );
      assert.deepEqual(
        await sqlite.db.rows(
          'SELECT id,reference_date,created_at FROM balance_reference WHERE id=?',
          [id],
        ),
        [{ id, reference_date: day, created_at: value.text }],
      );
    }
    sqlite.close();
    sqlite = openProbeDatabase(filename);
    assert.equal(
      (await sqlite.db.rows('PRAGMA integrity_check'))[0].integrity_check,
      'ok',
    );
  });
  await step('operational_logs_sanitized', async () => {
    const logs = await docker(['logs', containerId], true);
    for (const value of [
      ...Object.values(credentials),
      'SYNTHETIC_US023',
      'SYNTHETIC_US021_MOVEMENT',
    ])
      assert.equal(logs.includes(value), false);
  });
  assert.ok(
    nodeChecks
      .filter((name) => name !== 'owned_resources_removed')
      .every((name) => report.checks[name] === true),
  );
  report.passed = true;
} catch {
  console.error('US023_IDENTITY_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  const closed = await Promise.allSettled([migrator?.end(), admin?.end()]);
  try {
    sqlite?.close();
  } catch {
    closed.push({ status: 'rejected' });
  }
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
          'label=com.docker.compose.project=financial-manager-us023',
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
      console.error('US023_CLEANUP_FAILED');
    }
  if (locked) rmdirSync(path.join(directory, '.lock'));
  if (owned) {
    report.source_sha256 = sourceHashes('node');
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateIdentityEvidence(report);
    writeFileSync(
      path.join(directory, 'node.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
