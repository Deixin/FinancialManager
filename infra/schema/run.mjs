/* global setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { homologate } from './homologate.mjs';
import { createPool, sentinels } from './fixtures.mjs';
import { pending, sourceHashes, validateSchemaEvidence } from './evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, '.tools/us020-schema');
const lock = path.join(directory, '.runner-lock');
const secret = path.join(directory, 'bootstrap-password');
const composeFile = path.join(root, 'infra/schema/compose.yaml');
const image =
  'postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const environment = {
  ...process.env,
  US020_ARTIFACTS: directory.replaceAll('\\', '/'),
};
for (const key of Object.keys(environment))
  if (/^(DOCKER_|COMPOSE_)/.test(key)) delete environment[key];
const run = async (args, stderr = false) =>
  await new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 4_000_000) child.kill();
    };
    child.stdout.on('data', collect);
    if (stderr) child.stderr.on('data', collect);
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
      if (code === 0) resolve(output);
      else reject(new Error('DOCKER_FAILED'));
    });
  });
const compose = (...args) =>
  run([
    'compose',
    '-p',
    'financial-manager-us020',
    '-f',
    composeFile,
    '--env-file',
    path.join(directory, 'empty.env'),
    ...args,
  ]);
async function inspectOwned() {
  const ids = (await compose('ps', '-a', '-q'))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) return [];
  assert.equal(ids.length, 1);
  const [container] = JSON.parse(await run(['inspect', ids[0]]));
  assert.equal(
    container.Config.Labels['io.financial-manager.us020-synthetic'],
    'true',
  );
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us020',
  );
  assert.equal(container.Config.Image, image);
  assert.equal(container.Config.User, '70:70');
  assert.deepEqual(container.HostConfig.PortBindings, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '43220' }],
  });
  assert.ok(container.HostConfig.Tmpfs['/var/lib/postgresql']);
  assert.ok(container.Mounts.every((mount) => mount.Type !== 'volume'));
  return ids;
}
async function cleanup() {
  await inspectOwned();
  await compose('down', '--volumes');
  assert.equal((await compose('ps', '-a', '-q')).trim(), '');
  assert.equal(
    (
      await run([
        'network',
        'ls',
        '--filter',
        'label=com.docker.compose.project=financial-manager-us020',
        '--format',
        '{{.ID}}',
      ])
    ).trim(),
    '',
  );
  rmSync(secret, { force: true });
  assert.equal(existsSync(secret), false);
}
let stage = 'configuration',
  owns = false,
  locked = false;
const report = {
  format_version: 1,
  scope: 'us020-postgresql-financial-core',
  synthetic_only: true,
  started_at_utc: new Date().toISOString(),
  checks: {},
  pending: [...pending],
  passed: false,
};
try {
  for (const folder of [path.join(root, '.tools'), directory]) {
    if (existsSync(folder))
      assert.equal(lstatSync(folder).isSymbolicLink(), false);
    else mkdirSync(folder, { mode: 0o700 });
  }
  mkdirSync(lock);
  locked = true;
  writeFileSync(path.join(directory, 'empty.env'), '');
  const context = JSON.parse(await run(['context', 'inspect']));
  assert.ok(
    context.length === 1 &&
      /^(npipe:|unix:)/.test(context[0].Endpoints.docker.Host),
  );
  if (process.argv[2] === 'clean') {
    await cleanup();
    console.log('US-020 owned synthetic resources removed.');
  } else {
    assert.equal(process.argv[2], 'test');
    assert.equal(
      (await compose('ps', '-a', '-q')).trim(),
      '',
      'Existing synthetic instance is left untouched',
    );
    const credentials = Object.fromEntries(
      ['bootstrap', 'migrator', 'a', 'b', 'outsider'].map((key) => [
        key,
        randomBytes(32).toString('hex'),
      ]),
    );
    writeFileSync(secret, credentials.bootstrap, { mode: 0o444 });
    owns = true;
    stage = 'start_postgresql';
    await compose('up', '-d');
    const ids = await inspectOwned();
    const ready = createPool(pg, 'us020_bootstrap', credentials.bootstrap);
    let available = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await ready.query('SELECT 1');
          available = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    } finally {
      await ready.end();
    }
    assert.equal(available, true);
    report.versions = {
      node: process.versions.node,
      pg: JSON.parse(
        readFileSync(
          new URL('../../node_modules/pg/package.json', import.meta.url),
          'utf8',
        ),
      ).version,
      postgresql: await homologate(
        credentials,
        (name) => {
          stage = name;
          console.log('US-020 check: ' + name);
        },
        report.checks,
      ),
    };
    stage = 'operational_logs_sanitized';
    const logs = await run(['logs', ids[0]], true);
    for (const forbidden of [...Object.values(credentials), ...sentinels])
      assert.equal(logs.includes(forbidden), false);
    report.checks.operational_logs_sanitized = true;
    report.passed = true;
  }
} catch {
  console.error('US020_SCHEMA_FAILED_' + stage.toUpperCase());
  process.exitCode = 1;
} finally {
  try {
    if (owns) {
      await cleanup();
      report.checks.owned_resources_removed = true;
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    console.error('US020_SCHEMA_CLEANUP_FAILED');
    process.exitCode = 1;
  }
  if (locked) rmdirSync(lock);
  if (owns) {
    report.completed_at_utc = new Date().toISOString();
    report.source_sha256 = sourceHashes();
    if (report.passed) validateSchemaEvidence(report);
    writeFileSync(
      path.join(directory, 'latest.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
