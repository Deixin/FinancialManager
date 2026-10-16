/* global setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpikePool } from '../../apps/api/spikes/us-004/database.mjs';
import { homologate } from '../rls/homologate.mjs';
import { fixture, amounts } from '../rls/fixtures.mjs';
import { validateRlsEvidence } from './rls-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = path.join(root, '.tools/us004-rls');
const composeFile = path.join(root, 'infra/rls/compose.yaml');
const migration = readFileSync(
  path.join(root, 'apps/api/spikes/us-004/migrations/0001-synthetic-rls.sql'),
  'utf8',
);
const imageSha =
  '77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const image = 'postgres:18.6-alpine@sha256:' + imageSha;
const env = {
  ...process.env,
  US004_ARTIFACTS: artifacts.replaceAll('\\', '/'),
};
let stage = 'configuration';

async function run(args, timeout = 180_000, captureStderr = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    // PostgreSQL errors may include financial payloads. Never relay tool output.
    if (captureStderr)
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
    else child.stderr.resume();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('DOCKER_TIMEOUT'));
    }, timeout);
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
}
const compose = (...args) => run(['compose', '-f', composeFile, ...args]);
const removeSecrets = () => {
  for (const name of ['bootstrap-password', 'credentials.json'])
    rmSync(path.join(artifacts, name), { force: true });
};

async function teardown() {
  try {
    await compose('down', '--volumes');
  } finally {
    removeSecrets();
  }
  assert.equal((await compose('ps', '-a', '-q')).trim(), '');
  for (const name of ['bootstrap-password', 'credentials.json'])
    assert.equal(existsSync(path.join(artifacts, name)), false);
}

async function inspectEnvironment() {
  const id = (await compose('ps', '-q')).trim();
  assert.match(id, /^[0-9a-f]{64}$/);
  const [container] = JSON.parse(await run(['inspect', id]));
  assert.equal(container.Config.Image, image);
  assert.equal(container.Config.User, '70:70');
  assert.equal(container.State.Running, true);
  assert.equal(
    container.Config.Labels['com.docker.compose.project'],
    'financial-manager-us004',
  );
  assert.deepEqual(container.HostConfig.PortBindings, {
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '43184' }],
  });
  assert.ok(container.HostConfig.Tmpfs['/var/lib/postgresql']);
  assert.ok(container.Mounts.every((mount) => mount.Type !== 'volume'));
  return id;
}

try {
  const mode = process.argv[2];
  if (mode === 'down') {
    await teardown();
    console.log('US-004: dedicated container and synthetic secrets removed.');
  } else if (mode === 'test') {
    mkdirSync(artifacts, { recursive: true, mode: 0o700 });
    rmSync(path.join(artifacts, 'report.json'), { force: true });
    let report = {
      format_version: 1,
      synthetic_only: true,
      scope: 'postgresql-rls-pool-spike',
      passed: false,
      checks: {},
    };
    const credentials = {
      bootstrap: randomBytes(32).toString('hex'),
      migrator: randomBytes(32).toString('hex'),
      runtime: randomBytes(32).toString('hex'),
    };
    try {
      stage = 'reset_synthetic_stack';
      await compose('down', '--volumes');
      writeFileSync(
        path.join(artifacts, 'credentials.json'),
        JSON.stringify(credentials),
        { mode: 0o600 },
      );
      // The host directory is private; the container's unprivileged postgres
      // user must be able to read this specific read-only secret bind mount.
      writeFileSync(
        path.join(artifacts, 'bootstrap-password'),
        credentials.bootstrap,
        { mode: 0o444 },
      );
      stage = 'start_postgres';
      await compose('up', '-d', '--force-recreate');
      stage = 'inspect_dedicated_environment';
      const containerId = await inspectEnvironment();
      const ready = createSpikePool({
        user: 'us004_bootstrap',
        password: credentials.bootstrap,
      });
      let available = false;
      try {
        for (let attempt = 0; attempt < 120; attempt++) {
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
      report = await homologate({
        credentials,
        migration,
        progress: (name) => {
          stage = name;
          console.log('US-004 check: ' + name);
        },
      });
      report.checks.docker_loopback_and_ephemeral_storage = true;
      if (report.passed) {
        stage = 'operational_logs_sanitized';
        const logs = await run(['logs', containerId], 180_000, true);
        for (const forbidden of [
          ...Object.values(credentials),
          ...Object.values(fixture),
          ...Object.values(amounts),
        ])
          assert.equal(logs.includes(forbidden), false);
        report.checks.operational_logs_sanitized = true;
      }
    } finally {
      await teardown();
      report.completed_at_utc = new Date().toISOString();
      report.containers_and_synthetic_secrets_removed = true;
      report.image_sha256 = imageSha;
      report.versions = {
        node: process.versions.node,
        pg: JSON.parse(
          readFileSync(
            path.join(root, 'apps/api/node_modules/pg/package.json'),
            'utf8',
          ),
        ).version,
      };
      if (!report.passed) report.failed_step ??= stage;
      if (report.passed) validateRlsEvidence(report);
      writeFileSync(
        path.join(artifacts, 'report.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    }
    if (!report.passed) throw new Error('RLS_EVIDENCE_FAILED');
    console.log(
      'US-004: PostgreSQL RLS and pool protocol passed; sanitized evidence saved in .tools/us004-rls/report.json.',
    );
  } else throw new Error('EXPECTED_TEST_OR_DOWN');
} catch {
  console.error(
    'US-004 failed at: ' +
      stage +
      '. Raw SQL, row values and database errors are never logged.',
  );
  process.exitCode = 1;
}
